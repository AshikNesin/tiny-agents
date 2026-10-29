/**
 * Filling vault values into a page (issue #56). The value travels from the
 * server to the page over the CDP link as the argument of one in-page
 * function, which first asserts the frame's origin, then sets the field the
 * way a user's paste would (native value setter + input/change events, so
 * React-style controlled inputs see it). Nothing is read back: the page
 * reports only whether a field was found and filled.
 *
 * Fields are named by a snapshot ref, or found by a small login/payment form
 * classifier: the field's `autocomplete` token first, then type/name/label
 * heuristics.
 */
import type { Frame, Page } from "playwright-core";
import type { SecretValue } from "../vault";
import { assertRefShape } from "./browser";

export interface SecretFillField {
  /** Reported back when filled. */
  key: string;
  /** HTML autocomplete token the field is classified by (`current-password`, `cc-number`, …). */
  autocomplete: string;
  /** A snapshot ref; else the classifier finds the field. */
  ref?: string;
  value: SecretValue;
}

export interface SecretFill {
  /** The page's top-level origin must be exactly this. */
  origin: string;
  /** Frame origins a field may sit in besides `origin` (an embedded payment form). */
  frameOrigins?: string[];
  fields: SecretFillField[];
}

/** The page is not on the origin the fill is bound to. */
export class OriginMismatchError extends Error {
  constructor(readonly actual: string) {
    super("The page is not on the origin this value may be filled on.");
    this.name = "OriginMismatchError";
  }
}

const ACTION_TIMEOUT_MS = 15_000;

type FillResult = "filled" | "missing" | "origin" | "locked";

interface FillArgs {
  allowed: string[];
  value: string;
  token: string;
  /** Set when the element is given (a ref); else the classifier searches the frame. */
  given: boolean;
}

/**
 * Runs in the page: `(element, args)` for a ref, `(args)` to search the
 * frame. Self-contained: Playwright serializes it, so it must not close over
 * anything.
 */
function fillInPage(first: Element | FillArgs, second?: FillArgs): FillResult {
  const args = (second ?? first) as FillArgs;
  const given = second ? (first as Element) : null;
  if (!args.allowed.includes(location.origin)) return "origin";

  const describe = (el: Element) =>
    [
      el.getAttribute("name"),
      el.getAttribute("id"),
      el.getAttribute("placeholder"),
      el.getAttribute("aria-label"),
      (el as HTMLInputElement).labels?.[0]?.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  const tokensOf = (el: Element) =>
    (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const usable = (el: Element) => {
    const input = el as HTMLInputElement;
    if (input.disabled || input.readOnly) return false;
    if (
      el.tagName === "INPUT" &&
      ["hidden", "submit", "button", "checkbox", "radio"].includes(input.type)
    ) {
      return false;
    }
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const heuristics: Record<string, (el: Element, text: string) => boolean> = {
    "current-password": (el) => (el as HTMLInputElement).type === "password",
    "new-password": (el) => (el as HTMLInputElement).type === "password",
    username: (el, text) =>
      (el as HTMLInputElement).type === "email" || /user|login|e-?mail|account/.test(text),
    email: (el, text) => (el as HTMLInputElement).type === "email" || /e-?mail/.test(text),
    "one-time-code": (el, text) =>
      /otp|one.?time|2fa|mfa|totp|verification|security.?code|\bcode\b/.test(text) &&
      (el as HTMLInputElement).type !== "password",
    "cc-number": (_el, text) => /card.?num|cc.?num|cardnumber|card.?no\b|\bpan\b/.test(text),
    "cc-exp": (_el, text) => /exp/.test(text) && !/month|year|\bmm\b|\byy/.test(text),
    "cc-exp-month": (_el, text) => /month|\bmm\b/.test(text),
    "cc-exp-year": (_el, text) => /year|\byy/.test(text),
    "cc-csc": (_el, text) => /cvc|cvv|csc|security.?code|card.?code/.test(text),
    "cc-name": (_el, text) => /name.?on.?card|card.?holder|cc.?name|holder/.test(text),
  };

  let target: Element | null = given;
  if (!args.given) {
    const candidates = [...document.querySelectorAll("input, select, textarea")].filter(usable);
    target =
      candidates.find((el) => tokensOf(el).includes(args.token)) ??
      candidates.find((el) => heuristics[args.token]?.(el, describe(el)) ?? false) ??
      null;
  }
  if (!target) return "missing";
  if (!usable(target)) return "locked";

  const el = target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  el.focus();
  if (el instanceof HTMLSelectElement) {
    const wanted = args.value.toLowerCase();
    const option = [...el.options].find(
      (o) =>
        o.value.toLowerCase() === wanted ||
        o.text.trim().toLowerCase() === wanted ||
        (/^\d+$/.test(wanted) && Number(o.value) === Number(wanted)) ||
        (/^\d{4}$/.test(wanted) && o.value === wanted.slice(2)),
    );
    if (!option) return "missing";
    el.value = option.value;
  } else {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, args.value);
    else el.value = args.value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return "filled";
}

/** The page's top-level origin, as the live document reports it. */
export async function pageOrigin(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => location.origin);
  } catch {
    try {
      return new URL(page.url()).origin;
    } catch {
      return "null";
    }
  }
}

/** Fill `fill.fields`; returns the keys filled. Throws `OriginMismatchError` off-origin. */
export async function fillSecretFields(
  page: Page,
  fill: SecretFill,
): Promise<{ filled: string[] }> {
  const top = await pageOrigin(page);
  if (top !== fill.origin) throw new OriginMismatchError(top);
  const allowed = [fill.origin, ...(fill.frameOrigins ?? [])];
  const filled: string[] = [];
  for (const field of fill.fields) {
    const args = (given: boolean): FillArgs => ({
      allowed,
      value: field.value.reveal(),
      token: field.autocomplete,
      given,
    });
    let result: FillResult = "missing";
    if (field.ref) {
      assertRefShape(field.ref);
      result = await page
        .getByRef(field.ref)
        .evaluate(fillInPage, args(true), { timeout: ACTION_TIMEOUT_MS })
        .catch(() => "missing" as const);
    } else {
      // Main frame first, then frames on an allowed origin (embedded payment forms).
      const frames: Frame[] = [
        page.mainFrame(),
        ...page.frames().filter((f) => f !== page.mainFrame()),
      ];
      for (const [index, frame] of frames.entries()) {
        const found: FillResult = await frame
          .evaluate(fillInPage, args(false))
          .catch(() => "missing" as const);
        // Only the top-level document being off-origin is a mismatch; other
        // frames (ads, widgets) are simply not searched.
        if (found === "origin" && index > 0) continue;
        result = found;
        if (result === "filled" || result === "origin") break;
      }
    }
    if (result === "origin") throw new OriginMismatchError(top);
    if (result === "filled") filled.push(field.key);
  }
  return { filled };
}
