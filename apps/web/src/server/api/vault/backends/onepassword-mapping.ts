/**
 * tiny-agents kinds ↔ 1Password item categories and fields (issue #56).
 *
 * | kind     | category       | fields                                                      |
 * | -------- | -------------- | ----------------------------------------------------------- |
 * | login    | LOGIN          | purpose USERNAME / PASSWORD / NOTES, an OTP field, urls[]   |
 * | card     | CREDIT_CARD    | ccnum, expiry (MONTH_YEAR), cvv, cardholder, type, address  |
 * | identity | IDENTITY       | firstname/lastname, email, phone, address                   |
 * | api_key  | API_CREDENTIAL | credential (CONCEALED), username, hostname                  |
 *
 * The Connect reference does not list the CREDIT_CARD / IDENTITY template
 * field ids; the ids here are 1Password's template ids as returned by
 * `GET …/items/{id}` for items made in the 1Password apps, with a label
 * fallback, and are pinned in tests. Edits rewrite the whole item Connect
 * returned, so fields
 * this mapping does not model survive.
 */
import type { VaultKind } from "@tiny-agents/agent";
import { cardBrand } from "./local";
import type { BackendItemSummary, ItemDraft, ValueField } from "./types";

export interface ConnectField {
  id: string;
  type?: string;
  purpose?: "USERNAME" | "PASSWORD" | "NOTES" | string;
  label?: string;
  value?: string;
  totp?: string;
  section?: { id: string };
}

export interface ConnectItem {
  id?: string;
  title: string;
  category: string;
  vault: { id: string };
  urls?: { href: string; primary?: boolean; label?: string }[];
  fields?: ConnectField[];
  sections?: { id: string; label?: string }[];
  tags?: string[];
  updatedAt?: string;
}

const CATEGORY: Record<VaultKind, string> = {
  login: "LOGIN",
  card: "CREDIT_CARD",
  identity: "IDENTITY",
  api_key: "API_CREDENTIAL",
};

function kindOfCategory(category: string): VaultKind | "other" {
  switch (category) {
    case "LOGIN":
    case "PASSWORD":
      return "login";
    case "CREDIT_CARD":
      return "card";
    case "IDENTITY":
      return "identity";
    case "API_CREDENTIAL":
      return "api_key";
    default:
      return "other";
  }
}

/** How to find (and create) each value field of a kind. */
interface FieldSpec {
  id: string;
  type: string;
  purpose?: string;
  label: string;
  /** Matches an existing field by label when its id differs. */
  labelPattern?: RegExp;
}

const FIELDS: Record<VaultKind, Partial<Record<ValueField, FieldSpec>>> = {
  login: {
    username: { id: "username", type: "STRING", purpose: "USERNAME", label: "username" },
    password: { id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password" },
    notes: { id: "notesPlain", type: "STRING", purpose: "NOTES", label: "notesPlain" },
    totp: {
      id: "totp",
      type: "OTP",
      label: "one-time password",
      labelPattern: /one.?time|otp|totp/i,
    },
  },
  card: {
    card_holder: {
      id: "cardholder",
      type: "STRING",
      label: "cardholder name",
      labelPattern: /holder|name on card/i,
    },
    card_number: {
      id: "ccnum",
      type: "CONCEALED",
      label: "number",
      labelPattern: /^number$|card number/i,
    },
    card_expiry: { id: "expiry", type: "MONTH_YEAR", label: "expiry date", labelPattern: /expir/i },
    card_cvc: {
      id: "cvv",
      type: "CONCEALED",
      label: "verification number",
      labelPattern: /cvv|cvc|verification|security code/i,
    },
    card_billing_address: {
      id: "address",
      type: "STRING",
      label: "billing address",
      labelPattern: /billing|address/i,
    },
    notes: { id: "notesPlain", type: "STRING", purpose: "NOTES", label: "notesPlain" },
  },
  identity: {
    identity_name: {
      id: "firstname",
      type: "STRING",
      label: "first name",
      labelPattern: /^(first )?name$/i,
    },
    identity_email: { id: "email", type: "EMAIL", label: "email", labelPattern: /e-?mail/i },
    identity_phone: { id: "defphone", type: "STRING", label: "phone", labelPattern: /phone/i },
    identity_address: { id: "address", type: "STRING", label: "address", labelPattern: /address/i },
    notes: { id: "notesPlain", type: "STRING", purpose: "NOTES", label: "notesPlain" },
  },
  api_key: {
    value: {
      id: "credential",
      type: "CONCEALED",
      label: "credential",
      labelPattern: /credential|api.?key|token|secret/i,
    },
    username: { id: "username", type: "STRING", label: "username" },
    notes: { id: "notesPlain", type: "STRING", purpose: "NOTES", label: "notesPlain" },
  },
};

/** The item's field for `field`, if it has one. */
export function findField(item: ConnectItem, field: ValueField): ConnectField | undefined {
  const kind = kindOfCategory(item.category);
  if (kind === "other") return undefined;
  const fields = item.fields ?? [];
  if (kind === "login" && field === "totp") return fields.find((f) => f.type === "OTP");
  if (kind === "login" && item.category === "PASSWORD" && field === "password") {
    return fields.find((f) => f.purpose === "PASSWORD" || f.type === "CONCEALED");
  }
  const spec = FIELDS[kind][field];
  if (!spec) return undefined;
  return (
    (spec.purpose ? fields.find((f) => f.purpose === spec.purpose) : undefined) ??
    fields.find((f) => f.id === spec.id) ??
    (spec.labelPattern
      ? fields.find((f) => f.label && spec.labelPattern!.test(f.label))
      : undefined)
  );
}

/** 1Password stores MONTH_YEAR as YYYYMM; the vault speaks MM/YYYY. */
export function expiryFromConnect(value: string): string {
  const compact = value.match(/^(\d{4})(\d{2})$/);
  if (compact) return `${compact[2]}/${compact[1]}`;
  const slash = value.match(/^(\d{1,2})\s*\/\s*(\d{2,4})$/);
  if (slash) {
    const year = slash[2].length === 2 ? `20${slash[2]}` : slash[2];
    return `${slash[1].padStart(2, "0")}/${year}`;
  }
  return value;
}

export function expiryToConnect(value: string): string {
  const normalized = expiryFromConnect(value);
  const match = normalized.match(/^(\d{2})\/(\d{4})$/);
  return match ? `${match[2]}${match[1]}` : value;
}

/** Metadata only: never a secret value (username and card last4/expiry are display data). */
export function summarize(item: ConnectItem): BackendItemSummary {
  const kind = kindOfCategory(item.category);
  const fields: ValueField[] = [];
  if (kind !== "other") {
    for (const field of Object.keys(FIELDS[kind]) as ValueField[]) {
      if (findField(item, field)?.value) fields.push(field);
    }
  }
  const number = kind === "card" ? findField(item, "card_number")?.value : undefined;
  const expiry = kind === "card" ? findField(item, "card_expiry")?.value : undefined;
  const brand = kind === "card" ? item.fields?.find((f) => f.id === "type")?.value : undefined;
  return {
    externalId: item.id ?? "",
    title: item.title,
    kind,
    urls: (item.urls ?? []).map((url) => url.href).filter(Boolean),
    ...(kind === "login" || kind === "api_key"
      ? { username: findField(item, "username")?.value || undefined }
      : {}),
    ...(number
      ? {
          card: {
            brand: brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : cardBrand(number),
            last4: number.replace(/\D/g, "").slice(-4),
            expiry: expiry ? expiryFromConnect(expiry) : "",
          },
        }
      : {}),
    hasTotp: kind === "login" && Boolean(findField(item, "totp")?.value),
    fields,
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  };
}

function toConnectValue(field: ValueField, value: string): string {
  if (field === "card_expiry") return expiryToConnect(value);
  if (field === "card_number") return value.replace(/[\s-]/g, "");
  return value;
}

export function fromConnectValue(field: ValueField, value: string): string {
  return field === "card_expiry" ? expiryFromConnect(value) : value;
}

/** A new Connect item for a draft, pinned to `vaultId`. */
export function toConnectItem(draft: ItemDraft, vaultId: string): ConnectItem {
  const specs = FIELDS[draft.kind];
  const fields: ConnectField[] = [];
  for (const [field, value] of Object.entries(draft.values) as [ValueField, string][]) {
    const spec = specs[field];
    if (!spec || value === undefined || value === "") continue;
    fields.push({
      id: spec.id,
      type: spec.type,
      ...(spec.purpose ? { purpose: spec.purpose } : {}),
      label: spec.label,
      value: toConnectValue(field, value),
    });
  }
  if (draft.kind === "card" && draft.values.card_number) {
    fields.push({
      id: "type",
      type: "STRING",
      label: "type",
      value: cardBrand(draft.values.card_number).toLowerCase(),
    });
  }
  return {
    title: draft.title,
    category: CATEGORY[draft.kind],
    vault: { id: vaultId },
    ...(draft.urls?.length
      ? {
          urls: draft.urls.map((href, index) => ({
            href,
            ...(index === 0 ? { primary: true } : {}),
          })),
        }
      : {}),
    fields,
    tags: ["tiny-agents"],
  };
}

/**
 * `item` with the draft's values set (fields the draft doesn't name are kept,
 * missing ones added): the body of a full PUT.
 */
export function applyDraft(item: ConnectItem, draft: Partial<ItemDraft>): ConnectItem {
  const kind = kindOfCategory(item.category);
  const next: ConnectItem = structuredClone(item);
  if (draft.title !== undefined) next.title = draft.title;
  if (draft.urls !== undefined) {
    next.urls = draft.urls.map((href, index) => ({
      href,
      ...(index === 0 ? { primary: true } : {}),
    }));
  }
  if (kind === "other") return next;
  next.fields = next.fields ?? [];
  for (const [field, value] of Object.entries(draft.values ?? {}) as [ValueField, string][]) {
    if (value === undefined) continue;
    const existing = findField(next, field);
    if (existing) {
      existing.value = toConnectValue(field, value);
      continue;
    }
    const spec = FIELDS[kind][field];
    if (!spec || value === "") continue;
    next.fields.push({
      id: spec.id,
      type: spec.type,
      ...(spec.purpose ? { purpose: spec.purpose } : {}),
      label: spec.label,
      value: toConnectValue(field, value),
    });
  }
  return next;
}
