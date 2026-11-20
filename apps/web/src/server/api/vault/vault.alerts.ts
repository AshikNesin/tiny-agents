import { app } from "../../app-root";

export type VaultAlertKind = "revealed" | "deleted" | "refused";

export type VaultAlertSink = (kind: VaultAlertKind, title: string, message: string) => void;

export function setVaultAlertSink(next: VaultAlertSink | undefined): () => void {
  app().vaultAlertSink = next;
  return () => {
    if (app().vaultAlertSink === next) app().vaultAlertSink = undefined;
  };
}

export function vaultAlert(kind: VaultAlertKind, title: string, message: string): void {
  app().vaultAlertSink?.(kind, title, message);
}
