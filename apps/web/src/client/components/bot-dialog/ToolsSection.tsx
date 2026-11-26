import { Search } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { metaLabelClass } from "@groot/ui/typography";
import type { CapabilityInfo, ToolPermission } from "../../../shared/api/bots";
import type { ConnectionSummary } from "../../../shared/api/connections";
import { toggleId, type BotDraft } from "../../lib/bot-draft";
import { applyPreset, matchesQuery, summary, type ToolInfo } from "../../lib/tool-permissions";
import { Switch } from "@groot/ui/switch";
import { ToolkitGroup } from "./ToolkitGroup";

export function ToolsSection({
  draft,
  edit,
  setDraft,
  setToolPermissions,
  toolkitsList,
  allTools,
  connections,
  toolQuery,
  setToolQuery,
  expanded,
  setExpanded,
  inherited = {},
}: {
  draft: BotDraft;
  edit: <K extends keyof BotDraft>(key: K, value: BotDraft[K]) => void;
  setDraft: (next: (current: BotDraft) => BotDraft) => void;
  setToolPermissions: (
    next: (current: Record<string, ToolPermission>) => Record<string, ToolPermission>,
  ) => void;
  toolkitsList: CapabilityInfo[];
  allTools: ToolInfo[];
  connections: ConnectionSummary[];
  toolQuery: string;
  setToolQuery: (query: string) => void;
  expanded: Record<string, boolean>;
  setExpanded: (next: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  inherited?: Record<string, ToolPermission>;
}) {
  const { browserProfile, autoReview, yoloByDefault } = draft;
  const toolPermissions = { ...inherited, ...draft.toolPermissions };
  const searching = toolQuery.trim().length > 0;
  const toolGroups = toolkitsList.map((toolkit) => ({
    toolkit,
    shown: toolkit.tools.filter((tool) => matchesQuery(tool, toolkit.name, toolQuery)),
  }));
  const visibleGroups = searching
    ? toolGroups.filter(({ toolkit, shown }) => !toolkit.setupHint && shown.length > 0)
    : toolGroups;

  return (
    <div className="space-y-4">
      <div className="bg-popover sticky -top-1 z-10 -mx-1 space-y-2 px-1 pt-1 pb-2">
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            value={toolQuery}
            onChange={(e) => setToolQuery(e.target.value)}
            placeholder={`Search ${allTools.length} tools`}
            aria-label="Search tools"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs max-sm:w-full">
            {summary(toolPermissions, allTools) || "No tools"}
          </span>
          <span className="flex-1 max-sm:hidden" />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setToolPermissions((current) => applyPreset(current, allTools, "read-only"))
            }
          >
            Allow read-only
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setToolPermissions((current) => applyPreset(current, allTools, "ask-all"))
            }
          >
            Ask for everything
          </Button>
        </div>
      </div>
      {!searching && (
        <>
          <p className="text-muted-foreground text-xs">
            Every bot has these tools. <strong>Allow</strong> runs a tool unattended,{" "}
            <strong>Ask</strong> waits for your approval, <strong>Off</strong> hides it from this
            bot.
          </p>
          <div className="bg-secondary/50 flex items-start gap-3 rounded-2xl p-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Auto-review</p>
              <p className="text-muted-foreground text-xs">
                A classifier approves low-risk Ask actions you clearly asked for, so they run
                without a card. Anything else still asks you, and so do vault use and Ask (always)
                tools.
              </p>
            </div>
            <Switch
              checked={autoReview}
              onCheckedChange={(on) => edit("autoReview", on)}
              aria-label="Auto-review"
            />
          </div>
          <div className="bg-secondary/50 flex items-start gap-3 rounded-2xl p-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">YOLO mode by default</p>
              <p className="text-muted-foreground text-xs">
                Every new chat with this bot starts with YOLO mode on: Ask tools run without a card.
                Vault use, turns you did not start and routines still ask. You can turn it off in
                any chat.
              </p>
            </div>
            <Switch
              checked={yoloByDefault}
              onCheckedChange={(on) => edit("yoloByDefault", on)}
              aria-label="YOLO mode by default"
            />
          </div>
        </>
      )}
      {visibleGroups.map(({ toolkit, shown }) => (
        <ToolkitGroup
          key={toolkit.id}
          toolkit={toolkit}
          shown={shown}
          searching={searching}
          expanded={expanded}
          setExpanded={setExpanded}
          toolPermissions={toolPermissions}
          setToolPermissions={setToolPermissions}
          browserProfile={browserProfile}
          onBrowserProfileChange={(next) => edit("browserProfile", next)}
        />
      ))}
      {searching && visibleGroups.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No tools match “{toolQuery.trim()}”.
        </p>
      )}
      {connections.length > 0 && !searching && (
        <div>
          <p className={`${metaLabelClass} mb-1.5`}>Connections</p>
          {connections.map((connection) => {
            const enabled = draft.connectionIds.includes(connection.id);
            return (
              <div key={connection.id} className="flex items-center gap-3 py-1.5">
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      connectionIds: toggleId(current.connectionIds, connection.id, checked),
                    }))
                  }
                  aria-label={`Enable ${connection.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{connection.name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {connection.toolCount} tools · {connection.status.replace("_", " ")}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
