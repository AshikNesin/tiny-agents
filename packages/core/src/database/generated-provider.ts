/**
 * The datasource provider the generated Prisma client was built for.
 *
 * `prisma generate` bakes the schema's `datasource db { provider = ... }`
 * value into the emitted client config. Prisma exports no public read for
 * it, so this module reports the checkout's engine for TESTS via the
 * documented `__internal.configOverride` hook: the hook runs before the
 * driver-adapter requirement, hands us the config object, and the throwaway
 * construction then throws for lacking an adapter — after the value was
 * captured, and without connecting to anything.
 *
 * The boot path does not use this module: client.ts reads the provider
 * inside the real construction's configOverride, which works in dev source
 * and inside the production bundle alike, where no filesystem path into the
 * generated sources is guaranteed to exist.
 */
import { PrismaClient } from "../../generated/prisma/client";

let captured: string | undefined;

type ProbeOptions = {
  __internal?: {
    configOverride?: (config: { activeProvider?: string }) => { activeProvider?: string };
  };
};

const ProbeClient = PrismaClient as unknown as new (options: ProbeOptions) => PrismaClient;

try {
  new ProbeClient({
    __internal: {
      configOverride: (config) => {
        captured = config.activeProvider;
        return config;
      },
    },
  });
} catch {
  // Expected: the probe carries no adapter. activeProvider was captured
  // before the constructor's adapter check.
}

export const generatedProvider: string = captured ?? "unknown";
