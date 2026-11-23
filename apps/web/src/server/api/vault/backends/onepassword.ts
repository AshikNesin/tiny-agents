import {
  AuthExpiredError,
  RateLimitExceededError,
  createClient,
  type Item,
  type ItemCreateParams,
  type ItemOverview,
  type VaultOverview,
} from "@1password/sdk";
import { SecretValue } from "@tiny-agents/agent";
import { parseTotp, totpCode } from "../vault.totp";
import { applyDraft, fieldValue, otpOf, summarize, toCreateParams } from "./onepassword-mapping";
import {
  BackendError,
  type BackendStatus,
  type ItemDraft,
  type ValueField,
  type VaultBackend,
} from "./types";

export interface OnePasswordClient {
  vaults: { list(): Promise<VaultOverview[]> };
  items: {
    list(vaultId: string): Promise<ItemOverview[]>;
    get(vaultId: string, itemId: string): Promise<Item>;
    create(params: ItemCreateParams): Promise<Item>;
    put(item: Item): Promise<Item>;
    delete(vaultId: string, itemId: string): Promise<void>;
  };
}

export type OnePasswordConnector = (token: string) => Promise<OnePasswordClient>;

export interface OnePasswordOptions {
  token: string;
  vaultId?: string;
  writable: boolean;
  connect?: OnePasswordConnector;
  timeoutMs?: number;
}

const GUARD_TTL_MS = 6 * 60 * 60_000;

const sdkConnector: OnePasswordConnector = (token) =>
  createClient({ auth: token, integrationName: "tiny-agents", integrationVersion: "v1" });

function classify(error: unknown): BackendError["code"] {
  if (error instanceof BackendError) return error.code;
  if (error instanceof AuthExpiredError) return "unauthorized";
  if (error instanceof RateLimitExceededError) return "failed";
  const message = error instanceof Error ? error.message : String(error);
  if (/rate limit|too many requests|\b429\b/i.test(message)) return "failed";
  if (/not found|doesn'?t exist|does not exist|\b404\b/i.test(message)) return "not_found";
  if (
    /token|unauthori[sz]ed|authenticat|forbidden|permission|access denied|\b40[13]\b/i.test(message)
  ) {
    return "unauthorized";
  }
  if (
    /network|connection|dns|timed? ?out|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|unreachable|\b50[234]\b/i.test(
      message,
    )
  ) {
    return "unreachable";
  }
  return "failed";
}

function sdkMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim().replace(/\.$/, "") || "no details";
}

function toBackendError(error: unknown, step?: string): BackendError {
  if (error instanceof BackendError) return error;
  const code = classify(error);
  const message = sdkMessage(error);
  switch (code) {
    case "unauthorized":
      return new BackendError(
        "unauthorized",
        `1Password refused the service account token (revoked, expired or without access): ${message}.`,
      );
    case "unreachable":
      return new BackendError("unreachable", `1Password is unreachable: ${message}.`);
    case "not_found":
      return step
        ? new BackendError("failed", `1Password couldn't ${step}: ${message}.`)
        : new BackendError("not_found", "Item not found in 1Password.");
    default:
      return new BackendError(
        "failed",
        step ? `1Password couldn't ${step}: ${message}.` : `1Password answered: ${message}.`,
      );
  }
}

export function createOnePasswordBackend(options: OnePasswordOptions): VaultBackend {
  const connect = options.connect ?? sdkConnector;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let client: Promise<OnePasswordClient> | undefined;
  let guard: { at: number; status: BackendStatus; vaultId?: string } | undefined;

  const forgetFailedSignIn = () => {
    client = undefined;
  };

  async function withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new BackendError("unreachable", "1Password did not answer in time.")),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  function sdk(): Promise<OnePasswordClient> {
    if (!client) {
      client = connect(options.token);
      client.catch(forgetFailedSignIn);
    }
    return client;
  }

  async function call<T>(run: (op: OnePasswordClient) => Promise<T>, step?: string): Promise<T> {
    try {
      return await withTimeout(sdk().then(run));
    } catch (error) {
      throw toBackendError(error, step);
    }
  }

  async function checkScope(): Promise<{ status: BackendStatus; vaultId?: string }> {
    if (!options.token) {
      return { status: { state: "unconfigured", detail: "Set the service account token." } };
    }
    try {
      const vaults = await call((op) => op.vaults.list());
      const pin = options.vaultId ?? (vaults.length === 1 ? vaults[0]!.id : undefined);
      const extra = vaults.filter((v) => v.id !== pin);
      const pinned = vaults.find((v) => v.id === pin);
      if (!pinned || extra.length > 0) {
        const names = extra.map((v) => v.title || v.id).join(", ");
        return {
          status: {
            state: "error",
            code: "token_overscoped",
            detail: !pinned
              ? options.vaultId
                ? "The token cannot see the pinned vault."
                : `The token must see exactly one vault; it sees ${vaults.length}.`
              : `The token can see vaults besides the pinned one (${names}); every use is refused.`,
          },
        };
      }
      return {
        status: { state: "ready", detail: `Vault "${pinned.title || pinned.id}".` },
        vaultId: pinned.id,
      };
    } catch (error) {
      const failure = toBackendError(error);
      return { status: { state: "error", code: failure.code, detail: failure.message } };
    }
  }

  async function status(force = false): Promise<BackendStatus> {
    if (!force && guard && Date.now() - guard.at < GUARD_TTL_MS && guard.status.state === "ready") {
      return guard.status;
    }
    guard = { at: Date.now(), ...(await checkScope()) };
    return guard.status;
  }

  async function ready(): Promise<string> {
    const current = await status();
    if (current.state === "ready" && guard?.vaultId) return guard.vaultId;
    throw new BackendError(
      current.code === "token_overscoped" ? "token_overscoped" : "unconfigured",
      current.detail ?? "The vault backend is not ready.",
    );
  }

  async function getItem(externalId: string): Promise<{ item: Item; vaultId: string }> {
    const vaultId = await ready();
    const item = await call((op) => op.items.get(vaultId, externalId));
    if (item.vaultId !== vaultId) {
      throw new BackendError("not_found", "Item not found in the pinned vault.");
    }
    return { item, vaultId };
  }

  const backend: VaultBackend = {
    name: "onepassword",
    capabilities: {
      create: options.writable,
      update: options.writable,
      delete: options.writable,
      reveal: true,
    },
    status: () => status(true),
    async listCandidates() {
      const vaultId = await ready();
      const items = await call((op) => op.items.list(vaultId));
      return {
        items: items.filter((item) => item.vaultId === vaultId).map((item) => summarize(item)),
        unreadable: [],
      };
    },
    async describe(externalId) {
      return summarize((await getItem(externalId)).item);
    },
    async resolve(externalId: string, field: ValueField): Promise<SecretValue> {
      const { item } = await getItem(externalId);
      if (field === "totp") {
        const otp = otpOf(item);
        if (otp.code) return new SecretValue(otp.code);
        const spec = otp.seed ? parseTotp(otp.seed) : undefined;
        if (spec) return new SecretValue(totpCode(spec));
        throw new BackendError("missing_field", "The item has no one-time password.");
      }
      const value = fieldValue(item, field);
      if (!value) throw new BackendError("missing_field", `The item has no ${field}.`);
      return new SecretValue(value);
    },
  };

  if (options.writable) {
    backend.create = async (draft: ItemDraft) => {
      const vaultId = await ready();
      const item = await call(
        (op) => op.items.create(toCreateParams(draft, vaultId)),
        "save the item",
      );
      if (!item.id) throw new BackendError("failed", "1Password did not return the new item.");
      return item.id;
    };
    backend.update = async (externalId, draft) => {
      const { item } = await getItem(externalId);
      await call((op) => op.items.put(applyDraft(item, draft)), "save the change");
    };
    backend.remove = async (externalId) => {
      const { vaultId } = await getItem(externalId);
      await call((op) => op.items.delete(vaultId, externalId), "delete the item");
    };
  }
  return backend;
}
