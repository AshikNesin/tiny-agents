import { Card, CardContent, CardHeader, CardTitle } from "@groot/ui/card";
import { DataField, DataFields } from "@groot/ui/display";
import { formatLocaleDateTime, formatRelativeTime } from "@groot/shell/lib/utils";
import type { Job } from "@groot/jobs/client/types";
import dayjs from "dayjs";

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "N/A";
  const duration = dayjs(end).diff(dayjs(start), "second", true);
  return `${duration.toFixed(2)}s`;
}

/** Read-only metadata grid for a job (priority, retries, timestamps, retention…). */
export function JobOverview({ job }: { job: Job }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <DataFields>
          <DataField label="Priority">{job.priority}</DataField>
          <DataField label="Retries">
            {job.retrycount} / {job.retrylimit}
          </DataField>
          <DataField label="Created">
            <span title={job.createdon ? formatLocaleDateTime(job.createdon) : "N/A"}>
              {job.createdon ? formatRelativeTime(job.createdon) : "N/A"}
            </span>
          </DataField>
          <DataField label="Started">
            <span title={job.startedon ? formatLocaleDateTime(job.startedon) : "N/A"}>
              {job.startedon ? formatRelativeTime(job.startedon) : "—"}
            </span>
          </DataField>
          <DataField label="Completed">
            <span title={job.completedon ? formatLocaleDateTime(job.completedon) : "N/A"}>
              {job.completedon ? formatRelativeTime(job.completedon) : "—"}
            </span>
          </DataField>
          <DataField label="Duration">{formatDuration(job.startedon, job.completedon)}</DataField>
          <DataField label="Retry Delay">{job.retrydelay}s</DataField>
          <DataField label="Retry Backoff">{job.retrybackoff ? "Yes" : "No"}</DataField>
          <DataField label="Expire In">{job.expirein}</DataField>
          <DataField label="Keep Until">
            <span title={job.keepuntil ? formatLocaleDateTime(job.keepuntil) : "N/A"}>
              {job.keepuntil ? formatRelativeTime(job.keepuntil) : "N/A"}
            </span>
          </DataField>
        </DataFields>
      </CardContent>
    </Card>
  );
}
