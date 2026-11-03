/**
 * Shared pieces of the Code page (issue #143): the composer's model and
 * reasoning pickers (searchable), the context ring, and archiving a
 * conversation with its subagents (with Undo).
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, ChevronDown, Cpu } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@groot/ui/lib/utils";
import {
  SearchSelect,
  searchSelectTriggerClass,
  type SearchSelectOption,
} from "../../components/ui/search-select";
import { errorMessage } from "../../lib/errors";
import {
  THINKING_LEVELS,
  conversationTitle,
  shelleyApi,
  type ShelleyConversation,
  type ShelleyModel,
  type ThinkingLevel,
} from "../../lib/shelley/api";

let modelsPromise: Promise<ShelleyModel[]> | undefined;
/** Shelley's models, read once per page load. */
export function loadModels(): Promise<ShelleyModel[]> {
  modelsPromise ??= shelleyApi.models().catch((error: unknown) => {
    modelsPromise = undefined;
    throw error;
  });
  return modelsPromise;
}

export const DEFAULT = "default";

export function modelLabel(model: ShelleyModel | undefined, fallback = ""): string {
  return model?.display_name || model?.id || fallback;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  return `${Math.round(n / 1000)}k`;
}

/** Searchable model picker; `withDefault` adds "Default" (Shelley's choice). */
export function ModelPicker({
  models,
  value,
  onChange,
  withDefault,
}: {
  models: ShelleyModel[];
  value: string;
  onChange(value: string): void;
  withDefault?: boolean;
}) {
  const ready = models.filter((m) => m.ready || m.id === value);
  const shelleyDefault = models.find((m) => m.is_default);
  const options: SearchSelectOption[] = [
    ...(withDefault
      ? [
          {
            value: DEFAULT,
            label: "Default",
            description: shelleyDefault ? modelLabel(shelleyDefault) : "Shelley's default model",
            keywords: ["default"],
          },
        ]
      : []),
    ...ready.map((m) => ({
      value: m.id,
      label: modelLabel(m),
      description: [
        m.display_name && m.display_name !== m.id ? m.id : undefined,
        m.max_context_tokens ? `${formatTokens(m.max_context_tokens)} context` : undefined,
        m.is_default ? "default" : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      keywords: [m.id],
    })),
  ];
  const current =
    value === DEFAULT
      ? withDefault
        ? shelleyDefault
          ? modelLabel(shelleyDefault)
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
      <Cpu className="opacity-70" />
      <span className="max-w-24 truncate @xs:max-w-40">{current}</span>
      <ChevronDown className="opacity-50" />
    </SearchSelect>
  );
}

const LEVEL_LABEL: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const LEVEL_HINT: Partial<Record<ThinkingLevel, string>> = {
  off: "No extended thinking",
  low: "Quick",
  medium: "Balanced",
  high: "Thorough",
  max: "As much as the model allows",
};

/** Searchable reasoning picker ("" or "default" = the model's default). */
export function ReasoningPicker({
  value,
  onChange,
}: {
  value: string;
  onChange(value: string): void;
}) {
  const options: SearchSelectOption[] = [
    { value: DEFAULT, label: "Auto", description: "The model's default reasoning" },
    ...THINKING_LEVELS.map((level) => ({
      value: level,
      label: LEVEL_LABEL[level],
      description: LEVEL_HINT[level],
      keywords: [level],
    })),
  ];
  const current = value && value !== DEFAULT ? LEVEL_LABEL[value as ThinkingLevel] : undefined;
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
      <Brain className="opacity-70" />
      <span className="hidden truncate @[16rem]:inline">{current ?? "Auto"}</span>
      <ChevronDown className="opacity-50" />
    </SearchSelect>
  );
}

/** How full the context window is; click to compact. */
export function ContextRing({
  used,
  max,
  onCompact,
}: {
  used: number;
  max?: number;
  onCompact(): void;
}) {
  if (!max || !used) return null;
  const ratio = Math.min(1, used / max);
  const pct = Math.round(ratio * 100);
  const r = 6;
  const circumference = 2 * Math.PI * r;
  return (
    <button
      type="button"
      onClick={onCompact}
      title={`Context ${used.toLocaleString()} of ${max.toLocaleString()} tokens (${pct}%). Click to compact.`}
      aria-label={`Context ${pct}% full. Compact`}
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
    </button>
  );
}

/**
 * Archive (or restore) a conversation with its subagents, with Undo.
 * `onArchived` runs after an archive (the view leaves the conversation).
 */
export function useArchive() {
  const navigate = useNavigate();
  return useCallback(
    async (
      row: Pick<ShelleyConversation, "conversation_id" | "slug">,
      archive: boolean,
      options: { leave?: boolean } = {},
    ) => {
      const id = row.conversation_id;
      const title = conversationTitle(row);
      try {
        const result = await shelleyApi.action(id, archive ? "archive" : "unarchive");
        const moved = result?.subagents?.length ?? 0;
        const what = `“${title}”${moved ? ` and ${moved} ${moved === 1 ? "subagent" : "subagents"}` : ""}`;
        if (archive && options.leave) navigate("/code");
        toast.success(archive ? `Archived ${what}` : `Restored ${what}`, {
          action: {
            label: "Undo",
            onClick: () =>
              void shelleyApi
                .action(id, archive ? "unarchive" : "archive")
                .catch((error: unknown) => toast.error(errorMessage(error, "Could not undo.")))
                .then(() => {
                  if (archive && options.leave) navigate(`/code/${id}`);
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
