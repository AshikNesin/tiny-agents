import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@groot/shell/lib/api";
import type { AppSetting } from "@groot/core/settings/app-settings.schema";

export type { AppSetting };

export const APP_SETTINGS_KEY = ["app-settings"] as const;

const settingPath = (key: string) => `/settings/${encodeURIComponent(key)}`;

export function useAppSettingsData() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: APP_SETTINGS_KEY,
    queryFn: () => apiClient.get<AppSetting[]>("/settings"),
  });
  const settings = query.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: APP_SETTINGS_KEY });

  const get = (key: string): AppSetting | null => settings.find((s) => s.key === key) ?? null;

  const save = async (key: string, value: unknown, description?: string): Promise<AppSetting> => {
    const saved = await apiClient.put<AppSetting>(settingPath(key), {
      value,
      metadata: { description },
    });
    await refresh();
    return saved;
  };

  const create = async (
    key: string,
    value: unknown = {},
    description?: string,
  ): Promise<AppSetting> => {
    const trimmed = key.trim();
    if (!trimmed) throw new Error("Key is required");
    const known = queryClient.getQueryData<AppSetting[]>(APP_SETTINGS_KEY) ?? settings;
    if (known.some((s) => s.key === trimmed)) {
      throw new Error(`A setting named “${trimmed}” already exists.`);
    }
    const created = await apiClient.post<AppSetting>("/settings", {
      key: trimmed,
      value,
      metadata: { description },
    });
    await refresh();
    return created;
  };

  const remove = async (key: string): Promise<void> => {
    await apiClient.delete(settingPath(key));
    await refresh();
  };

  return {
    settings,
    isLoading: query.isLoading,
    isError: query.isError,
    refresh,
    get,
    save,
    create,
    remove,
  };
}
