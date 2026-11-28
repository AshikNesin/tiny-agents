import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Send, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@groot/ui/button";
import { useConfirm } from "@groot/ui/primitives";
import type { PushDevice } from "../../shared/api/push";
import { pushSubscriptionLabels } from "../../shared/machines/push-subscription";
import { MachineStatusBadge } from "./MachineStatusBadge";
import { errorMessage } from "../lib/errors";
import { usePushDeviceMutations, usePushDevices } from "../queries/push";

const via = (device: PushDevice) =>
  device.distributor === "fcm"
    ? "Google (FCM)"
    : device.distributor === "browser"
      ? "Browser"
      : device.host;

export function PhoneNotificationSettings() {
  const list = usePushDevices();
  const { test: testDevice, remove: removeDevice } = usePushDeviceMutations();
  const devices = list.status === "ready" ? list.data : list.status === "failed" ? list.last : null;
  const loadError = list.status === "failed" ? list.loadError : null;
  const [busy, setBusy] = useState<string | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    if (loadError) toast.error(loadError);
  }, [loadError]);

  const test = async (device: PushDevice) => {
    setBusy(device.id);
    try {
      const result = await testDevice.mutateAsync(device.id);
      if (result.ok) toast.success(`Test sent to ${device.label || "the phone"}`);
      else toast.error("The test didn't go through", { description: result.reason });
      await list.refresh();
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
      await removeDevice.mutateAsync(device.id);
      await list.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to remove the phone"));
    }
  };

  if (!devices) return null;
  if (devices.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No phones yet. Install the Android app and sign in to this server.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {devices.map((device) => (
        <li key={device.id} className="flex flex-wrap items-center gap-3 p-3">
          <Smartphone className="text-muted-foreground size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{device.label || "Phone"}</span>
              <MachineStatusBadge status={device.status} labels={pushSubscriptionLabels} />
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
  );
}
