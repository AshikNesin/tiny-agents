export interface RateLimitRule {
  name: string;
  windowMs: number;
  max: number;
  binding?: string;
}

export interface RateLimitHit {
  allowed: boolean;
  limit?: number;
  remaining?: number;
  resetAt?: number;
}

export interface RateLimitStore {
  hit(key: string, rule: RateLimitRule): Promise<RateLimitHit>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function memoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  const sweep = (now: number) => {
    if (now - lastSweep < 60_000) return;
    lastSweep = now;
    for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id);
  };

  return {
    async hit(key, rule) {
      const now = Date.now();
      sweep(now);
      const id = `${rule.name}\u0000${key}`;
      let bucket = buckets.get(id);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + rule.windowMs };
        buckets.set(id, bucket);
      }
      bucket.count += 1;
      return {
        allowed: bucket.count <= rule.max,
        limit: rule.max,
        remaining: Math.max(0, rule.max - bucket.count),
        resetAt: bucket.resetAt,
      };
    },
  };
}
