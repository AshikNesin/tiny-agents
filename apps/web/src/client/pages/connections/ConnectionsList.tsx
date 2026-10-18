import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plug, Plus } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Card } from "@groot/ui/card";
import { EmptyState } from "@groot/ui/empty-state";
import { listRowClass } from "@groot/ui/list-row";
import { monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout, Section } from "@groot/shell/components/layout";
import { connectionsApi, type Connection } from "../../lib/connections-api";
import { subscribeSse } from "../../lib/sse";
import { AddConnectionDialog } from "../../components/connections/AddConnectionDialog";
import {
  ConnectionStatusBadge,
  errorMessage,
  needsAttention,
} from "../../components/connections/connection-status";

function metaLine(connection: Connection): string {
  const tools = connection.tools.length === 1 ? "1 tool" : `${connection.tools.length} tools`;
  const bots = connection.botIds.length === 1 ? "1 bot" : `${connection.botIds.length} bots`;
  return `${tools} · used by ${bots}`;
}

function ConnectionRows({ connections }: { connections: Connection[] }) {
  return (
    <Card className="divide-y overflow-hidden p-0">
      <ul role="list">
        {connections.map((connection) => (
          <li key={connection.id}>
            <Link to={`/connections/${connection.id}`} className={listRowClass}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{connection.name}</p>
                <p className={cn(monoClass, "mt-0.5 block truncate text-muted-foreground")}>
                  {connection.url}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{metaLine(connection)}</p>
              </div>
              <ConnectionStatusBadge status={connection.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ConnectionsList() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setConnections(await connectionsApi.list());
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error, "Failed to load connections"));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const events = subscribeSse("/api/v1/events", (event) => {
      if ((event as { type?: string }).type === "connection") void refresh();
    });
    return () => events.close();
  }, [refresh]);

  const groups = useMemo(
    () => ({
      attention: (connections ?? []).filter((connection) => needsAttention(connection.status)),
      connected: (connections ?? []).filter((connection) => !needsAttention(connection.status)),
    }),
    [connections],
  );

  return (
    <PageLayout
      title="Connections"
      description="MCP servers your bots can use."
      maxWidth="4xl"
      actions={
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Add connection
        </Button>
      }
    >
      {loadError ? (
        <EmptyState
          icon={Plug}
          title="Couldn't load connections"
          description={loadError}
          variant="destructive"
          action={
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : connections === null ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No connections yet"
          description="Any remote MCP server works — add one to give your bots its tools."
          action={<Button onClick={() => setAddOpen(true)}>Add connection</Button>}
        />
      ) : (
        <>
          {groups.attention.length > 0 && (
            <Section title="Needs attention" meta={String(groups.attention.length)}>
              <ConnectionRows connections={groups.attention} />
            </Section>
          )}
          <Section title="Connected" meta={String(groups.connected.length)}>
            <ConnectionRows connections={groups.connected} />
          </Section>
        </>
      )}

      <AddConnectionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(connection) => {
          setAddOpen(false);
          void navigate(`/connections/${connection.id}`);
        }}
      />
    </PageLayout>
  );
}
