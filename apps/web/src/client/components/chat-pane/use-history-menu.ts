import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { BotMenuView } from "../BotMenu";

/**
 * The bot menu's open page. `?history=1` (the sidebar row's "Chat history")
 * opens it on its history page, and the parameter is dropped.
 */
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
