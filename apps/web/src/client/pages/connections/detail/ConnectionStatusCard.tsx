import { LogIn, RefreshCw } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@groot/ui/card";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import type { Connection } from "../../../../shared/api/connections";
import {
  ConnectionStatusBadge,
  authDescription,
} from "../../../components/connections/connection-status";

/** The connection's status, how it signs in and when it was added; Sign in and Reconnect. */
export function ConnectionStatusCard({
  connection,
  busy,
  onSignIn,
  onReconnect,
}: {
  connection: Connection;
  busy: boolean;
  onSignIn: () => void;
  onReconnect: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Status</CardTitle>
        <CardAction className="flex gap-2">
          {connection.status === "needs_auth" && (
            <Button onClick={onSignIn} disabled={busy}>
              <LogIn className="size-4" />
              Sign in
            </Button>
          )}
          <Button variant="outline" onClick={onReconnect} disabled={busy}>
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
  );
}
