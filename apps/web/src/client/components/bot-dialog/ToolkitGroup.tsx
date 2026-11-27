import { ChevronRight, Wrench } from "lucide-react";
import type { CapabilityInfo, ToolPermission } from "../../../shared/api/bots";
import type { BrowserProfile } from "../../../shared/api/live";
import {
  COLLAPSE_OVER,
  groupValue,
  permissionOf,
  setAll,
  summary,
  toolTitle,
  type ToolInfo,
} from "../../lib/tool-permissions";
import { ToggleGroup, ToggleGroupItem } from "@groot/ui/toggle-group";

type Permissions = Record<string, ToolPermission>;
type SetPermissions = (next: (current: Permissions) => Permissions) => void;

function PermissionToggle({
  value,
  onChange,
  label,
  askOnly,
}: {
  value: ToolPermission | "";
  onChange: (next: ToolPermission) => void;
  label: string;
  askOnly?: boolean | undefined;
}) {
  return (
    <ToggleGroup
      value={value}
      onValueChange={(next: string) => {
        if (next) onChange(next as ToolPermission);
      }}
      spacing={0}
      size="sm"
      aria-label={label}
      className="shrink-0"
    >
      {askOnly ? null : (
        <ToggleGroupItem value="allow" className="text-xs">
          Allow
        </ToggleGroupItem>
      )}
      <ToggleGroupItem value="ask" className="text-xs">
        {askOnly ? "Ask (always)" : "Ask"}
      </ToggleGroupItem>
      <ToggleGroupItem value="off" className="text-xs">
        Off
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function ToolPermissionRow({
  tool,
  toolPermissions,
  setToolPermissions,
}: {
  tool: ToolInfo;
  toolPermissions: Permissions;
  setToolPermissions: SetPermissions;
}) {
  const title = toolTitle(tool);
  return (
    <div className="flex items-center gap-3 py-1.5 sm:pl-7">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{title}</p>
        <p className="text-muted-foreground line-clamp-2 text-xs sm:truncate">{tool.description}</p>
      </div>
      <PermissionToggle
        value={permissionOf(toolPermissions, tool)}
        onChange={(next) =>
          setToolPermissions((permissions) => ({ ...permissions, [tool.name]: next }))
        }
        label={`${title} permission`}
        askOnly={tool.askOnly}
      />
    </div>
  );
}

function BrowserProfileRow({
  browserProfile,
  onChange,
}: {
  browserProfile: BrowserProfile;
  onChange: (next: BrowserProfile) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5 sm:pl-7">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">Browser profile</p>
        <p className="text-muted-foreground text-xs">
          {browserProfile === "shared"
            ? "Signed in where your other bots are."
            : "A browser of its own, with separate sign-ins."}
        </p>
      </div>
      <ToggleGroup
        value={browserProfile}
        onValueChange={(next: string) => {
          if (next) onChange(next as BrowserProfile);
        }}
        spacing={0}
        size="sm"
        aria-label="Browser profile"
      >
        <ToggleGroupItem value="shared" className="text-xs">
          Shared
        </ToggleGroupItem>
        <ToggleGroupItem value="own" className="text-xs">
          Own
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

export function ToolkitGroup({
  toolkit,
  shown,
  searching,
  expanded,
  setExpanded,
  toolPermissions,
  setToolPermissions,
  browserProfile,
  onBrowserProfileChange,
}: {
  toolkit: CapabilityInfo;
  shown: ToolInfo[];
  searching: boolean;
  expanded: Record<string, boolean>;
  setExpanded: (next: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  toolPermissions: Permissions;
  setToolPermissions: SetPermissions;
  browserProfile?: BrowserProfile;
  onBrowserProfileChange?: (next: BrowserProfile) => void;
}) {
  const setUp = !toolkit.setupHint;
  const isOpen =
    setUp && (searching || (expanded[toolkit.id] ?? toolkit.tools.length <= COLLAPSE_OVER));
  const value = groupValue(toolPermissions, shown);
  const bodyId = `toolkit-${toolkit.id}-tools`;
  return (
    <div className="bg-secondary/50 rounded-2xl">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default max-sm:basis-full"
          onClick={() => setExpanded((current) => ({ ...current, [toolkit.id]: !isOpen }))}
          disabled={!setUp || searching}
          aria-expanded={setUp ? isOpen : undefined}
          aria-controls={setUp ? bodyId : undefined}
        >
          {setUp ? (
            <ChevronRight
              className={`text-muted-foreground size-4 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
              aria-hidden
            />
          ) : (
            <Wrench className="text-muted-foreground size-4 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{toolkit.name}</span>
            <span className="text-muted-foreground block truncate text-xs">
              {toolkit.setupHint ??
                `${shown.length} ${shown.length === 1 ? "tool" : "tools"} · ${summary(toolPermissions, shown)}`}
            </span>
          </span>
        </button>
        {setUp && shown.length > 1 && (
          <div className="ml-auto flex items-center gap-2">
            {value === "mixed" && <span className="text-muted-foreground text-xs">Mixed</span>}
            <PermissionToggle
              value={value === "mixed" ? "" : value}
              onChange={(next) => setToolPermissions((current) => setAll(current, shown, next))}
              label={searching ? `All matching ${toolkit.name} tools` : `All ${toolkit.name} tools`}
            />
          </div>
        )}
      </div>
      {isOpen && (
        <div id={bodyId} className="border-border/60 border-t px-3.5 pb-3 pt-1">
          {toolkit.id === "browser" && !searching && browserProfile && onBrowserProfileChange && (
            <BrowserProfileRow browserProfile={browserProfile} onChange={onBrowserProfileChange} />
          )}
          {shown.map((tool) => (
            <ToolPermissionRow
              key={tool.name}
              tool={tool}
              toolPermissions={toolPermissions}
              setToolPermissions={setToolPermissions}
            />
          ))}
        </div>
      )}
    </div>
  );
}
