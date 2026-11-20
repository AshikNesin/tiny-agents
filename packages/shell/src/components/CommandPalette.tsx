import * as React from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Search, type LucideIcon } from "lucide-react";
import { useCommandPaletteStore } from "@groot/shell/store/command-palette";
import { useShellConfig } from "@groot/shell/lib/shell-config";
import { THEME_OPTIONS, useTheme } from "@groot/shell/lib/theme";
import { useSignOut } from "@groot/shell/hooks/useSignOut";
import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuInput,
  CommandMenuItem,
  CommandMenuList,
  CommandMenuTabs,
  type CommandMenuItemData,
  type CommandMenuTab,
} from "@groot/ui/command-menu";

export interface CommandItemEntry {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  variant?: "default" | "destructive";
  id?: string;
  action?: string;
  description?: string;
  shortcut?: string;
  keywords?: string[];
  suggested?: boolean;
}

export interface CommandGroupEntry {
  heading: string;
  items: CommandItemEntry[];
  id?: string;
}

const ALL_TAB = "all";
const NO_GROUPS: CommandGroupEntry[] = [];

export function CommandPaletteTrigger() {
  const setOpen = useCommandPaletteStore((state) => state.setOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Search (⌘K)"
      className="inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Search className="size-4" />
    </button>
  );
}

export function CommandPaletteDialog({
  groups = NO_GROUPS,
  builtIns = true,
}: {
  groups?: CommandGroupEntry[];
  builtIns?: boolean;
}) {
  const open = useCommandPaletteStore((state) => state.open);
  const setOpen = useCommandPaletteStore((state) => state.setOpen);
  const navigate = useNavigate();
  const { nav } = useShellConfig();
  const { setTheme } = useTheme();
  const signOut = useSignOut();
  const [tab, setTab] = React.useState(ALL_TAB);

  React.useEffect(() => {
    if (open) setTab(ALL_TAB);
  }, [open]);

  const resolvedGroups = React.useMemo<CommandGroupEntry[]>(
    () =>
      !builtIns
        ? groups
        : [
            ...(nav.length > 0
              ? [
                  {
                    id: "shell-navigation",
                    heading: "Navigation",
                    items: nav.map((item) => ({
                      id: item.to,
                      label: item.label,
                      icon: item.icon,
                      action: `Go to ${item.label}`,
                      shortcut: item.shortcut,
                      onSelect: () => navigate(item.to),
                    })),
                  },
                ]
              : []),
            ...groups,
            {
              id: "shell-theme",
              heading: "Theme",
              items: THEME_OPTIONS.map(({ value, label, icon }) => ({
                id: `theme-${value}`,
                label: `${label} theme`,
                icon,
                onSelect: () => setTheme(value),
              })),
            },
            {
              id: "shell-account",
              heading: "Account",
              items: [
                {
                  label: "Log out",
                  icon: LogOut,
                  onSelect: signOut,
                  variant: "destructive" as const,
                },
              ],
            },
          ],
    [builtIns, nav, groups, navigate, setTheme, signOut],
  );

  const { items, groupOf, destructive, suggestions, tabs } = React.useMemo(() => {
    const items: CommandMenuItemData[] = [];
    const groupOf = new Map<string, string>();
    const destructive = new Set<string>();
    const suggestions: string[] = [];
    const tabs: CommandMenuTab[] = [{ value: ALL_TAB, label: "All" }];
    for (const group of resolvedGroups) {
      const groupKey = group.id ?? group.heading;
      tabs.push({ value: groupKey, label: group.heading });
      for (const entry of group.items) {
        const value = `${groupKey}::${entry.id ?? entry.label}`;
        groupOf.set(value, groupKey);
        items.push({
          value,
          label: entry.label,
          action: entry.action,
          description: entry.description,
          icon: entry.icon,
          shortcut: entry.shortcut,
          keywords: [group.heading, ...(entry.keywords ?? [])],
          group: group.heading,
          onSelect: entry.onSelect,
        });
        if (entry.variant === "destructive") destructive.add(value);
        if (entry.suggested) suggestions.push(value);
      }
    }
    return { items, groupOf, destructive, suggestions, tabs };
  }, [resolvedGroups]);

  const visibleItems = React.useMemo(() => {
    if (tab === ALL_TAB) return items;
    return items.filter((item) => groupOf.get(item.value) === tab);
  }, [items, groupOf, tab]);

  return (
    <CommandMenuDialog open={open} onOpenChange={setOpen} shortcut="mod+k">
      <CommandMenu
        items={visibleItems}
        suggestions={tab === ALL_TAB && suggestions.length > 0 ? suggestions : undefined}
      >
        <CommandMenuInput placeholder="Type a command or search…" />
        {tabs.length > 2 && <CommandMenuTabs tabs={tabs} value={tab} onValueChange={setTab} />}
        <CommandMenuList
          renderItem={(item) => (
            <CommandMenuItem
              value={item.value}
              className={destructive.has(item.value) ? "text-destructive" : undefined}
            />
          )}
        >
          <CommandMenuEmpty>No results found.</CommandMenuEmpty>
        </CommandMenuList>
        <CommandMenuFooter />
      </CommandMenu>
    </CommandMenuDialog>
  );
}
