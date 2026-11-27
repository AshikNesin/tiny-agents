import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { readStored, writeStored } from "../../lib/browser-storage";

function readSelected(key: string): string {
  return readStored(key) ?? "shared";
}

function storeSelected(key: string, profile: string): void {
  writeStored(key, profile);
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
