import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { DiscoveredModel } from "../../../../shared/api/models";
import { useModelDiscovery } from "../../../queries/models";
import { SearchSelect, type SearchSelectOption } from "@groot/ui/search-select";
import { formatTokens } from "./model-labels";

export function AddModel({
  accountId,
  hint,
  onAdd,
}: {
  accountId: string;
  hint?: string;
  onAdd: (model: { upstreamId: string; name?: string }) => Promise<boolean>;
}) {
  const [listed, setListed] = useState<DiscoveredModel[] | null>(null);
  const [failed, setFailed] = useState(false);
  const listAvailable = useModelDiscovery().available.mutateAsync;
  useEffect(() => {
    let cancelled = false;
    listAvailable(accountId)
      .then(({ models }) => {
        if (!cancelled) setListed(models);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, listAvailable]);
  const options: SearchSelectOption[] = useMemo(
    () =>
      (listed ?? []).map((model) => ({
        value: model.upstreamId,
        label: model.name,
        description:
          model.type === "classifier"
            ? `${model.upstreamId} · classifier`
            : `${model.upstreamId} · ${formatTokens(model.contextWindow)}`,
        keywords: [model.upstreamId],
      })),
    [listed],
  );
  const add = async (upstreamId: string) => {
    const model = listed?.find((m) => m.upstreamId === upstreamId);
    const added = await onAdd({ upstreamId, ...(model ? { name: model.name } : {}) });
    if (added) setListed((list) => list?.filter((m) => m.upstreamId !== upstreamId) ?? null);
  };
  const emptyText = failed
    ? "Couldn't list the models. Type a model id to add it."
    : listed === null
      ? "Loading models…"
      : "No listed model matches. Type its id to add it.";
  return (
    <SearchSelect
      value=""
      onValueChange={(upstreamId) => void add(upstreamId)}
      options={options}
      label="Add a model"
      searchPlaceholder={hint ? `Search or type an id, e.g. ${hint}` : "Search or type an id…"}
      emptyText={emptyText}
      createOption={(query) => ({
        key: "add-by-id",
        label: `Add “${query}” by id`,
        icon: <Plus />,
        onSelect: (typed) => void add(typed.trim()),
      })}
      contentClassName="w-[min(36rem,calc(100vw-2rem))]"
      triggerClassName="h-9 w-full justify-start gap-1.5 rounded-xl border border-input bg-transparent px-3 text-sm font-normal text-muted-foreground hover:bg-transparent dark:bg-input/30 dark:hover:bg-input/50"
    >
      <Plus className="size-4" />
      <span className="truncate">Add a model…</span>
    </SearchSelect>
  );
}
