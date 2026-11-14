/**
 * Code (issue #143, ADR 0011): one workspace for the owner's coding agents
 * ("harnesses": Shelley, Claude Code). tiny-agents runs no agent loop; each
 * harness is driven through its adapter on the server, every thread and
 * subagent, live transcripts, steering, approvals and the diff of what
 * changed, and the page shows only what a thread's harness can do.
 *
 * Layout: list | thread | changes on wide screens (the list steps aside for
 * Changes until 2xl); one column at a time on phones (`/code` →
 * `/code/new` or `/code/:id` → `/code/:id/changes`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Code2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { CommandPaletteTrigger } from "@groot/shell/components/CommandPalette";
import { useShellConfig } from "@groot/shell/lib/shell-config";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { codeApi, instanceOf, normalizeThreadId, threadPath } from "../../lib/code/api";
import { harnessOf, useCodeStore } from "../../store/code";
import { ChangesPanel } from "./ChangesPanel";
import { ConversationList } from "./ConversationList";
import { ConversationView } from "./ConversationView";
import { NewConversation } from "./NewConversation";

function SlugRedirect({ slug }: { slug: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    codeApi
      .byTitle(slug)
      .then((t) => navigate(threadPath(t.id), { replace: true }))
      .catch(() => {
        toast.error(`No thread “${slug}”.`);
        navigate("/code", { replace: true });
      });
  }, [slug, navigate]);
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

export function CodePage() {
  const { conversationId: rawId, slug } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { brand } = useShellConfig();
  const harnessList = useCodeStore((s) => s.harnesses);
  const statuses = useCodeStore((s) => s.statuses);
  const threads = useCodeStore((s) => s.threads);
  const [insert, setInsert] = useState<{ text: string; nonce: number } | null>(null);
  // The open thread's directory, for Changes even when it is not in the
  // active list (archived, or not in the list yet).
  const [viewCwd, setViewCwd] = useState<string | null>(null);
  const threadId = rawId ? normalizeThreadId(decodeURIComponent(rawId)) : undefined;
  const changesOpen = Boolean(threadId) && pathname.endsWith("/changes");
  // `/code/new` is the new-thread screen on phones (`/code` is the list there).
  const composing = pathname === "/code/new";
  const rows = useMemo(() => threads ?? [], [threads]);
  const row = rows.find((r) => r.id === threadId);
  const cwd = row?.cwd ?? viewCwd;
  // Live connection state over the static description.
  const harnesses = useMemo(
    () => (harnessList ?? []).map((h) => ({ ...h, status: statuses[h.id] ?? h.status })),
    [harnessList, statuses],
  );
  const harness = threadId ? harnessOf(harnesses, instanceOf(threadId)) : undefined;

  // Links from before the harness layer (`/code/<shelley id>`) move to the new id.
  useEffect(() => {
    if (rawId && !decodeURIComponent(rawId).includes(":")) {
      navigate(threadPath(normalizeThreadId(rawId), changesOpen ? "/changes" : ""), {
        replace: true,
      });
    }
  }, [rawId, changesOpen, navigate]);

  const toggleChanges = useCallback(() => {
    if (!threadId) return;
    navigate(changesOpen ? threadPath(threadId) : threadPath(threadId, "/changes"));
  }, [threadId, changesOpen, navigate]);

  // ⌘. stops the agent, ⌘⇧D toggles Changes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !threadId) return;
      if (event.key === ".") {
        event.preventDefault();
        codeApi
          .interrupt(threadId)
          .catch((error: unknown) => toast.error(errorMessage(error, "Could not stop it.")));
      } else if (event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        toggleChanges();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threadId, toggleChanges]);

  if (slug) return <SlugRedirect slug={slug} />;
  if (harnessList !== null && harnessList.length === 0) {
    return (
      <div className="flex h-dvh min-h-0 flex-col">
        <CodeHeader brand={brand} />
        <div className="mx-auto max-w-xl p-6">
          <EmptyState
            icon={Code2}
            title="No coding agent is connected"
            description={
              <>
                Set <code className={monoClass}>SHELLEY_URL</code> to your Shelley server (for
                example <code className={monoClass}>http://my-vm:9000</code> over Tailscale) and
                restart, or add the Claude plan in{" "}
                <Link
                  to="/settings/models"
                  className="text-foreground underline underline-offset-2"
                >
                  Settings → Models
                </Link>
                . See docs/features/code.md.
              </>
            }
          />
        </div>
      </div>
    );
  }
  if (harnessList === null) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (pathname.endsWith("/changes") && !threadId) return <Navigate to="/code" replace />;

  const offline = harnesses.filter((h) => h.status.state !== "connected");

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <CodeHeader brand={brand} />
      {offline.map((h) => (
        <div
          key={h.id}
          className={cn(
            "border-border flex items-center gap-2 border-b px-4 py-1.5 text-xs",
            h.status.state === "reconnecting" ? "text-warning" : "text-muted-foreground",
          )}
          role="status"
          data-testid="code-connection"
        >
          {h.status.state === "reconnecting" ? (
            <TriangleAlert className="size-3.5" />
          ) : h.status.state === "connecting" ? (
            <Spinner className="size-3.5" />
          ) : (
            <TriangleAlert className="size-3.5" />
          )}
          {h.status.state === "reconnecting"
            ? `${h.label} unreachable${h.status.detail ? `: ${h.status.detail}` : ""}}, retrying…`
            : h.status.state === "connecting"
              ? `Connecting to ${h.label}…`
              : `${h.label}: ${h.status.detail ?? "not ready"}`}
        </div>
      ))}
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "border-border w-full shrink-0 flex-col border-r md:w-72 xl:w-80",
            threadId || composing ? "hidden" : "flex",
            // With Changes open the list steps aside until there is room for all three.
            changesOpen ? "2xl:flex" : "md:flex",
          )}
        >
          <div className="flex items-center gap-1 px-2 pt-2 md:hidden">
            <span className="font-medium">Code</span>
          </div>
          <ConversationList threads={threads} harnesses={harnesses} activeId={threadId} />
        </aside>

        <main
          className={cn(
            "min-w-0 flex-1 flex-col",
            threadId
              ? changesOpen
                ? "hidden lg:flex"
                : "flex"
              : composing
                ? "flex"
                : "hidden md:flex",
          )}
        >
          {threadId && harness ? (
            <ConversationView
              key={threadId}
              id={threadId}
              harness={harness}
              rows={rows}
              externalUrl={row?.externalUrl}
              changesOpen={changesOpen}
              onToggleChanges={toggleChanges}
              insert={insert}
              onCwd={setViewCwd}
            />
          ) : threadId ? (
            <EmptyState
              icon={Code2}
              title="This coding agent is not connected"
              description="The thread belongs to a harness this server no longer runs."
            />
          ) : (
            <NewConversation rows={rows} harnesses={harnesses} />
          )}
        </main>

        {threadId && harness && changesOpen && cwd && harness.capabilities.workspace.diffs && (
          <section
            className="border-border flex w-full min-w-0 flex-col lg:w-[48%] lg:max-w-3xl lg:border-l"
            aria-label="Changes"
          >
            <ChangesPanel
              instanceId={harness.id}
              cwd={cwd}
              refreshKey={`${row?.working}:${row?.cursor}`}
              onClose={toggleChanges}
              onComment={(text) => {
                setInsert({ text, nonce: Date.now() });
                // On phones the composer is on the thread screen.
                if (window.matchMedia("(max-width: 1023px)").matches)
                  navigate(threadPath(threadId));
              }}
            />
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * The workspace owns the full column (the app sidebar stays away), so it
 * carries its own way back to the app, like the settings screen. The
 * not-configured state shows it too, or a direct link to `/code` is a dead end.
 */
function CodeHeader({ brand }: { brand: { to: string; label: string } }) {
  return (
    <header className="border-border bg-background sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <Link
        to={brand.to}
        className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-xl px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" />
        Back to {brand.label}
      </Link>
      <div className="ml-auto">
        <CommandPaletteTrigger />
      </div>
    </header>
  );
}
