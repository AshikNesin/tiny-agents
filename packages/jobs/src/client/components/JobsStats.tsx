import { Card } from "@groot/ui/card";
import { StatTile } from "@groot/ui/stat-tile";
import type { JobStats } from "@groot/jobs/client/types";
import { Activity, CheckCircle, Clock, RefreshCw, X, XCircle } from "lucide-react";
import { JobsStatsSkeleton } from "./skeletons";

type StatItem = {
  key: string;
  label: string;
  value: number;
  colorClass: string;
  icon: React.ReactNode;
};

type Props = {
  stats: JobStats | null;
  statsLoading?: boolean;
  activeState: string;
  onSelectState: (state: string) => void;
};

/** Compact, clickable stat row that filters the jobs list by state. */
export function JobsStats({ stats, statsLoading, activeState, onSelectState }: Props) {
  if (statsLoading || !stats) {
    return <JobsStatsSkeleton />;
  }

  const items: StatItem[] = [
    {
      key: "all",
      label: "Total",
      value: stats.active + stats.created + stats.retry + stats.failed + stats.completed,
      colorClass: "text-foreground",
      icon: <Activity className="size-3.5" />,
    },
    {
      key: "active",
      label: "Active",
      value: stats.active,
      colorClass: "text-info",
      icon: <Activity className="size-3.5" />,
    },
    {
      key: "created",
      label: "Created",
      value: stats.created,
      colorClass: "text-muted-foreground",
      icon: <Clock className="size-3.5" />,
    },
    {
      key: "retry",
      label: "Retry",
      value: stats.retry,
      colorClass: "text-warning",
      icon: <RefreshCw className="size-3.5" />,
    },
    {
      key: "failed",
      label: "Failed",
      value: stats.failed,
      colorClass: "text-destructive",
      icon: <XCircle className="size-3.5" />,
    },
    {
      key: "completed",
      label: "Completed",
      value: stats.completed,
      colorClass: "text-success",
      icon: <CheckCircle className="size-3.5" />,
    },
    {
      key: "cancelled",
      label: "Cancelled",
      value: stats.cancelled,
      colorClass: "text-muted-foreground",
      icon: <X className="size-3.5" />,
    },
  ];

  return (
    <Card size="sm" className="flex flex-row flex-wrap items-stretch gap-0 p-0">
      {items.map((item, idx) => (
        <StatTile
          key={item.key}
          label={item.label}
          value={item.value.toLocaleString()}
          icon={item.icon}
          active={activeState === item.key}
          onClick={() => onSelectState(item.key)}
          className={idx !== 0 ? "border-l border-border/60" : undefined}
        />
      ))}
    </Card>
  );
}
