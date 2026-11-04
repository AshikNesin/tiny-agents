/**
 * The context usage popup (issue #143), opened from the composer's context
 * ring: a port of Shelley's own usage table (its TokenCostGraph.vue), minus
 * the graphs — total and subtotal, one row group per model with its token
 * bands (cache read/write, input, output), "Other (indirect)" rows for usage
 * a conversation incurs outside its own turns (compaction, slug generation,
 * …), a subagent column when children exist, and "Compact in place".
 *
 * Costs are estimated from models.dev rates (fetched through our proxy);
 * models without pricing show provider-reported cost where the gateway
 * reports one, and the notes say when a total may be incomplete.
 */
import { useEffect, useMemo, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@groot/ui/table";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import {
  shelleyApi,
  type ModelCost,
  type ShelleyMessage,
  type SubagentModelUsage,
} from "../../lib/shelley/api";
import {
  distinctModels,
  formatTokenCount,
  formatUnitPrice,
  formatUsd,
  otherUsageBreakdown,
  otherUsageEntries,
  perModelUsage,
  subagentModelUsage,
  TOKEN_BANDS,
  usageEntries,
  type BandRow,
  type ModelUsage,
} from "../../lib/shelley/usage";

function TokenBandCell({ row }: { row: BandRow }) {
  if (!row.tokens) {
    return <span className="text-muted-foreground/50">{formatTokenCount(0)}</span>;
  }
  if (row.aggregate) {
    return <span className="text-muted-foreground">{formatTokenCount(row.tokens)}</span>;
  }
  return (
    <span className="flex items-baseline justify-end gap-1.5">
      <span className="text-muted-foreground">{formatTokenCount(row.tokens)}</span>
      <span className="text-muted-foreground/70 w-14 shrink-0 text-right text-[10px]">
        {row.unitUsdPerMtok === null
          ? "mixed rates"
          : row.priced
            ? `@ ${formatUnitPrice(row.unitUsdPerMtok)}`
            : ""}
      </span>
      <span className="w-14 shrink-0 text-right">
        {row.priced || row.cost > 0 ? formatUsd(row.cost) : "—"}
      </span>
    </span>
  );
}

/** One model's row group: the model name over its four token bands. */
function ModelRows({
  model,
  showSubagents,
  subagent,
  hideZeroCacheWrite,
}: {
  model: ModelUsage;
  showSubagents: boolean;
  subagent?: ModelUsage;
  hideZeroCacheWrite: boolean;
}) {
  const bands = TOKEN_BANDS.map((band, i) => ({
    band,
    row: model.rows[i],
    sub: subagent?.rows[i],
  })).filter(
    ({ band, row, sub }) =>
      !(hideZeroCacheWrite && band.costKey === "cache_write" && !row.tokens && !sub?.tokens),
  );
  return (
    <TableBody className="border-border/60">
      <TableRow className="border-border/60 border-t hover:bg-transparent">
        <th colSpan={showSubagents ? 2 : 1} scope="rowgroup" className="pt-2.5 pb-1 text-left">
          <span className="text-foreground truncate font-medium">{model.model}</span>
        </th>
        <TableCell className="pt-2.5 pb-1 text-right align-top">
          {model.priced || model.totalCost > 0 ? (
            <span>{formatUsd(model.totalCost)}</span>
          ) : (
            <span className="text-muted-foreground">no pricing</span>
          )}
        </TableCell>
      </TableRow>
      {bands.map(({ band, row, sub }) => (
        <TableRow key={band.key} className="text-muted-foreground hover:bg-transparent">
          <th scope="row" className="pb-0.5 pl-0 text-left font-normal">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: band.color }}
              />
              {band.label}
            </span>
          </th>
          <TableCell className="pb-0.5 pr-0">
            {showSubagents && sub ? <TokenBandCell row={sub} /> : null}
          </TableCell>
          <TableCell className="pb-0.5 pr-0">
            <TokenBandCell row={row} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}

export interface UsagePopoverProps {
  used: number;
  max?: number;
  conversationId?: string;
  messages: ShelleyMessage[];
  /** Subagents of this conversation (the column appears when non-empty). */
  hasSubagents: boolean;
  /** Children: the ring trigger itself. */
  children: React.ReactNode;
  /** Runs /compact; the popup shows it as "Compact in place". */
  onCompact(): void;
  compacting?: boolean;
}

export function UsagePopover({
  used,
  max,
  conversationId,
  messages,
  hasSubagents,
  children,
  onCompact,
  compacting,
}: UsagePopoverProps) {
  const [open, setOpen] = useState(false);

  const entries = useMemo(() => usageEntries(messages), [messages]);
  const others = useMemo(() => otherUsageEntries(messages), [messages]);
  const models = useMemo(() => distinctModels(entries, others), [entries, others]);

  const [costs, setCosts] = useState<Record<string, ModelCost | null>>({});
  const [costsState, setCostsState] = useState<"idle" | "loading" | "error">("idle");
  useEffect(() => {
    if (!open || models.length === 0) return;
    let live = true;
    setCostsState("loading");
    shelleyApi
      .modelCosts(models)
      .then((r) => {
        if (!live) return;
        setCosts(r.costs ?? {});
        setCostsState("idle");
      })
      .catch(() => live && setCostsState("error"));
    return () => {
      live = false;
    };
  }, [open, models]);

  const [subagents, setSubagents] = useState<SubagentModelUsage[] | null>(null);
  useEffect(() => {
    if (!open || !conversationId || !hasSubagents) return;
    let live = true;
    shelleyApi
      .subagentUsage(conversationId)
      .then((u) => live && setSubagents(u.per_model ?? []))
      .catch(() => live && setSubagents(null));
    return () => {
      live = false;
    };
  }, [open, conversationId, hasSubagents]);

  const main = useMemo(() => perModelUsage(entries, costs), [entries, costs]);
  const otherRows = useMemo(() => otherUsageBreakdown(others, costs), [others, costs]);
  const subRows = useMemo(() => subagentModelUsage(subagents ?? undefined), [subagents]);

  const subagentUsd = subRows.reduce((sum, m) => sum + m.totalCost, 0);
  const otherUsd = otherRows.reduce(
    (sum, p) => sum + (p.priced ? p.estimatedUsd : p.reportedUsd),
    0,
  );
  const mainUsd = main.reduce((sum, m) => sum + m.totalCost, 0);
  const totalUsd = mainUsd + otherUsd + subagentUsd;
  const anyUnpriced = main.some((m) => !m.priced) || otherRows.some((p) => !p.priced);

  const pct = max && used ? Math.min(100, Math.round((used / max) * 100)) : null;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>{children}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          side="top"
          sideOffset={6}
          collisionPadding={8}
          aria-label="Context usage"
          data-has-subagents={hasSubagents ? "" : undefined}
          className={cn(
            "z-50 w-[min(34rem,calc(100vw-1rem))] data-[has-subagents]:w-[min(40rem,calc(100vw-1rem))] origin-(--radix-popover-content-transform-origin) rounded-xl bg-popover text-popover-foreground text-xs shadow-md ring-1 ring-foreground/10 duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:duration-100 data-[state=closed]:ease-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97]",
          )}
        >
          <div className="max-h-[min(26rem,calc(100dvh-4rem))] overflow-y-auto overscroll-contain p-3">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-foreground font-medium">Context usage</h3>
              <span className="text-muted-foreground tabular-nums">
                {formatTokenCount(used)} tokens{pct !== null ? ` · ${pct}%` : ""} context
              </span>
            </div>

            {entries.length === 0 && others.length === 0 ? (
              <p className="text-muted-foreground py-3">No usage data yet.</p>
            ) : (
              <Table className="table-fixed text-xs tabular-nums">
                <colgroup>
                  <col className="w-[38%]" />
                  {hasSubagents && <col />}
                  <col />
                </colgroup>
                <TableHeader>
                  <TableRow className="text-muted-foreground hover:bg-transparent">
                    <TableHead scope="col" className="px-0 pt-0 pb-1.5 text-left">
                      Model / tokens
                    </TableHead>
                    {hasSubagents && (
                      <TableHead scope="col" className="px-0 pt-0 pb-1.5 text-right">
                        Sub-agents
                      </TableHead>
                    )}
                    <TableHead scope="col" className="px-0 pt-0 pb-1.5 text-right">
                      Main conversation
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="border-border/60">
                  <TableRow className="border-border/60 border-t hover:bg-transparent">
                    <th
                      scope="row"
                      colSpan={hasSubagents ? 2 : 1}
                      className="pl-0 pt-1.5 text-left"
                    >
                      Total
                    </th>
                    <TableCell className="pr-0 pt-1.5 text-right">≈{formatUsd(totalUsd)}</TableCell>
                  </TableRow>
                  <TableRow className="hover:bg-transparent">
                    <th scope="row" className="pl-0 pb-1.5 text-left font-normal">
                      Subtotal
                    </th>
                    <TableCell className="pr-0 pb-1.5 text-right">{formatUsd(mainUsd)}</TableCell>
                    {hasSubagents && (
                      <TableCell className="pr-0 pb-1.5 text-right">
                        {formatUsd(subagentUsd)}
                      </TableCell>
                    )}
                  </TableRow>
                </TableBody>
                {main.map((m) => (
                  <ModelRows
                    key={m.model}
                    model={m}
                    showSubagents={hasSubagents}
                    subagent={subRows.find((s) => s.model === m.model)}
                    hideZeroCacheWrite
                  />
                ))}
                {otherRows.length > 0 && (
                  <TableBody className="border-border/60">
                    <TableRow className="border-border/60 border-t hover:bg-transparent">
                      <th
                        scope="row"
                        colSpan={hasSubagents ? 2 : 1}
                        className="pl-0 pt-2.5 pb-1 text-left"
                      >
                        <span className="text-foreground truncate font-medium">
                          Other (indirect)
                        </span>
                      </th>
                      <TableCell className="pr-0 pt-2.5 pb-1 text-right align-top">
                        {formatUsd(otherUsd)}
                      </TableCell>
                    </TableRow>
                    {otherRows.map((p) => (
                      <TableRow
                        key={p.purpose}
                        className="text-muted-foreground hover:bg-transparent"
                      >
                        <th scope="row" className="pl-0 pb-0.5 text-left font-normal">
                          {p.purpose}
                        </th>
                        <TableCell className="pb-0.5 pr-0" colSpan={hasSubagents ? 2 : 1}>
                          <span className="flex items-baseline justify-end gap-1.5">
                            <span>{formatTokenCount(p.tokens)}</span>
                            <span className="text-muted-foreground/70">
                              {p.llmCalls} {p.llmCalls === 1 ? "call" : "calls"}
                            </span>
                            <span className="w-14 shrink-0 text-right">
                              {p.priced || p.reportedUsd > 0
                                ? formatUsd(p.estimatedUsd || p.reportedUsd)
                                : "—"}
                            </span>
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                )}
              </Table>
            )}

            {costsState === "loading" && entries.length > 0 && (
              <p className="text-muted-foreground mt-2 flex items-center gap-1.5">
                <Spinner className="size-3" /> Loading pricing…
              </p>
            )}
            {costsState === "error" && (
              <p className="text-muted-foreground mt-2">Pricing lookup failed; showing tokens.</p>
            )}
            {costsState === "idle" && anyUnpriced && (
              <p className="text-muted-foreground mt-2">
                Some models have no pricing; their totals may be incomplete.
              </p>
            )}
          </div>
          <div className="border-border/60 border-t p-2">
            <button
              type="button"
              onClick={() => {
                onCompact();
                setOpen(false);
              }}
              disabled={compacting}
              className="border-primary/60 text-primary hover:bg-primary/10 w-full rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
            >
              Compact in Place
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
