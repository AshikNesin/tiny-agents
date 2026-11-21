import type { Frame, Page } from "playwright-core";
import type { SecretValue } from "./vault-target";
import { VaultTargetMovedError } from "./vault-target";
import { assertRefShape } from "./browser-guard";

export interface SecretFillField {
  key: string;
  autocomplete: string;
  ref?: string;
  value: SecretValue;
}

export interface SecretFill {
  origin: string;
  frameOrigins?: string[];
  fields: SecretFillField[];
  steps?: boolean;
}

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

const STEP_TIMEOUT_MS = 10_000;
const STEP_POLL_MS = 250;
const MAX_STEPS = 2;

type FillResult = "filled" | "missing" | "origin" | "locked";

interface FillArgs {
  allowed: string[];
  value: string;
  token: string;
  given: boolean;
}

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

export async function refOrigin(page: Page, ref: string): Promise<string> {
  assertRefShape(ref);
  return page
    .getByRef(ref)
    .evaluate(() => location.origin, undefined, { timeout: ACTION_TIMEOUT_MS });
}

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
    const next = await nextStep(page, fill, remaining);
    filled.push(...next);
    remaining = remaining.filter((field) => !next.includes(field.key));
    lastStep = next.length;
  }
  return { filled };
}

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
    if (origin === "null") continue;
    if (origin !== fill.origin) return [];
    const found = await fillPass(page, fill, unbound).catch((error: unknown) => {
      if (error instanceof OriginMismatchError) return [];
      throw error;
    });
    if (found.length) return found;
  }
  return [];
}

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
      const frames: Frame[] = [
        page.mainFrame(),
        ...page.frames().filter((f) => f !== page.mainFrame()),
      ];
      for (const [index, frame] of frames.entries()) {
        const found: FillResult = await frame
          .evaluate(fillInPage, args(false))
          .catch(() => "missing" as const);
        if (found === "origin" && index > 0) continue;
        result = found;
        if (result === "filled" || result === "origin") break;
      }
    }
    if (result === "origin") {
      const top = await pageOrigin(page);
      if (field.ref && top === fill.origin) {
        const frame = await refOrigin(page, field.ref).catch(() => undefined);
        if (frame && frame !== top) throw new FrameOriginError(frame);
      }
      throw new OriginMismatchError(top);
    }
    if (result === "filled") filled.push(field.key);
  }
  return filled;
}
