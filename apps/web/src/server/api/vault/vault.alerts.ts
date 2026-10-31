/**
 * Owner alerts the vault raises (a value revealed, an item deleted, an
 * unattended refusal): a port the vault calls and the boot wiring connects
 * to push notifications (`notifications.wiring.ts`), so the vault never
 * imports the notification stack. Without a sink alerts are dropped; the
 * audit log still holds every event.
 */
export type VaultAlertKind = "revealed" | "deleted" | "refused";

export type VaultAlertSink = (kind: VaultAlertKind, title: string, message: string) => void;

let sink: VaultAlertSink | undefined;

/** Connect the alerts to their destination (boot, tests). Returns the disconnect. */
export function setVaultAlertSink(next: VaultAlertSink | undefined): () => void {
  sink = next;
  return () => {
    if (sink === next) sink = undefined;
  };
}

export function vaultAlert(kind: VaultAlertKind, title: string, message: string): void {
  sink?.(kind, title, message);
}
