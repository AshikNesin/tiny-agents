import {
  AutofillBehavior,
  ItemCategory,
  ItemFieldType,
  type Item,
  type ItemCreateParams,
  type ItemField,
  type ItemSection,
  type Website,
} from "@1password/sdk";
import type { VaultKind } from "@tiny-agents/agent";
import { cardBrand } from "./local";
import type { BackendItemSummary, ItemDraft, ValueField } from "./types";

export type OnePasswordItem = Pick<Item, "id" | "title" | "category" | "vaultId"> &
  Partial<Pick<Item, "fields" | "sections" | "notes" | "tags" | "websites" | "updatedAt">>;

const CATEGORY: Record<VaultKind, ItemCategory> = {
  login: ItemCategory.Login,
  card: ItemCategory.CreditCard,
  identity: ItemCategory.Identity,
  api_key: ItemCategory.ApiCredentials,
};

const OTP_SECTION: ItemSection = { id: "tiny-agents", title: "tiny-agents" };

function kindOfCategory(category: ItemCategory): VaultKind | "other" {
  switch (category) {
    case ItemCategory.Login:
    case ItemCategory.Password:
      return "login";
    case ItemCategory.CreditCard:
      return "card";
    case ItemCategory.Identity:
      return "identity";
    case ItemCategory.ApiCredentials:
      return "api_key";
    default:
      return "other";
  }
}

interface FieldSpec {
  id: string;
  type: ItemFieldType;
  title: string;
  titlePattern?: RegExp;
  sectionId?: string;
}

type FieldSpecs = Partial<Record<Exclude<ValueField, "notes">, FieldSpec>>;

const FIELDS: Record<VaultKind, FieldSpecs> = {
  login: {
    username: {
      id: "username",
      type: ItemFieldType.Text,
      title: "username",
      titlePattern: /^(user ?name|login|e-?mail)$/i,
    },
    password: { id: "password", type: ItemFieldType.Concealed, title: "password" },
    totp: {
      id: "onetimepassword",
      type: ItemFieldType.Totp,
      title: "one-time password",
      sectionId: OTP_SECTION.id,
    },
  },
  card: {
    card_holder: {
      id: "cardholder",
      type: ItemFieldType.Text,
      title: "cardholder name",
      titlePattern: /holder|name on card/i,
    },
    card_number: {
      id: "ccnum",
      type: ItemFieldType.CreditCardNumber,
      title: "number",
      titlePattern: /^number$|card number/i,
    },
    card_expiry: {
      id: "expiry",
      type: ItemFieldType.MonthYear,
      title: "expiry date",
      titlePattern: /expir/i,
    },
    card_cvc: {
      id: "cvv",
      type: ItemFieldType.Concealed,
      title: "verification number",
      titlePattern: /cvv|cvc|verification|security code/i,
    },
    card_billing_address: {
      id: "address",
      type: ItemFieldType.Text,
      title: "billing address",
      titlePattern: /billing|address/i,
    },
  },
  identity: {
    identity_name: {
      id: "firstname",
      type: ItemFieldType.Text,
      title: "first name",
      titlePattern: /^(first )?name$/i,
    },
    identity_email: {
      id: "email",
      type: ItemFieldType.Email,
      title: "email",
      titlePattern: /e-?mail/i,
    },
    identity_phone: {
      id: "defphone",
      type: ItemFieldType.Phone,
      title: "phone",
      titlePattern: /phone/i,
    },
    identity_address: {
      id: "address",
      type: ItemFieldType.Text,
      title: "address",
      titlePattern: /address/i,
    },
  },
  api_key: {
    value: {
      id: "credential",
      type: ItemFieldType.Concealed,
      title: "credential",
      titlePattern: /credential|api.?key|token|secret/i,
    },
    username: { id: "username", type: ItemFieldType.Text, title: "username" },
  },
};

function kindFields(kind: VaultKind): ValueField[] {
  return [...(Object.keys(FIELDS[kind]) as ValueField[]), "notes"];
}

function findField(item: OnePasswordItem, field: ValueField): ItemField | undefined {
  const kind = kindOfCategory(item.category);
  if (kind === "other" || field === "notes") return undefined;
  const fields = item.fields ?? [];
  if (kind === "login" && field === "totp") {
    return fields.find((f) => f.fieldType === ItemFieldType.Totp);
  }
  const spec = FIELDS[kind][field];
  if (!spec) return undefined;
  return (
    fields.find((f) => f.id === spec.id) ??
    (spec.titlePattern ? fields.find((f) => spec.titlePattern!.test(f.title)) : undefined) ??
    (kind === "login" && field === "password"
      ? fields.find((f) => f.fieldType === ItemFieldType.Concealed)
      : undefined)
  );
}

function addressText(field: ItemField): string {
  if (field.details?.type !== "Address" || !field.details.content) return field.value;
  const { street, city, state, zip, country } = field.details.content;
  return [street, city, [state, zip].filter(Boolean).join(" "), country].filter(Boolean).join(", ");
}

export function fieldValue(item: OnePasswordItem, field: ValueField): string | undefined {
  if (field === "notes") {
    return kindOfCategory(item.category) === "other" ? undefined : item.notes || undefined;
  }
  const found = findField(item, field);
  if (!found) return undefined;
  const raw = found.fieldType === ItemFieldType.Address ? addressText(found) : found.value;
  return raw ? fromOnePasswordValue(field, raw) : undefined;
}

export function otpOf(item: OnePasswordItem): { seed?: string; code?: string } {
  const found = findField(item, "totp");
  if (!found) return {};
  const code = found.details?.type === "Otp" ? found.details.content.code : undefined;
  return { ...(found.value ? { seed: found.value } : {}), ...(code ? { code } : {}) };
}

export function normalizeExpiry(value: string): string {
  const compact = value.match(/^(\d{4})(\d{2})$/);
  if (compact) return `${compact[2]}/${compact[1]}`;
  const slash = value.match(/^(\d{1,2})\s*\/\s*(\d{2,4})$/);
  if (slash) {
    const year = slash[2].length === 2 ? `20${slash[2]}` : slash[2];
    return `${slash[1].padStart(2, "0")}/${year}`;
  }
  return value;
}

function toOnePasswordValue(field: ValueField, value: string): string {
  if (field === "card_expiry") return normalizeExpiry(value);
  if (field === "card_number") return value.replace(/[\s-]/g, "");
  return value;
}

function fromOnePasswordValue(field: ValueField, value: string): string {
  return field === "card_expiry" ? normalizeExpiry(value) : value;
}

export function summarize(item: OnePasswordItem): BackendItemSummary {
  const kind = kindOfCategory(item.category);
  const fields: ValueField[] =
    kind === "other" ? [] : kindFields(kind).filter((field) => fieldValue(item, field));
  const number = kind === "card" ? fieldValue(item, "card_number") : undefined;
  const expiry = kind === "card" ? fieldValue(item, "card_expiry") : undefined;
  const brand =
    kind === "card"
      ? item.fields?.find((f) => f.fieldType === ItemFieldType.CreditCardType || f.id === "type")
          ?.value
      : undefined;
  return {
    externalId: item.id,
    title: item.title,
    kind,
    urls: (item.websites ?? []).map((site) => site.url).filter(Boolean),
    ...(kind === "login" || kind === "api_key"
      ? { username: fieldValue(item, "username") || undefined }
      : {}),
    ...(number
      ? {
          card: {
            brand: brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : cardBrand(number),
            last4: number.replace(/\D/g, "").slice(-4),
            expiry: expiry ?? "",
          },
        }
      : {}),
    hasTotp: kind === "login" && Boolean(findField(item, "totp")?.value),
    fields,
    ...(item.updatedAt ? { updatedAt: new Date(item.updatedAt).toISOString() } : {}),
  };
}

function newField(spec: FieldSpec, field: ValueField, value: string): ItemField {
  return {
    id: spec.id,
    title: spec.title,
    fieldType: spec.type,
    value: toOnePasswordValue(field, value),
    ...(spec.sectionId ? { sectionId: spec.sectionId } : {}),
  };
}

function websites(urls: string[]): Website[] {
  return urls.map((url) => ({
    url,
    label: "website",
    autofillBehavior: AutofillBehavior.AnywhereOnWebsite,
  }));
}

function takesWebsites(category: ItemCategory): boolean {
  return category === ItemCategory.Login || category === ItemCategory.Password;
}

export function toCreateParams(draft: ItemDraft, vaultId: string): ItemCreateParams {
  const specs = FIELDS[draft.kind];
  const fields: ItemField[] = [];
  for (const [field, value] of Object.entries(draft.values) as [ValueField, string][]) {
    if (field === "notes" || value === undefined || value === "") continue;
    const spec = specs[field];
    if (spec) fields.push(newField(spec, field, value));
  }
  const category = CATEGORY[draft.kind];
  return {
    category,
    vaultId,
    title: draft.title,
    fields,
    ...(fields.some((f) => f.sectionId === OTP_SECTION.id) ? { sections: [OTP_SECTION] } : {}),
    ...(draft.values.notes ? { notes: draft.values.notes } : {}),
    ...(draft.urls?.length && takesWebsites(category) ? { websites: websites(draft.urls) } : {}),
    tags: ["tiny-agents"],
  };
}

function setFieldValue(existing: ItemField, field: ValueField, value: string): void {
  if (existing.fieldType === ItemFieldType.Address) {
    existing.details = {
      type: "Address",
      content: { street: value, city: "", state: "", zip: "", country: "" },
    };
    return;
  }
  existing.value = toOnePasswordValue(field, value);
}

export function applyDraft(item: Item, draft: Partial<ItemDraft>): Item {
  const kind = kindOfCategory(item.category);
  const next: Item = structuredClone(item);
  if (draft.title !== undefined) next.title = draft.title;
  if (draft.urls !== undefined && takesWebsites(next.category)) {
    next.websites = websites(draft.urls);
  }
  if (kind === "other") return next;
  for (const [field, value] of Object.entries(draft.values ?? {}) as [ValueField, string][]) {
    if (value === undefined) continue;
    if (field === "notes") {
      next.notes = value;
      continue;
    }
    const existing = findField(next, field);
    if (existing) {
      setFieldValue(existing, field, value);
      continue;
    }
    const spec = FIELDS[kind][field];
    if (!spec || value === "") continue;
    next.fields.push(newField(spec, field, value));
    if (spec.sectionId === OTP_SECTION.id && !next.sections.some((s) => s.id === OTP_SECTION.id)) {
      next.sections.push(OTP_SECTION);
    }
  }
  return next;
}
