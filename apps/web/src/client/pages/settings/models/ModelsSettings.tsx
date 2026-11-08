/**
 * Settings → Models (issue #179): the owner's provider accounts and their
 * models, the default model for each role, and the Add Models dialog.
 * Changes apply without a restart; pickers refresh on `models.changed`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bot, ChevronDown, ChevronRight, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@groot/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@groot/ui/card";
import { Checkbox } from "@groot/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { EmptyState } from "@groot/ui/empty-state";
import { Field } from "@groot/ui/form";
import { Input } from "@groot/ui/input";
import { Label } from "@groot/ui/label";
import { useConfirm } from "@groot/ui/primitives";
import { StatusBadge } from "@groot/ui/status-badge";
import { monoClass, Text } from "@groot/ui/typography";
import { StepUpProvider, useStepUp } from "../../../components/vault/StepUp";
import { ApiError } from "@groot/shell/lib/api";
import { errorMessage } from "../../../lib/errors";
import {
  modelsApi,
  type Account,
  type AccountModel,
  type ModelRole,
  type ProviderTemplate,
  type Roles,
} from "../../../lib/models-api";
import { useBotsStore } from "../../../store/bots";
import { ClaudePlanStatus } from "../../../components/ClaudePlanStatus";
import { ModelPicker, type ModelPickerOption } from "../../../components/ModelPicker";
import { AddModelsDialog } from "./AddModelsDialog";
import { GatewayCustomProvidersDialog } from "./GatewayCustomProvidersDialog";
import { accountStatus, formatTokens, hostOf, KIND_LABEL, ROLE_LABEL, ROLES } from "./model-labels";

/** Every model the owner could pick, grouped by account. */
function modelOptions(
  accounts: Account[],
  type: "chat" | "classifier" = "chat",
): ModelPickerOption[] {
  return accounts.flatMap((account) =>
    account.models
      .filter((model) => model.type === type && model.enabled)
      .map((model) => ({
        id: model.id,
        label: model.name,
        group: account.name,
        keywords: [model.upstreamId],
      })),
  );
}

/** Pick the model that takes over. Mounted only while asking, so it opens empty. */
function MoveDialog({
  what,
  users,
  options,
  onCancel,
  onMove,
}: {
  what: string;
  users: string;
  options: ModelPickerOption[];
  onCancel: () => void;
  onMove: (modelId: string) => void;
}) {
  const [target, setTarget] = useState("");
  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{what} is in use</DialogTitle>
          <DialogDescription>
            {users} Pick the model that takes over, then delete.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Move to">
            <ModelPicker value={target} options={options} onChange={setTarget} label="Move to" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!target} onClick={() => onMove(target)}>
            Move and delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Who a 409 `in_use` names, as a sentence. */
function inUseText(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  const details = (error.details ?? {}) as {
    in_use?: { bots?: { name: string }[]; roles?: string[]; claudePlanFallback?: boolean };
  };
  const use = details.in_use;
  if (!use) return undefined;
  const parts = [
    use.bots?.length
      ? `${use.bots.length} bot${use.bots.length === 1 ? "" : "s"} (${use.bots.map((b) => b.name).join(", ")})`
      : undefined,
    use.roles?.length
      ? `the ${use.roles.join(", ")} role${use.roles.length === 1 ? "" : "s"}`
      : undefined,
    use.claudePlanFallback ? "the Claude plan's fallback" : undefined,
  ].filter(Boolean);
  return `Used by ${parts.join(" and ")}.`;
}

/** Edit an account's endpoint and key. Mounted per account, so it starts from what is saved. */
function EditConnectionDialog({
  account,
  onClose,
  onSaved,
}: {
  account: Account;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { run } = useStepUp();
  const [baseUrl, setBaseUrl] = useState(account.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [allowPrivate, setAllowPrivate] = useState(account.allowPrivateNetwork);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const saved = await run(() =>
        modelsApi.updateConnection(account.id, {
          ...(account.kind !== "cloudflare-ai-gateway" && baseUrl.trim() !== (account.baseUrl ?? "")
            ? { baseUrl: baseUrl.trim() }
            : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          allowPrivateNetwork: allowPrivate,
        }),
      );
      if (!saved) return;
      toast.success(`Saved ${saved.name}`);
      onSaved();
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't save the connection"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {account.name}</DialogTitle>
          <DialogDescription>
            A new host needs its key again: keys only go to the host they were saved for.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {account.kind !== "cloudflare-ai-gateway" && !account.viaProviderId && (
            <Field label="Endpoint" htmlFor="edit-endpoint">
              <Input
                id="edit-endpoint"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </Field>
          )}
          {!account.viaProviderId && (
            <Field label="API key" htmlFor="edit-key" hint="Leave blank to keep the saved key.">
              <Input
                id="edit-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </Field>
          )}
          {account.kind !== "cloudflare-ai-gateway" && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-private"
                checked={allowPrivate}
                onCheckedChange={(checked) => setAllowPrivate(checked === true)}
              />
              <Label htmlFor="edit-private" className="font-normal">
                Private or local endpoint
              </Label>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModelRow({
  model,
  warning,
  onChange,
  onTest,
  onDelete,
}: {
  model: AccountModel;
  /** Why the model can't answer as set up, when the card can tell. */
  warning?: string | undefined;
  onChange: (input: { enabled: boolean }) => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  const chips = [
    model.type === "classifier" ? "classifier" : `${formatTokens(model.contextWindow)} context`,
    model.imageInput ? "images" : undefined,
    model.reasoning ? "reasoning" : undefined,
    model.missing ? "no longer listed" : undefined,
    model.usedBy
      ? `${model.usedBy} bot${model.usedBy === 1 ? "" : "s"} use${model.usedBy === 1 ? "s" : ""} this`
      : undefined,
  ].filter(Boolean);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <Checkbox
        aria-label={`Offer ${model.name} in the picker`}
        checked={model.enabled}
        onCheckedChange={(checked) => onChange({ enabled: checked === true })}
      />
      <div className="min-w-0 flex-1">
        <Text variant="body" className="block truncate">
          {model.name}
        </Text>
        <Text variant="meta" className="block truncate">
          <span className={monoClass}>{model.upstreamId}</span>
          {chips.length > 0 ? ` · ${chips.join(" · ")}` : ""}
        </Text>
        {warning && (
          <Text variant="meta" className="text-destructive block">
            {warning}
          </Text>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onTest}>
        Test
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${model.name}`} onClick={onDelete}>
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}

/**
 * A gateway custom provider's model whose provider has no base path: the
 * gateway reaches the upstream's root, and most APIs answer 404 there.
 */
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

/** The account's one-line summary: kind, where it goes, its key, models, last check. */
function accountSummary(account: Account, accounts: Account[]): string {
  const via = account.viaProviderId
    ? `through ${accounts.find((a) => a.id === account.viaProviderId)?.name ?? "a gateway"}`
    : hostOf(account.baseUrl);
  const key = account.credential
    ? `${account.credential.hint ?? "key"} · ${account.credential.backend === "local" ? "local" : "1Password"}`
    : undefined;
  const count = `${account.models.length} model${account.models.length === 1 ? "" : "s"}`;
  const checked = account.checkedAt
    ? `checked ${new Date(account.checkedAt).toLocaleString()}`
    : undefined;
  return [KIND_LABEL[account.kind], via, key, count, checked].filter(Boolean).join(" · ");
}

function ClaudePlanFallback({
  account,
  options,
  onSet,
}: {
  account: Account;
  options: ModelPickerOption[];
  onSet: (modelId: string | null) => void;
}) {
  const current =
    typeof account.settings.fallbackModelId === "string"
      ? account.settings.fallbackModelId
      : "none";
  return (
    <Field
      label="Fallback model"
      hint="Where a turn goes when the plan is off or the sandbox is unreachable. None: the turn pauses."
    >
      <ModelPicker
        value={current}
        options={[{ id: "none", label: "None: pause the turn" }, ...options]}
        onChange={(value) => onSet(value === "none" ? null : value)}
        label="Fallback model"
      />
    </Field>
  );
}

function AddModelById({
  onAdd,
  placeholder = "Add a model by id",
}: {
  onAdd: (upstreamId: string) => Promise<boolean>;
  placeholder?: string;
}) {
  const [adding, setAdding] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const upstreamId = adding.trim();
        if (upstreamId && (await onAdd(upstreamId))) setAdding("");
      }}
    >
      <Input
        aria-label="Model ID to add"
        placeholder={placeholder}
        value={adding}
        onChange={(e) => setAdding(e.target.value)}
      />
      <Button type="submit" variant="outline" disabled={!adding.trim()}>
        Add
      </Button>
    </form>
  );
}

function AccountActions({
  account,
  onToggle,
  onRefresh,
  onEdit,
  onCustomProviders,
  onDelete,
}: {
  account: Account;
  onToggle: () => void;
  onRefresh: () => void;
  onEdit: () => void;
  onCustomProviders: () => void;
  onDelete: () => void;
}) {
  // A Claude plan or faux account has no endpoint to check or edit.
  const editable = account.kind !== "claude-plan" && account.kind !== "faux";
  return (
    <CardAction className="flex flex-wrap gap-1">
      <Button variant="ghost" size="sm" onClick={onToggle}>
        {account.enabled ? "Disable" : "Enable"}
      </Button>
      {editable && (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Check ${account.name} again`}
            onClick={onRefresh}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
        </>
      )}
      {account.kind === "cloudflare-ai-gateway" && (
        <Button variant="ghost" size="sm" onClick={onCustomProviders}>
          Custom providers
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${account.name}`}
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
      </Button>
    </CardAction>
  );
}

interface Moving {
  what: string;
  users: string;
  act: (to: string) => Promise<unknown>;
}

function AccountCard({
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
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const status = accountStatus(account);
  const others = modelOptions(
    accounts.filter((a) => a.id !== account.id && a.kind !== "claude-plan"),
  );

  /** Run a change, then reload; a failure becomes a toast. Resolves whether it worked. */
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

  /** Delete, or on 409 `in_use` ask which model takes over. */
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
        (to) => run(() => modelsApi.remove(account.id, to)),
        "Couldn't delete the account",
      );
    }
  };

  const test = async (model: AccountModel) => {
    try {
      const result = await modelsApi.test({ modelId: model.id });
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
              () => modelsApi.patch(account, { enabled: !account.enabled }),
              "Couldn't switch the account",
            )
          }
          onRefresh={() => act(() => modelsApi.refresh(account.id), "Couldn't check the account")}
          onEdit={onEdit}
          onCustomProviders={() => setCustomizing(true)}
          onDelete={remove}
        />
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          {account.kind === "claude-plan" && <ClaudePlanStatus key={String(account.enabled)} />}
          {account.kind === "claude-plan" && (
            <ClaudePlanFallback
              account={account}
              options={others}
              onSet={(fallbackModelId) =>
                act(
                  () => modelsApi.patch(account, { fallbackModelId }),
                  "Couldn't set the fallback",
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
                  act(() => modelsApi.patchModel(model.id, input), "Couldn't change the model")
                }
                onTest={() => test(model)}
                onDelete={() =>
                  deleteOrMove(
                    model.name,
                    (to) => modelsApi.removeModel(model.id, to),
                    "Couldn't delete the model",
                  )
                }
              />
            ))}
            {account.models.length === 0 && (
              <li className="px-4 py-3">
                <Text variant="meta">No models yet.</Text>
              </li>
            )}
          </ul>
          {account.kind !== "claude-plan" && (
            <AddModelById
              {...(account.kind === "cloudflare-ai-gateway"
                ? { placeholder: "Add a model by id, e.g. custom-zai-coding-plan/glm-5.3" }
                : {})}
              onAdd={(upstreamId) =>
                act(() => modelsApi.addModel(account.id, { upstreamId }), "Couldn't add the model")
              }
            />
          )}
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

/** What an unset role shows: the model its fallback picks, or none. */
function fallbackLabel(options: ModelPickerOption[], modelId: string | null): string {
  const option = modelId ? options.find((o) => o.id === modelId) : undefined;
  if (!option) return modelId ? "Default (fallback)" : "None";
  return `${option.group ? `${option.group} / ` : ""}${option.label} (fallback)`;
}

function DefaultModels({
  accounts,
  roles,
  onChanged,
}: {
  accounts: Account[];
  roles: Roles | null;
  onChanged: () => void;
}) {
  const chat = useMemo(() => modelOptions(accounts), [accounts]);
  const classifiers = useMemo(() => modelOptions(accounts, "classifier"), [accounts]);
  const setRole = async (role: ModelRole, modelId: string | null) => {
    try {
      await modelsApi.setRoles({ [role]: modelId });
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't set the model"));
    }
  };
  if (!roles) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Default models</CardTitle>
        <CardDescription>
          Which model each feature uses. Unset ones follow their fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {ROLES.map((role) => {
          const options = role === "classifier" ? classifiers : chat;
          const current = roles[role];
          const label = ROLE_LABEL[role];
          return (
            <div
              key={role}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center"
            >
              <div className="min-w-0">
                <Text variant="body" className="block font-medium">
                  {label.title}
                </Text>
                <Text variant="meta" className="block">
                  {label.description}
                </Text>
              </div>
              {/* The picker shrinks so Reset always fits inside the card. */}
              <div className="flex min-w-0 items-center gap-2">
                <ModelPicker
                  className="min-w-0 flex-1"
                  value={current.fallback ? "" : (current.modelId ?? "")}
                  options={options}
                  onChange={(value) => setRole(role, value)}
                  label={label.title}
                  placeholder={fallbackLabel(options, current.modelId)}
                />
                {!current.fallback && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setRole(role, null)}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ModelsSettingsBody() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [templates, setTemplates] = useState<ProviderTemplate[]>([]);
  const [roles, setRoles] = useState<Roles | null>(null);
  const [adding, setAdding] = useState<{ template?: ProviderTemplate } | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const loadModels = useBotsStore((s) => s.loadModels);

  const reload = useCallback(async () => {
    try {
      const [{ accounts: list, templates: offered }, { roles: current }] = await Promise.all([
        modelsApi.accounts(),
        modelsApi.roles(),
      ]);
      setAccounts(list);
      setTemplates(offered);
      setRoles(current);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't load models"));
    }
    void loadModels();
  }, [loadModels]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const real = useMemo(() => (accounts ?? []).filter((a) => a.kind !== "faux"), [accounts]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Model providers</CardTitle>
          <CardDescription>
            Accounts your bots reach models through. Keys are kept in the vault, used by the app
            only.
          </CardDescription>
          <CardAction>
            <Button onClick={() => setAdding({})}>
              <Plus className="size-4" />
              Add models
            </Button>
          </CardAction>
        </CardHeader>
        {accounts !== null && real.length === 0 && (
          <CardContent>
            <EmptyState
              icon={Bot}
              title="No model is set up"
              description="Connect a provider to give your bots a model."
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {templates.map((template) => (
                <Button
                  key={template.id}
                  variant="outline"
                  className="justify-start"
                  onClick={() => setAdding({ template })}
                >
                  {template.label}
                </Button>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {(accounts ?? []).map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          accounts={accounts ?? []}
          onChanged={() => void reload()}
          onEdit={() => setEditing(account)}
        />
      ))}

      {accounts !== null && accounts.length > 0 && (
        <DefaultModels accounts={accounts} roles={roles} onChanged={() => void reload()} />
      )}

      <AddModelsDialog
        open={adding !== null}
        onOpenChange={(open) => !open && setAdding(null)}
        templates={templates}
        {...(adding?.template ? { template: adding.template } : {})}
        onAdded={() => void reload()}
      />
      {editing && (
        <EditConnectionDialog
          key={editing.id}
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
        />
      )}
    </div>
  );
}

/** Settings → Models: step-up guards creating, editing and deleting accounts. */
export function ModelsSettings() {
  return (
    <StepUpProvider>
      <ModelsSettingsBody />
    </StepUpProvider>
  );
}
