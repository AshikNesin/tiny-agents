/**
 * Settings → Notifications, "Phone app" (issue #306): the phones the Android
 * app registered for push, with a test send and remove each, and one switch
 * for the whole channel. The app registers itself after sign-in; nothing is
 * set up here.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Send, Smartphone, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@groot/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@groot/ui/card";
import { Checkbox } from "@groot/ui/checkbox";
import { Label } from "@groot/ui/label";
import { useConfirm } from "@groot/ui/primitives";
import { StatusBadge } from "@groot/ui/status-badge";
import type { NotificationChannelSettings, PushDevice } from "../../shared/api/push";
import { pushApi } from "../lib/push-api";
import { errorMessage } from "../lib/errors";

const STATUS = {
  active: { status: "success", label: "Receiving" },
  failing: { status: "warning", label: "Failing" },
  revoked: { status: "error", label: "Signed out" },
} as const;

const via = (device: PushDevice) =>
  device.distributor === "fcm"
    ? "Google (FCM)"
    : device.distributor === "browser"
      ? "Browser"
      : device.host;

export function PhoneNotificationSettings() {
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [settings, setSettings] = useState<NotificationChannelSettings["settings"] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const reload = () =>
    pushApi
      .devices()
      .then(({ devices: all }) => setDevices(all))
      .catch((error: unknown) => toast.error(errorMessage(error, "Failed to load phones")));

  useEffect(() => {
    void reload();
    void pushApi
      .settings()
      .then((data) => setSettings(data.settings))
      .catch(() => undefined);
  }, []);

  const on = settings?.channels?.webpush !== false;

  const setOn = async (next: boolean) => {
    try {
      // Read the latest copy so a save elsewhere on the page isn't undone.
      const { settings: current } = await pushApi.settings();
      const saved = await pushApi.saveSettings({
        ...current,
        channels: { ...current.channels, webpush: next },
      });
      setSettings(saved.settings);
      await queryClient.invalidateQueries({ queryKey: ["notifications", "settings"] });
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save"));
    }
  };

  const test = async (device: PushDevice) => {
    setBusy(device.id);
    try {
      const result = await pushApi.test(device.id);
      if (result.ok) toast.success(`Test sent to ${device.label || "the phone"}`);
      else toast.error("The test didn't go through", { description: result.reason });
      await reload();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to send a test"));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (device: PushDevice) => {
    const ok = await confirm({
      title: `Stop notifications to ${device.label || "this phone"}?`,
      description: "The phone stops getting notifications until the app registers it again.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await pushApi.remove(device.id);
      await reload();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to remove the phone"));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phone app</CardTitle>
        <CardDescription>
          The Android app registers itself after you sign in, with nothing to set up here. Approvals
          arrive with Approve and Deny buttons, and disappear once you answer them anywhere.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Checkbox
            id="notify-phones"
            checked={on}
            disabled={settings === null}
            onCheckedChange={(value) => void setOn(value === true)}
          />
          <Label htmlFor="notify-phones">Send notifications to phones</Label>
        </div>
        {devices === null ? null : devices.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No phones yet. Install the Android app and sign in to this server.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center gap-3 p-3">
                <Smartphone className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{device.label || "Phone"}</span>
                    <StatusBadge
                      status={STATUS[device.status].status}
                      label={STATUS[device.status].label}
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Via {via(device)}
                    {device.appVersion ? ` · app ${device.appVersion}` : ""}
                    {device.lastSuccessAt
                      ? ` · last delivered ${new Date(device.lastSuccessAt).toLocaleString()}`
                      : " · nothing delivered yet"}
                    {device.status !== "active" && device.lastError ? ` · ${device.lastError}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === device.id || device.status === "revoked"}
                  onClick={() => void test(device)}
                >
                  <Send className="size-3.5" />
                  Send test
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${device.label || "phone"}`}
                  onClick={() => void remove(device)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
