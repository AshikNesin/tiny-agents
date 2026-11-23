import { randomUUID } from "node:crypto";
import {
  ItemCategory,
  ItemFieldType,
  ItemState,
  VaultType,
  type Item,
  type ItemField,
  type VaultOverview,
} from "@1password/sdk";
import type {
  OnePasswordClient,
  OnePasswordConnector,
} from "../../../../apps/web/src/server/api/vault/backends/onepassword";
import { FIXED_NOW } from "../../../test-clock";

export interface FakeOnePassword {
  connect: OnePasswordConnector;
  items: Map<string, Item>;
  tokens: Map<string, { vaults: string[]; write: boolean }>;
  vaults: { id: string; title: string }[];
  calls: { op: string; token: string; vaultId?: string }[];
  refuseCreate?: string;
  unavailable: { calls: number };
}

export function opItem(
  partial: Pick<Item, "id" | "title"> &
    Partial<Omit<Item, "fields">> & { fields?: Partial<ItemField>[] },
): Item {
  const at = new Date(FIXED_NOW);
  return {
    category: ItemCategory.Login,
    vaultId: "vault-agents",
    sections: [],
    notes: "",
    tags: [],
    websites: [],
    version: 1,
    files: [],
    createdAt: at,
    updatedAt: at,
    ...partial,
    fields: (partial.fields ?? []).map((field) => ({
      id: field.id ?? randomUUID(),
      title: field.title ?? field.id ?? "",
      fieldType: field.fieldType ?? ItemFieldType.Text,
      value: field.value ?? "",
      ...(field.sectionId ? { sectionId: field.sectionId } : {}),
      ...(field.details ? { details: field.details } : {}),
    })),
  };
}

function vaultOverview(vault: { id: string; title: string }): VaultOverview {
  const at = new Date(FIXED_NOW);
  return {
    ...vault,
    description: "",
    vaultType: VaultType.UserCreated,
    activeItemCount: 0,
    contentVersion: 1,
    attributeVersion: 1,
    createdAt: at,
    updatedAt: at,
  };
}

export function createFakeOnePassword(): FakeOnePassword {
  const fake: FakeOnePassword = {
    items: new Map(),
    tokens: new Map(),
    vaults: [
      { id: "vault-agents", title: "tiny-agents" },
      { id: "vault-other", title: "Family" },
    ],
    calls: [],
    unavailable: { calls: 0 },
    connect: async (token) => {
      const grant = fake.tokens.get(token);
      if (!grant) {
        throw new Error(
          "invalid service account token, please make sure you provide a valid service account token as parameter",
        );
      }
      const gate = async (op: string, vaultId?: string, write = false) => {
        if (fake.unavailable.calls > 0) {
          fake.unavailable.calls -= 1;
          throw new Error("error sending request: connection refused");
        }
        fake.calls.push({ op, token, ...(vaultId ? { vaultId } : {}) });
        if (vaultId && !grant.vaults.includes(vaultId)) {
          throw new Error("You don't have the right permissions to execute this request");
        }
        if (write && !grant.write) {
          throw new Error("You don't have the right permissions to execute this request");
        }
      };
      const client: OnePasswordClient = {
        vaults: {
          list: async () => {
            await gate("vaults.list");
            return fake.vaults.filter((v) => grant.vaults.includes(v.id)).map(vaultOverview);
          },
        },
        items: {
          list: async (vaultId) => {
            await gate("items.list", vaultId);
            return [...fake.items.values()]
              .filter((item) => item.vaultId === vaultId)
              .map(({ fields: _f, sections: _s, notes: _n, version: _v, files: _x, ...rest }) => ({
                ...rest,
                state: ItemState.Active,
              }));
          },
          get: async (vaultId, itemId) => {
            await gate("items.get", vaultId);
            const item = fake.items.get(itemId);
            if (!item) throw new Error("item not found");
            return structuredClone(item);
          },
          create: async (params) => {
            await gate("items.create", params.vaultId, true);
            if (fake.refuseCreate) throw new Error(fake.refuseCreate);
            const { files: _files, document: _document, ...rest } = params;
            const item = opItem({ ...rest, id: randomUUID() });
            fake.items.set(item.id, item);
            return structuredClone(item);
          },
          put: async (item) => {
            await gate("items.put", item.vaultId, true);
            if (!fake.items.has(item.id)) throw new Error("item not found");
            const next = { ...structuredClone(item), version: item.version + 1 };
            fake.items.set(item.id, next);
            return structuredClone(next);
          },
          delete: async (vaultId, itemId) => {
            await gate("items.delete", vaultId, true);
            fake.items.delete(itemId);
          },
        },
      };
      return client;
    },
  };
  return fake;
}
