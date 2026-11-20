import { memoryRateLimitStore, type RateLimitStore } from "./store";

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

function isBinding(value: unknown): value is RateLimitBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<RateLimitBinding>).limit === "function"
  );
}

export function cloudflareRateLimitStore(
  bindings: Record<string, unknown>,
  fallback: RateLimitStore = memoryRateLimitStore(),
): RateLimitStore {
  return {
    async hit(key, rule) {
      const binding = rule.binding === undefined ? undefined : bindings[rule.binding];
      if (!isBinding(binding)) return fallback.hit(key, rule);
      const { success } = await binding.limit({ key });
      return { allowed: success };
    },
  };
}
