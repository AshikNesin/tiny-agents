import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, RefreshCw, Save } from "lucide-react";
import { Button } from "@groot/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@groot/ui/card";
import { cn } from "@groot/ui/lib/utils";
import { Checkbox } from "@groot/ui/checkbox";
import { Input } from "@groot/ui/input";
import { Label } from "@groot/ui/label";
import { Skeleton, SkeletonCard } from "@groot/ui/loading-skeleton";
import { StatusBadge } from "@groot/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@groot/ui/table";
import { Text } from "@groot/ui/typography";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import { useToastMutation } from "@groot/shell/hooks/useToastMutation";
import {
  notificationsService,
  type ChannelState,
  type NotificationCategory,
  type NotificationEventDef,
  type NotificationSettings as Settings,
} from "@groot/shell/services/notifications";

const STATUS_KEY = ["notifications", "status"] as const;
const SETTINGS_KEY = ["notifications", "settings"] as const;
const LOG_KEY = ["notifications", "log"] as const;

const STATE_BADGE: Record<ChannelState, { status: string; label: string }> = {
  connected: { status: "success", label: "Connected" },
  not_configured: { status: "pending", label: "Not configured" },
  unknown: { status: "info", label: "Not checked yet" },
  invalid_credentials: { status: "error", label: "Invalid credentials" },
  over_quota: { status: "warning", label: "Over quota" },
};

const LOG_BADGE: Record<string, string> = {
  sent: "success",
  queued: "pending",
  failed: "failed",
  suppressed: "cancelled",
  cancelled: "cancelled",
};

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  needs_input: "Needs you",
  notify: "Updates",
  security: "Security",
  system: "System",
};

/** The chosen channel is Pushover: its status, setup hint and test. */
function PushoverDetails() {
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: notificationsService.status,
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
      queryClient.invalidateQueries({ queryKey: LOG_KEY }),
    ]);
  };
  const test = useToastMutation(() => notificationsService.test(), {
    success: (result) =>
      result.ok
        ? { title: "Test notification sent", description: `Pushover request ${result.providerId}` }
        : { title: "Test notification failed", description: result.detail ?? result.reason },
    error: "Could not send a test notification",
    onSuccess: refresh,
  });
  const validate = useToastMutation(() => notificationsService.validate(), {
    success: "Checked with Pushover",
    error: "Could not check the credentials",
    onSuccess: refresh,
  });

  if (isLoading || !status) return <Skeleton className="h-9 w-full" />;

  const badge = STATE_BADGE[status.state];
  const configured = status.state !== "not_configured";
  const facts = [
    status.checkedAt && `Checked ${formatRelativeTime(status.checkedAt)}`,
    status.devices.length > 0 && status.devices.join(", "),
    status.quota &&
      `${status.quota.remaining.toLocaleString()} of ${status.quota.limit.toLocaleString()} left this month`,
  ].filter(Boolean);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={badge.status} label={badge.label} />
        {facts.length > 0 && <Text variant="meta">{facts.join(" · ")}</Text>}
        {configured && (
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => test.mutate(undefined)}
              disabled={test.isPending}
            >
              <BellRing className="size-3.5" />
              Send test
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Re-check Pushover"
              onClick={() => validate.mutate(undefined)}
              disabled={validate.isPending}
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
        )}
      </div>
      {!configured && (
        <Text variant="body" tone="muted" className="block">
          Set{" "}
          {status.requiredEnv.map((name, index) => (
            <span key={name}>
              {index > 0 && " and "}
              <Text variant="code">{name}</Text>
            </span>
          ))}{" "}
          in the server environment (a Pushover application token and your user key), then restart.
        </Text>
      )}
      {status.lastError && (
        <Text variant="meta" tone="destructive" className="block">
          Last error: {status.lastError.detail ?? status.lastError.reason}
        </Text>
      )}
    </div>
  );
}

/** A place notifications can go, offered next to Pushover (the app adds its phone app). */
export interface NotificationDestination {
  /** The channel id `deliverTo` stores ("webpush" for the phone app). */
  id: string;
  label: string;
  /** Shown under the choice while it is selected. */
  details: ReactNode;
}

function DeliveryCard({ destinations }: { destinations: NotificationDestination[] }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: SETTINGS_KEY, queryFn: notificationsService.settings });
  const choose = useToastMutation(
    (deliverTo: string) => notificationsService.saveSettings({ ...data!.settings, deliverTo }),
    {
      error: "Could not change where notifications go",
      onSuccess: (saved) => {
        queryClient.setQueryData(SETTINGS_KEY, saved);
      },
    },
  );
  const options: NotificationDestination[] = [
    ...destinations,
    { id: "pushover", label: "Pushover", details: <PushoverDetails /> },
    {
      id: "off",
      label: "Off",
      details: (
        <Text variant="body" tone="muted" className="block">
          Nothing is sent. Bots work the same.
        </Text>
      ),
    },
  ];
  const selected = choose.isPending ? choose.variables : data?.settings.deliverTo;
  const current = options.find((option) => option.id === selected);
  return (
    <Card>
      <CardHeader>
        <CardTitle aria-level={2}>Send notifications to</CardTitle>
        <CardDescription>
          One place at a time, for when a bot needs you or work finishes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data ? (
          <Skeleton className="h-9 w-64" />
        ) : (
          <div
            role="radiogroup"
            aria-label="Send notifications to"
            className="bg-muted text-muted-foreground inline-flex rounded-xl p-[3px]"
          >
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={option.id === selected}
                disabled={choose.isPending}
                onClick={() => option.id !== selected && choose.mutate(option.id)}
                className={cn(
                  "h-8 rounded-lg px-3 text-sm font-medium",
                  option.id === selected
                    ? "bg-background text-foreground shadow-sm"
                    : "hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        {current?.details}
      </CardContent>
    </Card>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <Text variant="meta" className="block">
        {hint}
      </Text>
    </div>
  );
}

function EventToggle({
  def,
  checked,
  onChange,
}: {
  def: NotificationEventDef;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = `notify-${def.event}`;
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        disabled={def.locked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <div className="space-y-0.5">
        <Label htmlFor={id}>{def.label}</Label>
        <Text variant="meta" className="block">
          {def.description}
          {def.locked && " Always on."}
        </Text>
      </div>
    </div>
  );
}

function PreferencesCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: notificationsService.settings,
  });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [syncedFrom, setSyncedFrom] = useState<Settings | undefined>(undefined);
  // Re-sync the draft whenever the server copy changes (load, save).
  if (data && data.settings !== syncedFrom) {
    setSyncedFrom(data.settings);
    setDraft(data.settings);
  }
  // Where notifications go is chosen above; a save here never changes it.
  const save = useToastMutation(
    (value: Settings) =>
      notificationsService.saveSettings({ ...value, deliverTo: data!.settings.deliverTo }),
    {
      success: "Notification settings saved",
      error: "Could not save notification settings",
      onSuccess: (saved) => {
        queryClient.setQueryData(SETTINGS_KEY, saved);
      },
    },
  );

  if (data?.settings.deliverTo === "off") return null;
  if (isLoading || !data || !draft) {
    return (
      <SkeletonCard titleWidth="w-48" description>
        <div className="space-y-3">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      </SkeletonCard>
    );
  }

  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });
  const setQuiet = (patch: Partial<Settings["quietHours"]>) =>
    set({ quietHours: { ...draft.quietHours, ...patch } });
  const enabled = (def: NotificationEventDef) =>
    def.locked || (draft.events[def.event] ?? def.defaultEnabled);
  const categories = [...new Set(data.events.map((def) => def.category))];

  return (
    <Card>
      <CardHeader>
        <CardTitle aria-level={2}>What to send</CardTitle>
        <CardDescription>
          Messages never include tool arguments, outputs or secrets.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {categories.map((category) => (
          <section key={category} className="space-y-3" aria-label={CATEGORY_LABEL[category]}>
            <Text variant="title">{CATEGORY_LABEL[category]}</Text>
            <div className="space-y-3">
              {data.events
                .filter((def) => def.category === category)
                .map((def) => (
                  <EventToggle
                    key={def.event}
                    def={def}
                    checked={enabled(def)}
                    onChange={(checked) =>
                      set({ events: { ...draft.events, [def.event]: checked } })
                    }
                  />
                ))}
            </div>
          </section>
        ))}

        <section className="space-y-3" aria-label="Quiet hours">
          <Text variant="title">Quiet hours</Text>
          <div className="flex items-start gap-3">
            <Checkbox
              id="quiet-enabled"
              className="mt-0.5"
              checked={draft.quietHours.enabled}
              onCheckedChange={(value) => setQuiet({ enabled: value === true })}
            />
            <div className="space-y-0.5">
              <Label htmlFor="quiet-enabled">Hold updates during quiet hours</Label>
              <Text variant="meta" className="block">
                Updates arrive as one digest when quiet hours end. Requests for your input still
                arrive, silently.
              </Text>
            </div>
          </div>
          {draft.quietHours.enabled && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="quiet-start">From</Label>
                <Input
                  id="quiet-start"
                  type="time"
                  value={draft.quietHours.start}
                  onChange={(e) => setQuiet({ start: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quiet-end">Until</Label>
                <Input
                  id="quiet-end"
                  type="time"
                  value={draft.quietHours.end}
                  onChange={(e) => setQuiet({ end: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quiet-zone">Time zone</Label>
                <Input
                  id="quiet-zone"
                  value={draft.quietHours.timezone}
                  onChange={(e) => setQuiet({ timezone: e.target.value })}
                />
              </div>
              <div className="flex items-start gap-3 sm:col-span-3">
                <Checkbox
                  id="quiet-urgent"
                  className="mt-0.5"
                  checked={draft.quietHours.urgentBypass}
                  onCheckedChange={(value) => setQuiet({ urgentBypass: value === true })}
                />
                <Label htmlFor="quiet-urgent">Requests for your input still make a sound</Label>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3" aria-label="Timing">
          <Text variant="title">Timing</Text>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField
              id="notify-long-run"
              label="Long reply (minutes)"
              hint="Replies this long notify when they finish."
              value={draft.longRunMinutes}
              min={1}
              max={240}
              onChange={(longRunMinutes) => set({ longRunMinutes })}
            />
            <NumberField
              id="notify-reminder"
              label="Reminder (minutes)"
              hint="One reminder for unanswered requests. 0 turns it off."
              value={draft.reminderMinutes}
              min={0}
              max={1440}
              onChange={(reminderMinutes) => set({ reminderMinutes })}
            />
            <NumberField
              id="notify-coalesce"
              label="Grouping window (seconds)"
              hint="Requests from one chat within it arrive as one."
              value={draft.coalesceSeconds}
              min={0}
              max={300}
              onChange={(coalesceSeconds) => set({ coalesceSeconds })}
            />
          </div>
          {data.settings.deliverTo === "pushover" && (
            <div className="space-y-1.5 sm:max-w-xs">
              <Label htmlFor="notify-device">Pushover device (optional)</Label>
              <Input
                id="notify-device"
                value={draft.device}
                placeholder="All devices"
                onChange={(e) => set({ device: e.target.value })}
              />
            </div>
          )}
        </section>
      </CardContent>
      <CardFooter>
        <Button type="button" onClick={() => save.mutate(draft)} disabled={save.isPending}>
          <Save className="size-4" />
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}

function LogCard() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: LOG_KEY,
    queryFn: () => notificationsService.log(20),
  });
  if (isLoading) return <SkeletonCard titleWidth="w-44" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle aria-level={2}>Recent notifications</CardTitle>
        <CardDescription>The last 20, kept for 30 days. Titles only.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Text variant="meta">Nothing sent yet.</Text>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    <Text variant="meta">{formatRelativeTime(row.createdAt)}</Text>
                  </TableCell>
                  <TableCell>
                    <span className="block">{row.title}</span>
                    <Text variant="code" tone="muted">
                      {row.event}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={LOG_BADGE[row.status] ?? row.status}
                      label={row.reason ? `${row.status}: ${row.reason}` : row.status}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Settings → Notifications: one place notifications go (`destinations` the
 * app offers, Pushover, or off) with that channel's details, then what to
 * send, quiet hours and the log.
 */
export function NotificationSettings({
  destinations = [],
}: {
  destinations?: NotificationDestination[];
}) {
  return (
    <div className="space-y-6">
      <DeliveryCard destinations={destinations} />
      <PreferencesCard />
      <LogCard />
    </div>
  );
}
