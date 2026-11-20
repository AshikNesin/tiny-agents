import { useState } from "react";
import type { AppSetting } from "@groot/core/settings/app-settings.schema";

interface Snapshot {
  json: string;
  description: string;
}

interface DraftState {
  key: string | null;
  base: Snapshot;
  draft: Snapshot;
}

const snapshotOf = (setting: AppSetting | null): Snapshot => ({
  json: setting ? JSON.stringify(setting.value, null, 2) : "",
  description: setting?.metadata?.description ?? "",
});

function sameJson(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return false;
  }
}

const same = (a: Snapshot, b: Snapshot) =>
  a.description === b.description && sameJson(a.json, b.json);

const fresh = (key: string | null, server: Snapshot): DraftState => ({
  key,
  base: server,
  draft: server,
});

export function useSettingDraft(setting: AppSetting | null) {
  const key = setting?.key ?? null;
  const server = snapshotOf(setting);
  const [state, setState] = useState<DraftState>(() => fresh(key, server));

  const isDirty = !same(state.draft, state.base);
  let next: DraftState | null = null;
  if (state.key !== key) {
    next = fresh(key, server);
  } else if (!same(state.base, server)) {
    if (!isDirty || same(state.draft, server)) next = fresh(key, server);
  }
  if (next) setState(next);
  const current = next ?? state;

  const setJsonValue = (json: string) => setState((s) => ({ ...s, draft: { ...s.draft, json } }));
  const setDescription = (description: string) =>
    setState((s) => ({ ...s, draft: { ...s.draft, description } }));

  return {
    jsonValue: current.draft.json,
    setJsonValue,
    description: current.draft.description,
    setDescription,
    isDirty: !same(current.draft, current.base),
    serverChanged: !same(current.base, server),
    discard: () => setState(fresh(key, server)),
    parse: (): unknown => {
      try {
        return JSON.parse(current.draft.json);
      } catch {
        throw new Error("Invalid JSON format");
      }
    },
  };
}
