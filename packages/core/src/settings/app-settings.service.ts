import { Boom } from "../errors";
import { logger } from "../logger";
import { createNamespaceKv } from "../kv";
import type { UpsertAppSettingDTO } from "./app-settings.schema";

const appSettingsKv = createNamespaceKv("APP_SETTING");

export interface AppSettingMetadata {
  description?: string;
  updatedAt: string;
}

export interface AppSetting<T = unknown> {
  key: string;
  value: T;
  metadata?: AppSettingMetadata;
}

export async function get<T = unknown>({ key }: { key: string }): Promise<AppSetting<T>> {
  const setting = await appSettingsKv.get<AppSetting<T>>(key);
  if (!setting) {
    throw Boom.notFound(`App Setting '${key}' not found`);
  }
  return setting;
}

export async function getAll(): Promise<AppSetting[]> {
  const entries = await appSettingsKv.list<AppSetting>();
  return entries.map(({ key, value }) => ({ ...value, key }));
}

export async function upsert<T = unknown>({
  key,
  data,
}: {
  key: string;
  data: UpsertAppSettingDTO;
}): Promise<AppSetting<T>> {
  const setting: AppSetting<T> = {
    key,
    value: data.value as T,
    metadata: { ...data.metadata, updatedAt: new Date().toISOString() },
  };
  await appSettingsKv.set(key, setting);
  logger.info({ key }, "App setting updated");
  return setting;
}

export async function deleteSetting({ key }: { key: string }): Promise<void> {
  const deleted = await appSettingsKv.delete(key);
  if (!deleted) {
    throw Boom.notFound(`App Setting '${key}' not found`);
  }
  logger.info({ key }, "App setting deleted");
}
