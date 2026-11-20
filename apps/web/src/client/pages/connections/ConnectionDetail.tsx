import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Wrench } from "lucide-react";
import { Breadcrumbs } from "@groot/ui/breadcrumb";
import { Button } from "@groot/ui/button";
import { EmptyState } from "@groot/ui/empty-state";
import { monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { connectionAuth } from "../../lib/connection-auth";
import { useConnection, useConnectionMutations, useSetConnection } from "../../queries/connections";
import { useStepUp } from "../../components/vault/StepUp";
import { onConnectionChange, useBotsStore } from "../../store/bots";
import {
  ConnectionStatusBadge,
  errorMessage,
} from "../../components/connections/connection-status";
import { ConnectionBotsSection } from "./detail/ConnectionBotsSection";
import { ConnectionStatusCard } from "./detail/ConnectionStatusCard";
import { ConnectionToolsSection } from "./detail/ConnectionToolsSection";
import { ConnectionDangerZone, RemoveConnectionDialog } from "./detail/RemoveConnection";

export function ConnectionDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data: connection, loadError, refresh } = useConnection(id);
  const setConnection = useSetConnection(id);
  const mutations = useConnectionMutations();
  const bots = useBotsStore((s) => (s.loading && s.bots.length === 0 ? null : s.bots));
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { run } = useStepUp();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) {
    setShownId(id);
    setConfirmRemove(false);
  }

  useEffect(
    () =>
      onConnectionChange((change) => {
        if (change.id === id) void refresh();
      }),
    [id, refresh],
  );

  useEffect(
    () =>
      connectionAuth.onCompleted(id, ({ error }) => {
        if (error) toast.error(error);
        else toast.success("Signed in");
        void refresh();
      }),
    [id, refresh],
  );

  const reconnect = async () => {
    setBusy(true);
    try {
      setConnection(await mutations.reconnect.mutateAsync(id));
      toast.success("Reconnect started");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to reconnect"));
    } finally {
      setBusy(false);
    }
  };

  const signIn = () => {
    setBusy(true);
    const started = connectionAuth.signIn(id);
    void started.then((outcome) => {
      if (outcome.status === "no_url") toast.error("No sign-in URL returned");
      else if (outcome.status === "blocked") toast.error("Allow pop-ups to finish signing in");
      else if (outcome.status === "failed")
        toast.error(errorMessage(outcome.error, "Failed to start sign-in"));
      setBusy(false);
    });
  };

  const toggleBot = async (botId: string, enable: boolean) => {
    if (!connection) return;
    const botIds = enable
      ? [...connection.botIds, botId]
      : connection.botIds.filter((existing) => existing !== botId);
    setConnection({ ...connection, botIds });
    try {
      setConnection(await mutations.update.mutateAsync({ id, input: { botIds } }));
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update bots"));
      await refresh();
    }
  };

  const toggleTool = async (serverName: string, enabled: boolean) => {
    if (!connection) return;
    const tools = connection.tools.map((tool) =>
      tool.serverName === serverName ? { ...tool, enabled } : tool,
    );
    setConnection({ ...connection, tools });
    try {
      await mutations.updateTool.mutateAsync({ id, tool: serverName, input: { enabled } });
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update tool"));
      await refresh();
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      const removed = await run(async () => {
        await mutations.remove.mutateAsync(id);
        return true;
      });
      if (!removed) {
        setRemoving(false);
        return;
      }
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
      <PageLayout title="Connections" maxWidth="4xl" backTo="/connections">
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
      <PageLayout title="Connections" maxWidth="4xl" backTo="/connections">
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      </PageLayout>
    );
  }

  const breadcrumb = (
    <Breadcrumbs page={connection.name}>
      <Link to="/connections">Connections</Link>
    </Breadcrumbs>
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
      backTo="/connections"
    >
      <ConnectionStatusCard
        connection={connection}
        busy={busy}
        onSignIn={signIn}
        onReconnect={() => void reconnect()}
      />

      <ConnectionToolsSection
        id={id}
        connection={connection}
        onToggleTool={(serverName, enabled) => void toggleTool(serverName, enabled)}
      />

      <ConnectionBotsSection
        connection={connection}
        bots={bots}
        onToggleBot={(botId, enable) => void toggleBot(botId, enable)}
      />

      <ConnectionDangerZone connection={connection} onRemove={() => setConfirmRemove(true)} />

      <RemoveConnectionDialog
        connection={connection}
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        removing={removing}
        onRemove={() => void remove()}
      />
    </PageLayout>
  );
}
