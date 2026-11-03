/**
 * Code (issue #143): a first-class workspace for Shelley, the owner's coding
 * agent. tiny-agents runs no agent loop for it; everything here is Shelley's
 * own API through the app's curated proxy — every conversation and subagent,
 * live transcripts, steering, and the diff of what changed.
 *
 * Layout: list | conversation | changes on wide screens (the list steps
 * aside for Changes until 2xl); one column at a time on phones (`/code` →
 * `/code/new` or `/code/:id` → `/code/:id/changes`).
 */
import { useCallback, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Code2, Menu, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { useShellConfig } from "@groot/shell/lib/shell-config";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { shelleyApi } from "../../lib/shelley/api";
import { useShelleyStore } from "../../store/shelley";
import { ChangesPanel } from "./ChangesPanel";
import { ConversationList } from "./ConversationList";
import { ConversationView } from "./ConversationView";
import { NewConversation } from "./NewConversation";

function SlugRedirect({ slug }: { slug: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    shelleyApi
      .bySlug(slug)
      .then((c) => navigate(`/code/${c.conversation_id}`, { replace: true }))
      .catch(() => {
        toast.error(`No Shelley conversation “${slug}”.`);
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
  const { conversationId, slug } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { openNav } = useShellConfig();
  const configured = useShelleyStore((s) => s.configured);
  const connection = useShelleyStore((s) => s.connection);
  const conversations = useShelleyStore((s) => s.conversations);
  const publicUrl = useShelleyStore((s) => s.publicUrl);
  const [insert, setInsert] = useState<{ text: string; nonce: number } | null>(null);
  // The open conversation's directory, for Changes even when it is not in the
  // active list (archived, or not in the snapshot yet).
  const [viewCwd, setViewCwd] = useState<string | null>(null);
  const changesOpen = Boolean(conversationId) && pathname.endsWith("/changes");
  // `/code/new` is the new-conversation screen on phones (`/code` is the list there).
  const composing = pathname === "/code/new";
  const rows = conversations ?? [];
  const row = rows.find((r) => r.conversation_id === conversationId);
  const cwd = row?.cwd ?? viewCwd;

  const toggleChanges = useCallback(() => {
    if (!conversationId) return;
    navigate(changesOpen ? `/code/${conversationId}` : `/code/${conversationId}/changes`);
  }, [conversationId, changesOpen, navigate]);

  // ⌘. stops Shelley, ⌘⇧D toggles Changes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !conversationId) return;
      if (event.key === ".") {
        event.preventDefault();
        shelleyApi
          .action(conversationId, "cancel")
          .catch((error: unknown) => toast.error(errorMessage(error, "Could not stop Shelley.")));
      } else if (event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        toggleChanges();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conversationId, toggleChanges]);

  if (slug) return <SlugRedirect slug={slug} />;
  if (configured === false) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="mb-6 flex items-center gap-2 md:hidden">
          {openNav && (
            <Button variant="ghost" size="icon" onClick={openNav} aria-label="Open menu">
              <Menu />
            </Button>
          )}
        </div>
        <EmptyState
          icon={Code2}
          title="Shelley is not connected"
          description={
            <>
              Set <code className={monoClass}>SHELLEY_URL</code> to your Shelley server (for example{" "}
              <code className={monoClass}>http://my-vm:9000</code> over Tailscale) and restart. See
              docs/features/code.md.
            </>
          }
        />
      </div>
    );
  }
  if (configured === null) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (pathname.endsWith("/changes") && !conversationId) return <Navigate to="/code" replace />;

  const offline = connection.state !== "connected";

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      {offline && (
        <div
          className={cn(
            "border-border flex items-center gap-2 border-b px-4 py-1.5 text-xs",
            connection.state === "reconnecting" ? "text-warning" : "text-muted-foreground",
          )}
          role="status"
          data-testid="code-connection"
        >
          {connection.state === "reconnecting" ? (
            <TriangleAlert className="size-3.5" />
          ) : (
            <Spinner className="size-3.5" />
          )}
          {connection.state === "reconnecting"
            ? `Shelley unreachable${connection.error ? `: ${connection.error}` : ""} — retrying…`
            : "Connecting to Shelley…"}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "border-border w-full shrink-0 flex-col border-r md:w-72 xl:w-80",
            conversationId || composing ? "hidden" : "flex",
            // With Changes open the list steps aside until there is room for all three.
            changesOpen ? "2xl:flex" : "md:flex",
          )}
        >
          <div className="flex items-center gap-1 px-2 pt-2 md:hidden">
            {openNav && (
              <Button variant="ghost" size="icon" onClick={openNav} aria-label="Open menu">
                <Menu />
              </Button>
            )}
            <span className="font-medium">Code</span>
          </div>
          <ConversationList conversations={conversations} activeId={conversationId} />
        </aside>

        <main
          className={cn(
            "min-w-0 flex-1 flex-col",
            conversationId
              ? changesOpen
                ? "hidden lg:flex"
                : "flex"
              : composing
                ? "flex"
                : "hidden md:flex",
          )}
        >
          {conversationId ? (
            <ConversationView
              key={conversationId}
              id={conversationId}
              rows={rows}
              publicUrl={publicUrl}
              changesOpen={changesOpen}
              onToggleChanges={toggleChanges}
              insert={insert}
              onCwd={setViewCwd}
            />
          ) : (
            <NewConversation rows={rows} />
          )}
        </main>

        {conversationId && changesOpen && cwd && (
          <section
            className="border-border flex w-full min-w-0 flex-col lg:w-[48%] lg:max-w-3xl lg:border-l"
            aria-label="Changes"
          >
            <ChangesPanel
              cwd={cwd}
              refreshKey={`${row?.working}:${row?.max_sequence_id}`}
              onClose={toggleChanges}
              onComment={(text) => {
                setInsert({ text, nonce: Date.now() });
                // On phones the composer is on the conversation screen.
                if (window.matchMedia("(max-width: 1023px)").matches)
                  navigate(`/code/${conversationId}`);
              }}
            />
          </section>
        )}
      </div>
    </div>
  );
}
