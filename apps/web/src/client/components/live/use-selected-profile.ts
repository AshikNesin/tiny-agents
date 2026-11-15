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
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

/**
 * The page's selected tab: remembered per surface under `selectedKey`, and,
 * where `deepLink` allows, picked by `?profile=` (remembered like a click,
 * and dropped from the address on the next click).
 */
export function useSelectedProfile(selectedKey: string, deepLink: boolean) {
  const [searchParams, setSearchParams] = useSearchParams();
  const linked = deepLink ? searchParams.get("profile") : null;
  const [selected, setSelected] = useState(() => linked ?? readSelected(selectedKey));

  // A deep link picks the tab, and is remembered like a click.
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
