import { useParams } from "react-router-dom";
import { StepUpProvider } from "../../components/vault/StepUp";
import type { VaultKind } from "../../lib/vault-api";
import { CredentialRequestSheet } from "./CredentialRequestSheet";
import { NewVaultItem } from "./NewVaultItem";
import { VaultItemDetail } from "./VaultItemDetail";
import { VaultList } from "./VaultList";

const KINDS: VaultKind[] = ["login", "card", "identity", "api_key"];

export function VaultPage() {
  const { handle, kind, taskId } = useParams();
  const page = taskId ? (
    <CredentialRequestSheet taskId={Number(taskId)} />
  ) : kind && KINDS.includes(kind as VaultKind) ? (
    <NewVaultItem kind={kind as VaultKind} />
  ) : handle ? (
    <VaultItemDetail key={handle} handle={handle} />
  ) : (
    <VaultList />
  );
  return <StepUpProvider>{page}</StepUpProvider>;
}
