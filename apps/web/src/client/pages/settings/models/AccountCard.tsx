import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@groot/ui/card";
import { useConfirm } from "@groot/ui/primitives";
import { StatusBadge } from "@groot/ui/status-badge";
import { Text } from "@groot/ui/typography";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import { useStepUp } from "../../../components/vault/StepUp";
import { errorMessage } from "../../../lib/errors";
import type { Account, AccountModel } from "../../../../shared/api/models";
import { useModelDiscovery, useModelMutations } from "../../../queries/models";
import { ClaudePlanStatus } from "../../../components/ClaudePlanStatus";
import { GatewayCustomProvidersDialog } from "./GatewayCustomProvidersDialog";
import { accountStatus, hostOf, KIND_LABEL } from "./model-labels";
import { AccountActions } from "./AccountActions";
import { AddModel } from "./AddModel";
import { ClaudePlanFallback, ClaudePlanMaxTurns } from "./ClaudePlanSettings";
import { modelOptions } from "./model-options";
import { ModelRow } from "./ModelRow";
import { inUseText, MoveDialog } from "./MoveDialog";

function basePathWarning(account: Account, upstreamId: string): string | undefined {
  const slug = upstreamId.split("/")[0];
  if (!slug?.startsWith("custom-") || !upstreamId.includes("/")) return undefined;
  const saved = account.settings.customProviders;
  const list = Array.isArray(saved) ? (saved as { slug: string; basePath?: string }[]) : [];
  const provider = list.find((p) => p.slug === slug);
  if (provider?.basePath) return undefined;
  return provider
    ? `${slug} has no base path: set it in Custom providers if its API isn't at the root (Z.AI's coding plan: api/coding/paas/v4).`
    : `${slug} isn't set up: add it in Custom providers, with its base path (Z.AI's coding plan: api/coding/paas/v4).`;
}

function accountSummary(account: Account, accounts: Account[]): string {
  const via = account.viaProviderId
    ? `through ${accounts.find((a) => a.id === account.viaProviderId)?.name ?? "a gateway"}`
    : hostOf(account.baseUrl);
  const key = account.credential
    ? `${account.credential.hint ?? "key"} · ${account.credential.backend}`
    : undefined;
  const count = `${account.models.length} model${account.models.length === 1 ? "" : "s"}`;
  const checked = account.checkedAt
    ? `checked ${formatRelativeTime(account.checkedAt)}`
    : undefined;
  return [KIND_LABEL[account.kind], via, key, count, checked].filter(Boolean).join(" · ");
}

interface Moving {
  what: string;
  users: string;
  act: (to: string) => Promise<unknown>;
}

export function AccountCard({
  account,
  accounts,
  onChanged,
  onEdit,
}: {
  account: Account;
  accounts: Account[];
  onChanged: () => void;
  onEdit: () => void;
}) {
  const { run } = useStepUp();
  const confirm = useConfirm();
  const mutations = useModelMutations();
  const discovery = useModelDiscovery();
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const status = accountStatus(account);
  const others = modelOptions(
    accounts.filter((a) => a.id !== account.id && a.kind !== "claude-plan"),
  );

  const act = async (work: () => Promise<unknown>, failed: string): Promise<boolean> => {
    try {
      await work();
      onChanged();
      return true;
    } catch (error) {
      toast.error(errorMessage(error, failed));
      return false;
    }
  };

  const deleteOrMove = async (
    what: string,
    attempt: (moveTo?: string) => Promise<unknown>,
    failed: string,
  ) => {
    try {
      if (await attempt()) onChanged();
    } catch (error) {
      const users = inUseText(error);
      if (!users) return toast.error(errorMessage(error, failed));
      setMoving({ what, users, act: (to) => attempt(to) });
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${account.name}?`,
      description: "Its models go too, and its key is removed from the vault.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) {
      await deleteOrMove(
        account.name,
        (to) => run(() => mutations.remove.mutateAsync({ id: account.id, moveTo: to })),
        "Couldn't delete the account",
      );
    }
  };

  const removeModel = async (model: AccountModel) => {
    const ok = await confirm({
      title: `Delete ${model.name}?`,
      description: model.usedBy
        ? `${model.usedBy} bot${model.usedBy === 1 ? "" : "s"} use${model.usedBy === 1 ? "s" : ""} it. You'll pick the model that takes over.`
        : "You'll pick a replacement if anything still uses it.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) {
      await deleteOrMove(
        model.name,
        (to) => mutations.removeModel.mutateAsync({ id: model.id, moveTo: to }),
        "Couldn't delete the model",
      );
    }
  };

  const test = async (model: AccountModel) => {
    try {
      const result = await run(() => discovery.test.mutateAsync({ modelId: model.id }));
      if (!result) return;
      if (result.ok) toast.success(`${model.name} answered in ${result.latencyMs} ms`);
      else toast.error(result.error ?? `${model.name} didn't answer`);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't test the model"));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1 text-left"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            {account.name}
          </button>
          <StatusBadge status={status.variant} label={status.label} />
        </CardTitle>
        <CardDescription>
          {accountSummary(account, accounts)}
          {account.statusDetail && account.status !== "ok" && (
            <span className="text-destructive block">{account.statusDetail}</span>
          )}
        </CardDescription>
        <AccountActions
          account={account}
          onToggle={() =>
            act(
              () => mutations.patch.mutateAsync({ account, input: { enabled: !account.enabled } }),
              "Couldn't switch the account",
            )
          }
          onRefresh={() =>
            act(() => discovery.refresh.mutateAsync(account.id), "Couldn't check the account")
          }
          onEdit={onEdit}
          onCustomProviders={() => setCustomizing(true)}
          onDelete={remove}
        />
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          {account.kind === "claude-plan" && (
            <ClaudePlanStatus
              key={String(account.enabled)}
              onCheckModels={() =>
                act(
                  () => discovery.refresh.mutateAsync(account.id),
                  "Couldn't list Claude Code's models",
                )
              }
            />
          )}
          {account.kind === "claude-plan" && (
            <ClaudePlanFallback
              account={account}
              options={others}
              onSet={(fallbackModelId) =>
                act(
                  () => mutations.patch.mutateAsync({ account, input: { fallbackModelId } }),
                  "Couldn't set the fallback",
                )
              }
            />
          )}
          {account.kind === "claude-plan" && (
            <ClaudePlanMaxTurns
              key={String(account.settings.maxTurns ?? "")}
              account={account}
              onSet={(maxTurns) =>
                act(
                  () => mutations.patch.mutateAsync({ account, input: { maxTurns } }),
                  "Couldn't set max turns",
                )
              }
            />
          )}
          <ul className="divide-y rounded-md border">
            {account.models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                warning={
                  account.kind === "cloudflare-ai-gateway"
                    ? basePathWarning(account, model.upstreamId)
                    : undefined
                }
                onChange={(input) =>
                  act(
                    () => mutations.patchModel.mutateAsync({ id: model.id, input }),
                    "Couldn't change the model",
                  )
                }
                onTest={() => test(model)}
                onDelete={() => removeModel(model)}
              />
            ))}
            {account.models.length === 0 && (
              <li className="px-4 py-3">
                <Text variant="meta">No models yet.</Text>
              </li>
            )}
          </ul>
          <AddModel
            key={account.checkedAt ?? "unchecked"}
            accountId={account.id}
            {...(account.kind === "cloudflare-ai-gateway"
              ? { hint: "custom-zai-coding-plan/glm-5.3" }
              : {})}
            onAdd={(input) =>
              act(
                () => mutations.addModel.mutateAsync({ accountId: account.id, input }),
                "Couldn't add the model",
              )
            }
          />
        </CardContent>
      )}
      {customizing && (
        <GatewayCustomProvidersDialog
          account={account}
          onClose={() => setCustomizing(false)}
          onChanged={onChanged}
        />
      )}
      {moving && (
        <MoveDialog
          what={moving.what}
          users={moving.users}
          options={others}
          onCancel={() => setMoving(null)}
          onMove={(to) => {
            setMoving(null);
            void act(() => moving.act(to), "Couldn't move and delete");
          }}
        />
      )}
    </Card>
  );
}
