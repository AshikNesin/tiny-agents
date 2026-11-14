/**
 * Owner alerts the vault raises (a value revealed, an item deleted, an
 * unattended refusal): a port the vault calls and the boot wiring connects
 * to push notifications (`notifications.wiring.ts`), so the vault never
 * imports the notification stack. Without a sink alerts are dropped; the
 * audit log still holds every event.
 */
import { app } from "../../app-root";

export type VaultAlertKind = "revealed" | "deleted" | "refused";

export type VaultAlertSink = (kind: VaultAlertKind, title: string, message: string) => void;

/** Connect the alerts to their destination (`app().vaultAlertSink`; boot, tests). Returns the disconnect. */
export function setVaultAlertSink(next: VaultAlertSink | undefined): () => void {
  app().vaultAlertSink = next;
  return () => {
    if (app().vaultAlertSink === next) app().vaultAlertSink = undefined;
  };
}

export function vaultAlert(kind: VaultAlertKind, title: string, message: string): void {
  app().vaultAlertSink?.(kind, title, message);
}
