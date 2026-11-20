import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { BotMenuView } from "../BotMenu";

export function useHistoryMenu() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [menuView, setMenuView] = useState<BotMenuView>(null);
  useEffect(() => {
    if (searchParams.get("history") !== "1") return;
    setMenuView("history");
    const next = new URLSearchParams(searchParams);
    next.delete("history");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  return [menuView, setMenuView] as const;
}
