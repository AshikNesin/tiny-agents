import { loadEnv, type Env, type EnvSource } from "./env";
import { setConfig, config, type ConfigOverrides } from "./config";
import { configureLogger } from "./logger";
import { setDb, type Database } from "./database";
import { setStorageAdapter } from "./storage/storage";
import type { StorageAdapter } from "./storage/adapter";
import { setErrorReporter, type ErrorReporter } from "./errors";

export interface BootstrapOptions {
  env: EnvSource;
  config?: ConfigOverrides;
  db: Database | ((env: Env) => Database);
  storage?: StorageAdapter | ((env: Env) => StorageAdapter);
  reportError?: ErrorReporter;
}

export function bootstrap(options: BootstrapOptions): void {
  const env = loadEnv(options.env);
  setConfig(options.config);
  configureLogger({
    level: config.logging.level,
    pretty: env.NODE_ENV !== "production",
    base: { service: config.app.name.toLowerCase(), env: env.NODE_ENV },
  });
  setDb(typeof options.db === "function" ? options.db(env) : options.db);
  if (options.storage) {
    setStorageAdapter(
      typeof options.storage === "function" ? options.storage(env) : options.storage,
    );
  }
  if (options.reportError) setErrorReporter(options.reportError);
}
