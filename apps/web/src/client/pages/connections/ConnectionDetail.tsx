import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Bot, LogIn, RefreshCw, Trash2, Wrench } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@groot/ui/breadcrumb";
import { Badge } from "@groot/ui/badge";
import { Button } from "@groot/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@groot/ui/card";
import { Checkbox } from "@groot/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { EmptyState } from "@groot/ui/empty-state";
import { listRowClass } from "@groot/ui/list-row";
import { monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout, Section } from "@groot/shell/components/layout";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import { botsApi, type BotListEntry } from "../../lib/bots-api";
import { connectionsApi, type Connection } from "../../lib/connections-api";
import { subscribeSse } from "../../lib/sse";
import { BotAvatar } from "../../components/BotAvatar";
import {
  ConnectionStatusBadge,
  authDescription,
  errorMessage,
  openOAuthPopup,
} from "../../components/connections/connection-status";

interface OauthMessage {
  type?: string;
  id?: string;
  error?: string;
}

function toolsEmptyDescription(connection: Connection): string {
  switch (connection.status) {
    case "connecting":
      return "Tools will appear once the server responds.";
    case "needs_auth":
      return "Sign in to load this server's tools.";
    case "error":
      return "Tools couldn't be loaded — try reconnecting.";
    default:
      return "This server exposes no tools.";
  }
}

export function ConnectionDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bots, setBots] = useState<BotListEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setConnection(await connectionsApi.get(id));
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error, "Failed to load connection"));
    }
  }, [id]);

  useEffect(() => {
    setConnection(null);
    setLoadError(null);
    setConfirmRemove(false);
    void refresh();
    void botsApi
      .list()
      .then(setBots)
      .catch(() => setBots([]));
  }, [refresh]);

  useEffect(() => {
    const events = subscribeSse("/api/v1/events", (event) => {
      const typed = event as { type?: string; id?: string };
      if (typed.type === "connection" && typed.id === id) void refresh();
    });
    return () => events.close();
  }, [id, refresh]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as OauthMessage | null;
      if (data?.type !== "tiny-agents:oauth") return;
      if (data.id && data.id !== id) return;
      if (data.error) toast.error(data.error);
      else toast.success("Signed in");
      void refresh();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id, refresh]);

  const reconnect = async () => {
    setBusy(true);
    try {
      setConnection(await connectionsApi.reconnect(id));
      toast.success("Reconnect started");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to reconnect"));
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    setBusy(true);
    try {
      const { authorizationUrl } = await connectionsApi.authorize(id);
      if (!authorizationUrl) {
        toast.error("No sign-in URL returned");
        return;
      }
      if (!openOAuthPopup(authorizationUrl)) toast.error("Allow pop-ups to finish signing in");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to start sign-in"));
    } finally {
      setBusy(false);
    }
  };

  const toggleBot = async (botId: string, enable: boolean) => {
    if (!connection) return;
    const botIds = enable
      ? [...connection.botIds, botId]
      : connection.botIds.filter((existing) => existing !== botId);
    setConnection({ ...connection, botIds });
    try {
      setConnection(await connectionsApi.update(id, { botIds }));
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update bots"));
      await refresh();
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await connectionsApi.remove(id);
      toast.success("Connection removed");
      navigate("/connections");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to remove connection"));
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  if (loadError) {
    return (
      <PageLayout title="Connections" maxWidth="4xl">
        <EmptyState
          icon={Wrench}
          title="Couldn't load connection"
          description={loadError}
          variant="destructive"
          action={
            <>
              <Button variant="outline" asChild>
                <Link to="/connections">
                  <ArrowLeft className="size-4" />
                  Back to connections
                </Link>
              </Button>
              <Button onClick={() => void refresh()}>Retry</Button>
            </>
          }
        />
      </PageLayout>
    );
  }

  if (!connection) {
    return (
      <PageLayout title="Connections" maxWidth="4xl">
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      </PageLayout>
    );
  }

  const breadcrumb = (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/connections">Connections</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbPage>{connection.name}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );

  return (
    <PageLayout
      title={connection.name}
      description={
        <span className={cn(monoClass, "break-all text-muted-foreground")}>{connection.url}</span>
      }
      titleAdornment={<ConnectionStatusBadge status={connection.status} />}
      breadcrumb={breadcrumb}
      maxWidth="4xl"
    >
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardAction className="flex gap-2">
            {connection.status === "needs_auth" && (
              <Button onClick={() => void signIn()} disabled={busy}>
                <LogIn className="size-4" />
                Sign in
              </Button>
            )}
            <Button variant="outline" onClick={() => void reconnect()} disabled={busy}>
              <RefreshCw className="size-4" />
              Reconnect
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ConnectionStatusBadge status={connection.status} />
            <span className="text-xs text-muted-foreground">
              {authDescription(connection)} · added {formatRelativeTime(connection.createdAt)}
            </span>
          </div>
          {connection.error && <p className="text-sm text-destructive">{connection.error}</p>}
        </CardContent>
      </Card>

      <Section
        title="Tools"
        meta={connection.tools.length === 1 ? "1 tool" : `${connection.tools.length} tools`}
      >
        {connection.tools.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No tools yet"
            description={toolsEmptyDescription(connection)}
          />
        ) : (
          <Card className="divide-y overflow-hidden p-0">
            <ul role="list">
              {connection.tools.map((tool) => (
                <li key={tool.name} className={listRowClass}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{tool.label}</p>
                    {tool.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {tool.description}
                      </p>
                    )}
                  </div>
                  {tool.readOnly && <Badge variant="outline">read-only</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section
        title="Used by bots"
        meta={connection.botIds.length === 1 ? "1 bot" : `${connection.botIds.length} bots`}
      >
        {bots === null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : bots.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No bots yet"
            description="Create a bot to use these tools."
          />
        ) : (
          <Card className="divide-y overflow-hidden p-0">
            <ul role="list">
              {bots.map((bot) => (
                <li key={bot.id} className={listRowClass}>
                  <Checkbox
                    id={`connection-bot-${bot.id}`}
                    checked={connection.botIds.includes(bot.id)}
                    onCheckedChange={(checked) => void toggleBot(bot.id, checked === true)}
                    aria-label={`Use ${connection.name} tools in ${bot.name}`}
                  />
                  <label
                    htmlFor={`connection-bot-${bot.id}`}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                  >
                    <BotAvatar name={bot.name} className="size-8 text-xs" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {bot.name}
                      </span>
                      {bot.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {bot.description}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section title="Danger zone">
        <Card size="sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Remove connection</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {connection.botIds.length === 0
                  ? "Removes the server and its cached tools."
                  : connection.botIds.length === 1
                    ? "1 bot will lose these tools."
                    : `${connection.botIds.length} bots will lose these tools.`}
              </p>
            </div>
            <Button variant="destructive" onClick={() => setConfirmRemove(true)}>
              <Trash2 className="size-4" />
              Remove
            </Button>
          </CardContent>
        </Card>
      </Section>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove connection?</DialogTitle>
            <DialogDescription>
              {connection.botIds.length === 0
                ? `"${connection.name}" will be permanently removed.`
                : connection.botIds.length === 1
                  ? `1 bot will lose these tools. "${connection.name}" will be permanently removed.`
                  : `${connection.botIds.length} bots will lose these tools. "${connection.name}" will be permanently removed.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)} disabled={removing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={removing}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
