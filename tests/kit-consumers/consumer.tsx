/**
 * Compiled consumer fixture for the shipped kit surface.
 *
 * This file is what a child project's code looks like. `pnpm typecheck:kit`
 * compiles it, so deleting a public kit export breaks CI the same way it
 * broke downstream projects in f191f76. Imports below cover the capabilities
 * restored by 9e5602a plus every entrypoint the import census in
 * evidence/architecture-audit.md records as consumed downstream
 * (groot in-repo importers and the finance app). Every @groot/ui and
 * @groot/jobs subpath here is also an explicit entrypoint in the package's
 * exports map; scripts/check-kit-exports.ts fails when the two lists drift.
 *
 * Types are exercised, not just imported: typeof checks, type annotations,
 * and light call signatures. The fixture is never executed.
 */

import type { ReactNode } from "react";

// The seven capabilities restored by 9e5602a on demonstrated child demand.
import { Alert, AlertTitle, AlertDescription } from "@groot/ui/alert";
import { Pagination, PaginationContent } from "@groot/ui/pagination";
import { Select, SelectTrigger, SelectValue } from "@groot/ui/select";
import { Tooltip, TooltipProvider } from "@groot/ui/tooltip";
import { addBreadcrumb, logPerformance, logger, type Breadcrumb } from "@groot/core/logger";
import { copyFile } from "@groot/core/storage/storage.service";

// Every other explicit @groot/ui entrypoint (census: groot apps/packages,
// tests, and the finance app).
import { Badge } from "@groot/ui/badge";
import { Breadcrumb as UiBreadcrumb } from "@groot/ui/breadcrumb";
import { Button, type ButtonProps } from "@groot/ui/button";
import { Card, CardContent } from "@groot/ui/card";
import { Checkbox } from "@groot/ui/checkbox";
import { Command, CommandInput } from "@groot/ui/command";
import { Dialog, DialogContent } from "@groot/ui/dialog";
import { DataField, DataFields } from "@groot/ui/display";
import { DropdownMenu, DropdownMenuTrigger } from "@groot/ui/dropdown-menu";
import { EmptyState, ErrorState } from "@groot/ui/empty-state";
import { Form, Field } from "@groot/ui/form";
import { Input } from "@groot/ui/input";
import { InputGroup } from "@groot/ui/input-group";
import { Label } from "@groot/ui/label";
import { cn } from "@groot/ui/lib/utils";
import { listRowClass, listRowGridClass } from "@groot/ui/list-row";
import { Skeleton, SkeletonList } from "@groot/ui/loading-skeleton";
import { LoadingSpinner, LoadingState } from "@groot/ui/loading-spinner";
// @groot/ui primitives (alert-dialog, confirm) and the package barrel sides of jobs.
import { ConfirmProvider, useConfirm } from "@groot/ui/primitives";
import { AlertDialog, AlertDialogAction } from "@groot/ui/primitives/alert-dialog";
import { type ConfirmOptions } from "@groot/ui/primitives/confirm";
import { GrootUIProvider } from "@groot/ui/provider";
import { Toaster } from "@groot/ui/sonner";
import { StatTile } from "@groot/ui/stat-tile";
import { StatusBadge, type StatusVariant } from "@groot/ui/status-badge";
import { Table, TableBody } from "@groot/ui/table";
import { Tabs, TabsList } from "@groot/ui/tabs";
import { Textarea } from "@groot/ui/textarea";
import { Text, titleClass } from "@groot/ui/typography";

// The @groot/ui barrel, alongside the subpaths above.
import { Button as ButtonFromBarrel, Toaster as ToasterFromBarrel } from "@groot/ui";

// @groot/jobs server surface.
import { initJobQueue, stopJobQueue, getJobQueue } from "@groot/jobs/server";
import { type JobQueueAdapter, type QueueJob } from "@groot/jobs/server/adapter";
import { registerJobHandler, startWorkers, stopWorkers } from "@groot/jobs/server/worker";
import { addJob, scheduleJob, deleteJob } from "@groot/jobs/server/queue";
import { createJobLogger } from "@groot/jobs/server/logger";
import { jobRoutes } from "@groot/jobs/server/routes";
import { getJobQueue as getQueueFromModule } from "@groot/jobs/server/client";
import { jobConfig } from "@groot/jobs/server/config";
import { JOB_STATES, isReservedQueueName } from "@groot/jobs/server/constants";
import { withSentryErrorCapture } from "@groot/jobs/server/error-handler";
import { HonkerAdapter } from "@groot/jobs/server/honker-adapter";
import { PgBossAdapter } from "@groot/jobs/server/pgboss-adapter";
import { createJobSchema } from "@groot/jobs/server/validation";
import { getJobsByState } from "@groot/jobs/server/queries";
import { type JobQueryResponse } from "@groot/jobs/server/types";
import { create as createJobController } from "@groot/jobs/server/controller";

// @groot/jobs client surface.
import { jobsApi, Jobs, JobDetail } from "@groot/jobs/client";
import { jobsApi as jobsApiFromModule } from "@groot/jobs/client/api";
import { JobDetail as JobDetailPage } from "@groot/jobs/client/JobDetail";
import { Jobs as JobsPage } from "@groot/jobs/client/Jobs";
import { type Job, type JobStats, type JobName } from "@groot/jobs/client/types";
import { formatJobId } from "@groot/jobs/client/utils";
import { STATE_TABS } from "@groot/jobs/client/constants";
import { JobJsonBlock } from "@groot/jobs/client/components/JobJsonBlock";
import { JobDataView } from "@groot/jobs/client/components/JobDataView";
import { JobsTable } from "@groot/jobs/client/components/JobsTable";
import { JobLogs } from "@groot/jobs/client/components/JobLogs";
import { JobsFilters } from "@groot/jobs/client/components/JobsFilters";
import { JobsStats } from "@groot/jobs/client/components/JobsStats";
import { JobActions } from "@groot/jobs/client/components/JobActions";
import { JobOverview } from "@groot/jobs/client/components/JobOverview";
import { JobTypeSelect } from "@groot/jobs/client/components/JobTypeSelect";
import { AddJobDialog } from "@groot/jobs/client/components/AddJobDialog";
import { ScheduleJobDialog } from "@groot/jobs/client/components/ScheduleJobDialog";
import { EditScheduledJobDialog } from "@groot/jobs/client/components/EditScheduledJobDialog";
import { ScheduledJobsPanel } from "@groot/jobs/client/components/ScheduledJobsPanel";
import { JobsProvider, useJobDataLink } from "@groot/jobs/client/components/JobDataLinkContext";
import { JobsTableSkeleton } from "@groot/jobs/client/components/skeletons";
import { useJobs } from "@groot/jobs/client/useJobs";
import { useJobDetail } from "@groot/jobs/client/useJobDetail";

// @groot/shell pages, transport, and state.
import { Layout } from "@groot/shell/components/Layout";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { PageContainer } from "@groot/shell/components/layout/PageContainer";
import { apiClient, type ApiResponse } from "@groot/shell/lib/api";
import { formatRelativeTime } from "@groot/shell/lib/utils";
import { useAuthStore } from "@groot/shell/store/auth";
import { useStorageFiles, type StorageFile } from "@groot/shell/pages/storage/hooks/useStorage";
import { settingsService } from "@groot/shell/services/settings";

// @groot/core database singleton, errors, config, kv.
import { prisma, type PrismaClient } from "@groot/core/database";
import { type DbEngine, dbEngine } from "@groot/core/database/engine";
import { HttpError, type HttpErrorOutput } from "@groot/core/errors";
import { config, type Config } from "@groot/core/config";
import { kv } from "@groot/core/kv";
import { getContentType, sanitizeFileName } from "@groot/core/storage/storage.utils";
import type { FileInfo } from "@groot/core/storage/storage.service";

// @groot/ai client.
import { AIClient, type PromptDefinition } from "@groot/ai";

// typeof checks: the imported values carry the shapes downstream code relies on.
const checks = {
  restoredKit: [Alert, Pagination, Select, Tooltip, addBreadcrumb, logPerformance, copyFile],
  uiBarrel: [ButtonFromBarrel, ToasterFromBarrel, Form, Field],
  uiKit: [
    Badge,
    UiBreadcrumb,
    Button,
    Card,
    Checkbox,
    Command,
    CommandInput,
    Dialog,
    DialogContent,
    DataField,
    DropdownMenu,
    DropdownMenuTrigger,
    EmptyState,
    ErrorState,
    Input,
    InputGroup,
    Label,
    cn,
    listRowClass,
    listRowGridClass,
    Skeleton,
    SkeletonList,
    LoadingSpinner,
    LoadingState,
    ConfirmProvider,
    AlertDialog,
    AlertDialogAction,
    GrootUIProvider,
    Toaster,
    StatTile,
    StatusBadge,
    Table,
    TableBody,
    Tabs,
    TabsList,
    Textarea,
    Text,
  ],
  jobsServer: [
    initJobQueue,
    stopJobQueue,
    getQueueFromModule,
    jobConfig,
    isReservedQueueName,
    JOB_STATES,
    withSentryErrorCapture,
    HonkerAdapter,
    PgBossAdapter,
    createJobSchema,
    getJobsByState,
    createJobController,
    registerJobHandler,
    startWorkers,
    stopWorkers,
    addJob,
    scheduleJob,
    deleteJob,
    createJobLogger,
    jobRoutes,
  ],
  jobsClient: [
    jobsApi,
    jobsApiFromModule,
    Jobs,
    JobsPage,
    JobDetail,
    JobDetailPage,
    formatJobId,
    JobJsonBlock,
    JobDataView,
    JobsTable,
    JobLogs,
    JobsFilters,
    JobsStats,
    JobActions,
    JobOverview,
    JobTypeSelect,
    AddJobDialog,
    ScheduleJobDialog,
    EditScheduledJobDialog,
    ScheduledJobsPanel,
    JobsProvider,
    useJobDataLink,
    JobsTableSkeleton,
    useJobs,
    useJobDetail,
    STATE_TABS,
  ],
  shell: [
    Layout,
    PageLayout,
    PageContainer,
    apiClient,
    formatRelativeTime,
    useAuthStore,
    useStorageFiles,
    settingsService,
  ],
  core: [prisma, dbEngine, HttpError, config, kv, getContentType, sanitizeFileName, logger],
  ai: [AIClient],
};
export { checks };

// Signatures and types a child project would actually write.
addBreadcrumb("sync", "fixture compiled", "info", { fixture: true });
logPerformance({ operation: "fixture-compile", duration: 1 });

const queue: JobQueueAdapter = getJobQueue();
void queue;
const queueJob: QueueJob = {
  id: "0",
  name: "example",
  data: {},
  state: "created",
  priority: 1,
  retrylimit: 0,
  retrycount: 0,
  retrydelay: 0,
  retrybackoff: false,
  startafter: new Date(0).toISOString(),
  startedon: null,
  singletonkey: null,
  singletonon: null,
  expirein: "5m",
  createdon: new Date(0).toISOString(),
  completedon: null,
  keepuntil: new Date(0).toISOString(),
  output: null,
  deadletter: null,
};
void queueJob;
const stats: JobStats = {
  active: 0,
  created: 1,
  retry: 0,
  failed: 0,
  completed: 0,
  expired: 0,
  cancelled: 0,
};
const jobName: JobName = "example.job";
void jobName;
const response: ApiResponse<JobStats> = { success: true, data: stats };
void response;
const engine: DbEngine = dbEngine;
const breadcrumb: Breadcrumb = {
  timestamp: new Date().toISOString(),
  category: "fixture",
  message: "compiled",
  level: "info",
};
void breadcrumb;
const db: PrismaClient = prisma;
void db;
const uploaded: FileInfo = {
  key: "tmp/kit.txt",
  name: "kit.txt",
  size: 1,
  lastModified: new Date(),
  isDirectory: false,
};
void uploaded;
const status: StatusVariant = "info";

// Signature and type baselines a child project relies on. Exported so the
// compiler and linter both treat each as used kit surface.
export type JobHandlerPrompt = PromptDefinition<string, JobStats>;
export type ErrorShape = HttpErrorOutput["code"];
export const jobStates: typeof JOB_STATES = JOB_STATES;
export type ConfirmHook = ReturnType<typeof useConfirm>;
export type ButtonSize = ButtonProps["size"];
export type ConfirmOptionsShape = ConfirmOptions;
export type JobQueryShape = JobQueryResponse;
export type DashboardJob = Job;
export type StoredFile = StorageFile;
export type AppConfig = Config;
export const jobStatesProbed: boolean = jobStates !== undefined;
export const confirmHookShape: string = typeof useConfirm();

function KitConsumerPage({ children }: { children: ReactNode }) {
  return (
    <GrootUIProvider>
      <TooltipProvider>
        <Layout navItems={[]} />
        <PageLayout title="Kit consumers">
          <Card>
            <CardContent>
              <Text className={titleClass}>Kit surface</Text>
              <p className={cn(listRowClass, listRowGridClass)}>
                <Badge variant="default">fixture</Badge>
                <StatusBadge status={status} label="compiled" />
              </p>
              <DataFields>
                <DataField label="engine">{engine}</DataField>
              </DataFields>
              <Select>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </Select>
            </CardContent>
          </Card>
          <Alert>
            <AlertTitle>Kit fixture</AlertTitle>
            <AlertDescription>{children}</AlertDescription>
          </Alert>
          <Pagination>
            <PaginationContent />
          </Pagination>
          <Tooltip content="kit">
            <Button size="sm" variant="default">
              tooltip child
            </Button>
          </Tooltip>
        </PageLayout>
      </TooltipProvider>
    </GrootUIProvider>
  );
}

export function KitConsumers() {
  const confirm = useConfirm();
  const storageFiles = useStorageFiles("tmp/");
  void confirm;
  void storageFiles;
  return <KitConsumerPage>consumer fixture compiled</KitConsumerPage>;
}
