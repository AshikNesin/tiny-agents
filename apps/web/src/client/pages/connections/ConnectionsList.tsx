import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plug, Plus } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Card } from "@groot/ui/card";
import { EmptyState } from "@groot/ui/empty-state";
import { listRowClass } from "@groot/ui/list-row";
import { monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { Section } from "@groot/shell/components/layout/Section";
import type { Connection } from "../../../shared/api/connections";
import { connectionAuth } from "../../lib/connection-auth";
import { useConnections } from "../../queries/connections";
import { onConnectionChange } from "../../store/bots";
import { AddConnectionDialog } from "../../components/connections/AddConnectionDialog";
import {
  ConnectionStatusBadge,
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
  const { data: connections, loadError, refresh } = useConnections();
  const [addOpen, setAddOpen] = useState(false);

  // Status changes ride the app's one events feed; a finished sign-in too.
  useEffect(() => {
    const offChange = onConnectionChange(() => void refresh());
    const offSignIn = connectionAuth.onCompleted(undefined, () => void refresh());
    return () => {
      offChange();
      offSignIn();
    };
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
          description="Any remote MCP server works. Add one to give your bots its tools."
        />
      ) : (
        <>
          {groups.attention.length > 0 && (
            <Section title="Needs attention" meta={String(groups.attention.length)}>
              <ConnectionRows connections={groups.attention} />
            </Section>
          )}
          {groups.connected.length > 0 && (
            <Section title="Connected" meta={String(groups.connected.length)}>
              <ConnectionRows connections={groups.connected} />
            </Section>
          )}
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
