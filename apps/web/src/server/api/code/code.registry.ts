/**
 * Which harnesses this server runs (ADR 0011). Adding a harness is one
 * driver in `@tiny-agents/code` and one entry here, read from config:
 *
 * - `shelley`: the owner's Shelley, when `SHELLEY_URL` is set (ADR 0009).
 * - `claude-code`: Claude Code on the sandbox, through the Claude worker's
 *   coding mode, when `CLAUDE_CODE_ENGINE_ENABLED` is on and a sandbox is
 *   configured (ADR 0010, ADR 0012).
 */
import { logger } from "@groot/core/logger";
import {
  createShelleyHarness,
  shelley,
  type HarnessHost,
  type HarnessInstance,
} from "@tiny-agents/code/server";
import { appEnv } from "../../env";
import { threadIndex } from "./code.store";

type Env = Readonly<Record<string, string | undefined>>;

export function harnessHost(): HarnessHost {
  return {
    logger: {
      info: (message, fields) => logger.info(fields ?? {}, message),
      warn: (message, fields) => logger.warn(fields ?? {}, message),
      error: (message, fields) => logger.error(fields ?? {}, message),
    },
    index: threadIndex,
    now: () => new Date(),
  };
}

/** Shelley's base URL, or undefined when `SHELLEY_URL` is not set. */
export function shelleyUrl(env: Env = process.env): string | undefined {
  return shelley.trimUrl(appEnv(env).SHELLEY_URL);
}

export interface RegistryOptions {
  env?: Env;
  host?: HarnessHost;
  /** Extra instances (tests, or the Claude Code harness the boot builds). */
  extra?: HarnessInstance[];
}

export function buildHarnesses(options: RegistryOptions = {}): HarnessInstance[] {
  const env = options.env ?? process.env;
  const host = options.host ?? harnessHost();
  const instances: HarnessInstance[] = [];
  const url = shelleyUrl(env);
  if (url) instances.push(createShelleyHarness({ url, host }));
  instances.push(...(options.extra ?? []));
  return instances;
}
