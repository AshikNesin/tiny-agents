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
import type { SecretValue } from "./vault-target";
import { VaultTargetMovedError } from "./vault-target";
import { assertRefShape } from "./browser-guard";

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
  /**
   * Sign-ins split over steps (an email page, then a password page, as
   * Amazon's): when some fields are filled and others are not on the page,
   * submit the filled step and fill the rest once the next step shows.
   */
  steps?: boolean;
}

/** The page is not on the origin the fill is bound to; `actual` is where it is. */
export class OriginMismatchError extends VaultTargetMovedError {
  constructor(actual: string) {
    super(
      actual,
      "The page is not on the origin this value may be filled on.",
      "page origin changed before the fill",
    );
    this.name = "OriginMismatchError";
  }
}

/**
 * The page is on the origin the fill is bound to, but the field is in a frame
 * from another site (a sign-in widget such as id.tinypass.com on
 * thehindu.com); `actual` is the frame's origin. Nothing is filled there.
 */
export class FrameOriginError extends VaultTargetMovedError {
  constructor(actual: string) {
    super(
      actual,
      `The field is in a frame from ${actual}, not on the page's own origin.`,
      `field is in a frame from ${actual}`,
    );
    this.name = "FrameOriginError";
  }
}

const ACTION_TIMEOUT_MS = 15_000;

/** How long the next step of a sign-in may take to show its fields. */
const STEP_TIMEOUT_MS = 10_000;
const STEP_POLL_MS = 250;
/** Steps submitted at most: email, then password, then (rarely) one more. */
const MAX_STEPS = 2;

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
  // Tokens that say nothing of what the field holds: `webauthn` (a passkey
  // hint, alone on Amazon's email field), `section-*`, on/off.
  const namesNoPurpose = (token: string) =>
    token === "on" || token === "off" || token === "webauthn" || token.startsWith("section-");
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
  /** A sign-in field that holds a mobile number: a tel input whose name,
   * placeholder or label says so ("Enter your mobile number"). */
  const isMobileNumberField = (el: Element, text: string) =>
    (el as HTMLInputElement).type === "tel" && /mobile|phone|contact.?number/.test(text);
  const heuristics: Record<string, (el: Element, text: string) => boolean> = {
    "current-password": (el) => (el as HTMLInputElement).type === "password",
    "new-password": (el) => (el as HTMLInputElement).type === "password",
    username: (el, text) =>
      (el as HTMLInputElement).type === "email" ||
      isMobileNumberField(el, text) ||
      /user|login|e-?mail|account/.test(text),
    email: (el, text) => (el as HTMLInputElement).type === "email" || /e-?mail/.test(text),
    // Mobile-number sign-ins (portals that sign in by phone): a `tel` input
    // whose label or placeholder names a mobile number. It is that sign-in's
    // username field, so the username heuristic accepts it too.
    tel: (el, text) => isMobileNumberField(el, text),
    "one-time-code": (el, text) =>
      /otp|one.?time|2fa|mfa|totp|verification|security.?code|\bcode\b/.test(text) &&
      (el as HTMLInputElement).type !== "password",
    "cc-number": (_el, text) => /card.?num|cc.?num|cardnumber|card.?no\b|\bpan\b/.test(text),
    "cc-exp": (_el, text) => /exp/.test(text) && !/month|year|\bmm\b|\byy/.test(text),
    "cc-exp-month": (_el, text) => /month|\bmm\b/.test(text) && !/year|\byy/.test(text),
    "cc-exp-year": (_el, text) => /year|\byy/.test(text) && !/month|\bmm\b/.test(text),
    "cc-csc": (_el, text) => /cvc|cvv|csc|security.?code|card.?code/.test(text),
    "cc-name": (_el, text) => /name.?on.?card|card.?holder|cc.?name|holder/.test(text),
  };

  let target: Element | null = given;
  if (!args.given) {
    const candidates = [...document.querySelectorAll("input, select, textarea")].filter(usable);
    target =
      candidates.find((el) => tokensOf(el).includes(args.token)) ??
      // Heuristics only guess for fields that name no purpose of their own.
      candidates.find(
        (el) =>
          tokensOf(el).every(namesNoPurpose) &&
          (heuristics[args.token]?.(el, describe(el)) ?? false),
      ) ??
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

/** The origin of the frame holding the element `ref` names. */
export async function refOrigin(page: Page, ref: string): Promise<string> {
  assertRefShape(ref);
  return page
    .getByRef(ref)
    .evaluate(() => location.origin, undefined, { timeout: ACTION_TIMEOUT_MS });
}

/**
 * Fill `fill.fields`; returns the keys filled. Throws `OriginMismatchError`
 * when the page is off-origin before anything is filled. With `fill.steps`,
 * a step that filled some fields is submitted (Enter in the last field
 * filled, as a user would) and the rest are filled on the step that follows;
 * leaving the origin on the way ends the fill with what was filled.
 */
export async function fillSecretFields(
  page: Page,
  fill: SecretFill,
): Promise<{ filled: string[] }> {
  const top = await pageOrigin(page);
  if (top !== fill.origin) throw new OriginMismatchError(top);
  const filled = await fillPass(page, fill, fill.fields);
  let remaining = fill.fields.filter((field) => !filled.includes(field.key));
  let lastStep = filled.length;
  for (let step = 0; fill.steps && remaining.length && lastStep && step < MAX_STEPS; step++) {
    await page.keyboard.press("Enter");
    // Refs name elements of the step before; the next step is found by markup.
    const next = await nextStep(page, fill, remaining);
    filled.push(...next);
    remaining = remaining.filter((field) => !next.includes(field.key));
    lastStep = next.length;
  }
  return { filled };
}

/** Fill `remaining` once the next step shows them; [] when it doesn't in time. */
async function nextStep(
  page: Page,
  fill: SecretFill,
  remaining: SecretFillField[],
): Promise<string[]> {
  const unbound = remaining.map(({ ref: _ref, ...field }) => field);
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await page.waitForTimeout(STEP_POLL_MS);
    const origin = await pageOrigin(page);
    if (origin === "null") continue; // between documents
    if (origin !== fill.origin) return []; // the step left the origin: nothing more fills
    const found = await fillPass(page, fill, unbound).catch((error: unknown) => {
      // The document changed between the check and the fill: look again.
      if (error instanceof OriginMismatchError) return [];
      throw error;
    });
    if (found.length) return found;
  }
  return [];
}

/** One pass over the page for `fields`; returns the keys filled. */
async function fillPass(
  page: Page,
  fill: SecretFill,
  fields: SecretFillField[],
): Promise<string[]> {
  const allowed = [fill.origin, ...(fill.frameOrigins ?? [])];
  const filled: string[] = [];
  for (const field of fields) {
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
    if (result === "origin") {
      const top = await pageOrigin(page);
      if (field.ref && top === fill.origin) {
        // The page stayed put: the ref names a field in another site's frame.
        const frame = await refOrigin(page, field.ref).catch(() => undefined);
        if (frame && frame !== top) throw new FrameOriginError(frame);
      }
      throw new OriginMismatchError(top);
    }
    if (result === "filled") filled.push(field.key);
  }
  return filled;
}
