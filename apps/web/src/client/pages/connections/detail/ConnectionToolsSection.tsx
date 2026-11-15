import { Link } from "react-router-dom";
import { ChevronRight, Wrench } from "lucide-react";
import { Badge } from "@groot/ui/badge";
import { Card } from "@groot/ui/card";
import { EmptyState } from "@groot/ui/empty-state";
import { listRowClass } from "@groot/ui/list-row";
import { cn } from "@groot/ui/lib/utils";
import { Section } from "@groot/shell/components/layout/Section";
import type { Connection } from "../../../../shared/api/connections";
import { Switch } from "../../../components/ui/switch";

function toolsMeta(tools: Connection["tools"]): string {
  const count = tools.length === 1 ? "1 tool" : `${tools.length} tools`;
  const off = tools.filter((tool) => !tool.enabled).length;
  return off === 0 ? count : `${count} · ${off} off`;
}

function toolsEmptyDescription(connection: Connection): string {
  switch (connection.status) {
    case "connecting":
      return "Tools will appear once the server responds.";
    case "needs_auth":
      return "Sign in to load this server's tools.";
    case "error":
      return "Tools couldn't be loaded. Try reconnecting.";
    default:
      return "This server exposes no tools.";
  }
}

/** The server's tools, each a link to its page and a switch for every bot. */
export function ConnectionToolsSection({
  id,
  connection,
  onToggleTool,
}: {
  id: string;
  connection: Connection;
  onToggleTool: (serverName: string, enabled: boolean) => void;
}) {
  return (
    <Section
      title="Tools"
      description="Tools turned off here are hidden from every bot. Open a tool for its schema and a playground."
      meta={toolsMeta(connection.tools)}
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
                <Link
                  to={`/connections/${id}/tools/${encodeURIComponent(tool.serverName)}`}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm font-medium",
                        tool.enabled ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {tool.label}
                    </p>
                    {tool.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {tool.description}
                      </p>
                    )}
                  </div>
                  {tool.readOnly && <Badge variant="outline">read-only</Badge>}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
                <Switch
                  checked={tool.enabled}
                  onCheckedChange={(checked) => onToggleTool(tool.serverName, checked)}
                  aria-label={`Let bots use ${tool.label}`}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}
