/**
 * The context usage popup (issue #143), opened from the composer's context
 * ring: the harness's usage report (ADR 0011) as a table — total and
 * subtotal, one row group per model with its token bands (cache
 * read/write, input, output), "Other (indirect)" rows for usage a thread
 * incurs outside its own turns, a subagent column when children exist, and
 * "Compact in place" when the harness can compact.
 */
import { useEffect, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@groot/ui/table";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { codeApi, type UsageBand, type UsageReport, type UsageRow } from "../../lib/code/api";
import { formatTokenCount, formatUnitPrice, formatUsd } from "../../lib/code/format";

function TokenBandCell({ band }: { band: UsageBand }) {
  if (!band.tokens) {
    return <span className="text-muted-foreground/50">{formatTokenCount(0)}</span>;
  }
  if (band.aggregate) {
    return <span className="text-muted-foreground">{formatTokenCount(band.tokens)}</span>;
  }
  return (
    <span className="flex items-baseline justify-end gap-1.5">
      <span className="text-muted-foreground">{formatTokenCount(band.tokens)}</span>
      <span className="text-muted-foreground/70 w-14 shrink-0 text-right text-[10px]">
        {band.unitPrice === null
          ? "mixed rates"
          : band.priced
            ? `@ ${formatUnitPrice(band.unitPrice)}`
            : ""}
      </span>
      <span className="w-14 shrink-0 text-right">
        {band.priced || band.costUsd > 0 ? formatUsd(band.costUsd) : "-"}
      </span>
    </span>
  );
}

/** One model's row group: the model name over its token bands. */
function ModelRows({
  model,
  showSubagents,
  subagent,
}: {
  model: UsageRow;
  showSubagents: boolean;
  subagent?: UsageRow;
}) {
  const bands = model.bands
    .map((band, i) => ({ band, sub: subagent?.bands[i] }))
    // A zero cache-write band is noise for providers that never write it.
    .filter(({ band, sub }) => !(band.label === "Cache write" && !band.tokens && !sub?.tokens));
  return (
    <TableBody className="border-border/60">
      <TableRow className="border-border/60 border-t hover:bg-transparent">
        <th colSpan={showSubagents ? 2 : 1} scope="rowgroup" className="pt-2.5 pb-1 text-left">
          <span className="text-foreground truncate font-medium">{model.label}</span>
        </th>
        <TableCell className="pt-2.5 pb-1 text-right align-top">
          {model.priced || model.costUsd > 0 ? (
            <span>{formatUsd(model.costUsd)}</span>
          ) : (
            <span className="text-muted-foreground">no pricing</span>
          )}
        </TableCell>
      </TableRow>
      {bands.map(({ band, sub }) => (
        <TableRow key={band.label} className="text-muted-foreground hover:bg-transparent">
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
            {showSubagents && sub ? <TokenBandCell band={sub} /> : null}
          </TableCell>
          <TableCell className="pb-0.5 pr-0">
            <TokenBandCell band={band} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}

export interface UsagePopoverProps {
  used: number;
  max?: number;
  threadId: string;
  /** Subagents of this thread (the column appears when non-empty). */
  hasSubagents: boolean;
  /** Children: the ring trigger itself. */
  children: React.ReactNode;
  /** Runs /compact; the popup shows it as "Compact in place". */
  onCompact?: () => void;
}

export function UsagePopover({
  used,
  max,
  threadId,
  hasSubagents,
  children,
  onCompact,
}: UsagePopoverProps) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!open) return;
    let live = true;
    setState("loading");
    codeApi
      .usage(threadId)
      .then((r) => {
        if (!live) return;
        setReport(r);
        setState("idle");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [open, threadId]);

  const showSubagents = hasSubagents && (report?.subagents.length ?? 0) > 0;
  const pct = max && used ? Math.min(100, Math.round((used / max) * 100)) : null;
  const empty = report && report.models.length === 0 && report.other.length === 0;

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
          data-has-subagents={showSubagents ? "" : undefined}
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

            {!report ? (
              state === "error" ? (
                <p className="text-muted-foreground py-3">Usage is not available right now.</p>
              ) : (
                <p className="text-muted-foreground flex items-center gap-1.5 py-3">
                  <Spinner className="size-3" /> Loading usage…
                </p>
              )
            ) : empty ? (
              <p className="text-muted-foreground py-3">No usage data yet.</p>
            ) : (
              <Table className="table-fixed text-xs tabular-nums">
                <colgroup>
                  <col className="w-[38%]" />
                  {showSubagents && <col />}
                  <col />
                </colgroup>
                <TableHeader>
                  <TableRow className="text-muted-foreground hover:bg-transparent">
                    <TableHead scope="col" className="px-0 pt-0 pb-1.5 text-left">
                      Model / tokens
                    </TableHead>
                    {showSubagents && (
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
                      colSpan={showSubagents ? 2 : 1}
                      className="pl-0 pt-1.5 text-left"
                    >
                      Total
                    </th>
                    <TableCell className="pr-0 pt-1.5 text-right">
                      ≈{formatUsd(report.totalUsd)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="hover:bg-transparent">
                    <th scope="row" className="pl-0 pb-1.5 text-left font-normal">
                      Subtotal
                    </th>
                    <TableCell className="pr-0 pb-1.5 text-right">
                      {formatUsd(report.mainUsd)}
                    </TableCell>
                    {showSubagents && (
                      <TableCell className="pr-0 pb-1.5 text-right">
                        {formatUsd(report.subagentUsd)}
                      </TableCell>
                    )}
                  </TableRow>
                </TableBody>
                {report.models.map((m) => (
                  <ModelRows
                    key={m.label}
                    model={m}
                    showSubagents={showSubagents}
                    subagent={report.subagents.find((s) => s.label === m.label)}
                  />
                ))}
                {report.other.length > 0 && (
                  <TableBody className="border-border/60">
                    <TableRow className="border-border/60 border-t hover:bg-transparent">
                      <th
                        scope="row"
                        colSpan={showSubagents ? 2 : 1}
                        className="pl-0 pt-2.5 pb-1 text-left"
                      >
                        <span className="text-foreground truncate font-medium">
                          Other (indirect)
                        </span>
                      </th>
                      <TableCell className="pr-0 pt-2.5 pb-1 text-right align-top">
                        {formatUsd(report.otherUsd)}
                      </TableCell>
                    </TableRow>
                    {report.other.map((p) => (
                      <TableRow
                        key={p.label}
                        className="text-muted-foreground hover:bg-transparent"
                      >
                        <th scope="row" className="pl-0 pb-0.5 text-left font-normal">
                          {p.label}
                        </th>
                        <TableCell className="pb-0.5 pr-0" colSpan={showSubagents ? 2 : 1}>
                          <span className="flex items-baseline justify-end gap-1.5">
                            <span>{formatTokenCount(p.tokens ?? 0)}</span>
                            <span className="text-muted-foreground/70">
                              {p.calls ?? 0} {p.calls === 1 ? "call" : "calls"}
                            </span>
                            <span className="w-14 shrink-0 text-right">
                              {p.priced || p.costUsd > 0 ? formatUsd(p.costUsd) : "-"}
                            </span>
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                )}
              </Table>
            )}

            {report?.notes.map((note) => (
              <p key={note} className="text-muted-foreground mt-2">
                {note}
              </p>
            ))}
          </div>
          {onCompact && (
            <div className="border-border/60 border-t p-2">
              <button
                type="button"
                onClick={() => {
                  onCompact();
                  setOpen(false);
                }}
                className="border-primary/60 text-primary hover:bg-primary/10 w-full rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
              >
                Compact in Place
              </button>
            </div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
