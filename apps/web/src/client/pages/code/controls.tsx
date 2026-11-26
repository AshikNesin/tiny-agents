import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, ChevronDown, Cpu, GitMerge, GitPullRequest, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@groot/ui/lib/utils";
import {
  SearchSelect,
  searchSelectTriggerClass,
  type SearchSelectOption,
} from "@groot/ui/search-select";
import { errorMessage } from "../../lib/errors";
import {
  codeApi,
  threadPath,
  type ModelOption,
  type PermissionMode,
  type ThreadSummary,
} from "../../lib/code/api";

const modelsByHarness = new Map<string, Promise<ModelOption[]>>();
export function loadModels(instanceId: string): Promise<ModelOption[]> {
  let promise = modelsByHarness.get(instanceId);
  if (!promise) {
    promise = codeApi.models(instanceId).catch((error: unknown) => {
      modelsByHarness.delete(instanceId);
      throw error;
    });
    modelsByHarness.set(instanceId, promise);
  }
  return promise;
}

export const DEFAULT = "default";

function modelLabel(model: ModelOption | undefined, fallback = ""): string {
  return model?.label || model?.id || fallback;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  return `${Math.round(n / 1000)}k`;
}

export function ModelPicker({
  models,
  value,
  onChange,
  withDefault,
  bare,
}: {
  models: ModelOption[];
  value: string;
  onChange(value: string): void;
  withDefault?: boolean;
  bare?: boolean;
}) {
  const ready = models.filter((m) => m.ready !== false || m.id === value);
  const harnessDefault = models.find((m) => m.isDefault);
  const options: SearchSelectOption[] = [
    ...(withDefault
      ? [
          {
            value: DEFAULT,
            label: "Default",
            description: harnessDefault ? modelLabel(harnessDefault) : "The harness's default",
            keywords: ["default"],
          },
        ]
      : []),
    ...ready
      .filter((m) => !(withDefault && m.id === DEFAULT))
      .map((m) => ({
        value: m.id,
        label: modelLabel(m),
        description: [
          m.label && m.label !== m.id ? m.id : undefined,
          m.contextWindow ? `${formatTokens(m.contextWindow)} context` : undefined,
          m.isDefault ? "default" : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        keywords: [m.id],
      })),
  ];
  const current =
    value === DEFAULT
      ? withDefault
        ? harnessDefault
          ? modelLabel(harnessDefault)
          : "Default model"
        : "Model"
      : modelLabel(
          models.find((m) => m.id === value),
          value || "Model",
        );
  return (
    <SearchSelect
      label="Model"
      value={value}
      onValueChange={onChange}
      options={options}
      searchPlaceholder="Search models…"
      emptyText="No model matches."
      side="top"
      contentClassName="w-80"
      data-testid="code-model"
    >
      {!bare && <Cpu className="opacity-70" />}
      <span className="max-w-24 truncate @xs:max-w-40">{current}</span>
      {!bare && <ChevronDown className="opacity-50" />}
    </SearchSelect>
  );
}

const LEVEL_LABEL: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const LEVEL_HINT: Record<string, string> = {
  off: "No extended thinking",
  low: "Quick",
  medium: "Balanced",
  high: "Thorough",
  max: "As much as the model allows",
};

export function ReasoningPicker({
  levels,
  value,
  onChange,
  bare,
}: {
  levels: string[];
  value: string;
  onChange(value: string): void;
  bare?: boolean;
}) {
  if (levels.length === 0) return null;
  const options: SearchSelectOption[] = [
    { value: DEFAULT, label: "Auto", description: "The model's default reasoning" },
    ...levels.map((level) => ({
      value: level,
      label: LEVEL_LABEL[level] ?? level,
      description: LEVEL_HINT[level],
      keywords: [level],
    })),
  ];
  const current = value && value !== DEFAULT ? (LEVEL_LABEL[value] ?? value) : undefined;
  return (
    <SearchSelect
      label="Reasoning"
      value={value || DEFAULT}
      onValueChange={onChange}
      options={options}
      searchPlaceholder="Search reasoning…"
      side="top"
      contentClassName="w-64"
      data-testid="code-reasoning"
    >
      {!bare && <Brain className="opacity-70" />}
      <span className={cn("truncate", !bare && "hidden @[16rem]:inline")}>{current ?? "Auto"}</span>
      {!bare && <ChevronDown className="opacity-50" />}
    </SearchSelect>
  );
}

const MODE_LABEL: Record<PermissionMode, string> = {
  default: "Ask",
  acceptEdits: "Accept edits",
  plan: "Plan",
  bypassPermissions: "YOLO",
};

const MODE_HINT: Record<PermissionMode, string> = {
  default: "Ask before edits and commands",
  acceptEdits: "Edit files without asking; ask before commands",
  plan: "Read and plan only; no edits",
  bypassPermissions: "Never ask",
};

export function composerPermission(settings: {
  permissionModes: PermissionMode[];
  defaultPermissionMode?: PermissionMode;
}): PermissionMode | null {
  if (settings.permissionModes.includes("bypassPermissions")) return "bypassPermissions";
  return settings.defaultPermissionMode ?? null;
}

export function PermissionPicker({
  modes,
  value,
  onChange,
}: {
  modes: PermissionMode[];
  value: PermissionMode;
  onChange(value: PermissionMode): void;
}) {
  if (modes.length === 0) return null;
  return (
    <SearchSelect
      label="Permissions"
      value={value}
      onValueChange={(v) => onChange(v as PermissionMode)}
      options={modes.map((mode) => ({
        value: mode,
        label: MODE_LABEL[mode],
        description: MODE_HINT[mode],
        keywords: [mode],
      }))}
      side="top"
      contentClassName="w-72"
      data-testid="code-permission"
    >
      {value === "bypassPermissions" ? (
        <Zap className="text-warning" />
      ) : (
        <ShieldCheck className="opacity-70" />
      )}
      <span className="hidden truncate @[16rem]:inline">{MODE_LABEL[value]}</span>
      <ChevronDown className="opacity-50" />
    </SearchSelect>
  );
}

export function ContextRing({ used, max }: { used: number; max?: number }) {
  if (!max || !used) return null;
  const ratio = Math.min(1, used / max);
  const pct = Math.round(ratio * 100);
  const r = 6;
  const circumference = 2 * Math.PI * r;
  return (
    <span
      title={`Context ${used.toLocaleString()} of ${max.toLocaleString()} tokens (${pct}%).`}
      aria-label={`Context ${pct}% full`}
      className={cn(searchSelectTriggerClass, "tabular-nums")}
      data-testid="code-context"
    >
      <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
        <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2" className="stroke-muted" />
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className={cn(
            pct > 85 ? "stroke-destructive" : pct > 65 ? "stroke-warning" : "stroke-foreground/70",
          )}
        />
      </svg>
      <span className="hidden @[20rem]:inline">{pct}%</span>
    </span>
  );
}

export function useArchive() {
  const navigate = useNavigate();
  return useCallback(
    async (
      row: Pick<ThreadSummary, "id" | "title">,
      archive: boolean,
      options: { leave?: boolean } = {},
    ) => {
      const { id, title } = row;
      try {
        const result = await codeApi.archive(id, archive);
        const moved = result?.moved?.length ?? 0;
        const what = `“${title}”${moved ? ` and ${moved} ${moved === 1 ? "subagent" : "subagents"}` : ""}`;
        if (archive && options.leave) navigate("/code");
        toast.success(archive ? `Archived ${what}` : `Restored ${what}`, {
          action: {
            label: "Undo",
            onClick: () =>
              void codeApi
                .archive(id, !archive)
                .catch((error: unknown) => toast.error(errorMessage(error, "Could not undo.")))
                .then(() => {
                  if (archive && options.leave) navigate(threadPath(id));
                }),
          },
        });
        return true;
      } catch (error) {
        toast.error(errorMessage(error, `Could not ${archive ? "archive" : "restore"} it.`));
        return false;
      }
    },
    [navigate],
  );
}

export function pullState(loop: string): string | null {
  switch (loop) {
    case "needs_input":
      return "needs you";
    case "fixing":
      return "fixing";
    case "merged":
      return "merged";
    case "green":
      return "checks pass";
    default:
      return null;
  }
}

const PULL_TONE: Record<string, string> = {
  needs_input: "text-warning",
  fixing: "text-foreground",
  green: "text-success",
};

export function PullChip({
  pr,
  className,
}: {
  pr: { number: number; loop: string };
  className?: string;
}) {
  const state = pullState(pr.loop);
  const Icon = pr.loop === "merged" ? GitMerge : GitPullRequest;
  return (
    <span
      aria-label={`Pull request #${pr.number}${state ? `, ${state}` : ""}`}
      title={`Pull request #${pr.number}${state ? ` (${state})` : ""}`}
      className={cn(
        "bg-muted inline-flex h-5 shrink-0 items-center gap-0.5 rounded-md px-1 text-[11px] font-medium tabular-nums",
        PULL_TONE[pr.loop] ?? "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />#{pr.number}
    </span>
  );
}
