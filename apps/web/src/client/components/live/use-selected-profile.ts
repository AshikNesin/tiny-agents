import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

function readSelected(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "shared";
  } catch {
    return "shared";
  }
}

function storeSelected(key: string, profile: string): void {
  try {
    window.localStorage.setItem(key, profile);
  } catch {}
}

export function useSelectedProfile(selectedKey: string, deepLink: boolean) {
  const [searchParams, setSearchParams] = useSearchParams();
  const linked = deepLink ? searchParams.get("profile") : null;
  const [selected, setSelected] = useState(() => linked ?? readSelected(selectedKey));

  useEffect(() => {
    if (!linked) return;
    setSelected(linked);
    storeSelected(selectedKey, linked);
  }, [linked, selectedKey]);

  const select = (next: string) => {
    setSelected(next);
    storeSelected(selectedKey, next);
    if (linked) setSearchParams({}, { replace: true });
  };

  return { selected, select };
}
