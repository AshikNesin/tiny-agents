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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
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
import { AddModelsDialog } from "./AddModelsDialog";
import { accountStatus, formatTokens, hostOf, KIND_LABEL, ROLE_LABEL, ROLES } from "./model-labels";

/** Every model the owner could pick, as "<account> / <model>". */
function modelOptions(accounts: Account[], type: "chat" | "classifier" = "chat") {
  return accounts.flatMap((account) =>
    account.models
      .filter((model) => model.type === type)
      .map((model) => ({ id: model.id, label: `${account.name} / ${model.name}`, account })),
  );
}

/** Pick the model that takes over from a deleted one. */
function MoveDialog({
  open,
  what,
  users,
  options,
  onCancel,
  onMove,
}: {
  open: boolean;
  what: string;
  users: string;
  options: { id: string; label: string }[];
  onCancel: () => void;
  onMove: (modelId: string) => void;
}) {
  const [target, setTarget] = useState("");
  useEffect(() => setTarget(""), [open]);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{what} is in use</DialogTitle>
          <DialogDescription>
            {users} Pick the model that takes over, then delete.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Move to" htmlFor="move-to">
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="move-to" className="w-full">
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

function EditConnectionDialog({
  account,
  onClose,
  onSaved,
}: {
  account: Account | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { run } = useStepUp();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBaseUrl(account?.baseUrl ?? "");
    setApiKey("");
    setAllowPrivate(account?.allowPrivateNetwork ?? false);
  }, [account]);
  if (!account) return null;
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
  onChange,
  onTest,
  onDelete,
}: {
  model: AccountModel;
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
      </div>
      <Button variant="ghost" size="sm" onClick={onTest}>
        Test
      </Button>
      <Button variant="ghost" size="icon" aria-label={`Delete ${model.name}`} onClick={onDelete}>
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
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
  const [adding, setAdding] = useState("");
  const [moving, setMoving] = useState<{
    what: string;
    users: string;
    act: (to: string) => Promise<unknown>;
  } | null>(null);
  const status = accountStatus(account);
  const host = hostOf(account.baseUrl);
  const others = modelOptions(
    accounts.filter((a) => a.id !== account.id && a.kind !== "claude-plan"),
  );

  const act = async (work: () => Promise<unknown>, failed: string) => {
    try {
      await work();
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error, failed));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${account.name}?`,
      description: "Its models go too, and its key is removed from the vault.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      const done = await run(() => modelsApi.remove(account.id));
      if (done) onChanged();
    } catch (error) {
      const users = inUseText(error);
      if (!users) return toast.error(errorMessage(error, "Couldn't delete the account"));
      setMoving({
        what: account.name,
        users,
        act: (to) => run(() => modelsApi.remove(account.id, to)),
      });
    }
  };

  const removeModel = async (model: AccountModel) => {
    try {
      await modelsApi.removeModel(model.id);
      onChanged();
    } catch (error) {
      const users = inUseText(error);
      if (!users) return toast.error(errorMessage(error, "Couldn't delete the model"));
      setMoving({ what: model.name, users, act: (to) => modelsApi.removeModel(model.id, to) });
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

  const fallback =
    typeof account.settings.fallbackModelId === "string"
      ? account.settings.fallbackModelId
      : "none";

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
          {[
            KIND_LABEL[account.kind],
            account.viaProviderId
              ? `through ${accounts.find((a) => a.id === account.viaProviderId)?.name ?? "a gateway"}`
              : host,
            account.credential
              ? `${account.credential.hint ?? "key"} · ${account.credential.backend === "local" ? "local" : "1Password"}`
              : undefined,
            `${account.models.length} model${account.models.length === 1 ? "" : "s"}`,
            account.checkedAt
              ? `checked ${new Date(account.checkedAt).toLocaleString()}`
              : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
          {account.statusDetail && account.status !== "ok" && (
            <span className="text-destructive block">{account.statusDetail}</span>
          )}
        </CardDescription>
        <CardAction className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              act(
                () => modelsApi.patch(account, { enabled: !account.enabled }),
                "Couldn't switch the account",
              )
            }
          >
            {account.enabled ? "Disable" : "Enable"}
          </Button>
          {account.kind !== "claude-plan" && account.kind !== "faux" && (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Check ${account.name} again`}
                onClick={() =>
                  act(() => modelsApi.refresh(account.id), "Couldn't check the account")
                }
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={onEdit}>
                Edit
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${account.name}`}
            onClick={remove}
          >
            <Trash2 className="size-4" />
          </Button>
        </CardAction>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          {account.kind === "claude-plan" && (
            <Field
              label="Fallback model"
              htmlFor={`fallback-${account.id}`}
              hint="Where a turn goes when the plan is off or the sandbox is unreachable. None: the turn pauses."
            >
              <Select
                value={fallback}
                onValueChange={(value) =>
                  act(
                    () =>
                      modelsApi.patch(account, {
                        fallbackModelId: value === "none" ? null : value,
                      }),
                    "Couldn't set the fallback",
                  )
                }
              >
                <SelectTrigger id={`fallback-${account.id}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None: pause the turn</SelectItem>
                  {others.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <ul className="divide-y rounded-md border">
            {account.models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                onChange={(input) =>
                  act(() => modelsApi.patchModel(model.id, input), "Couldn't change the model")
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
          {account.kind !== "claude-plan" && (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const upstreamId = adding.trim();
                if (!upstreamId) return;
                void act(async () => {
                  await modelsApi.addModel(account.id, { upstreamId });
                  setAdding("");
                }, "Couldn't add the model");
              }}
            >
              <Input
                aria-label="Model ID to add"
                placeholder="Add a model by id"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={!adding.trim()}>
                Add
              </Button>
            </form>
          )}
        </CardContent>
      )}
      <MoveDialog
        open={moving !== null}
        what={moving?.what ?? ""}
        users={moving?.users ?? ""}
        options={moving ? others : []}
        onCancel={() => setMoving(null)}
        onMove={(to) => {
          const current = moving;
          setMoving(null);
          if (current) void act(() => current.act(to), "Couldn't move and delete");
        }}
      />
    </Card>
  );
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
  const chat = modelOptions(accounts);
  const classifiers = modelOptions(accounts, "classifier");
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
              className="grid gap-2 sm:grid-cols-[1fr_minmax(0,18rem)] sm:items-center"
            >
              <div>
                <Label htmlFor={`role-${role}`}>{label.title}</Label>
                <Text variant="meta" className="block">
                  {label.description}
                </Text>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={current.fallback ? "" : (current.modelId ?? "")}
                  onValueChange={(value) => setRole(role, value)}
                >
                  <SelectTrigger id={`role-${role}`} className="w-full">
                    <SelectValue
                      placeholder={
                        current.modelId
                          ? `${options.find((o) => o.id === current.modelId)?.label ?? "Default"} (fallback)`
                          : "None"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!current.fallback && (
                  <Button variant="ghost" size="sm" onClick={() => setRole(role, null)}>
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
        accounts={accounts ?? []}
        onAdded={() => void reload()}
      />
      <EditConnectionDialog
        account={editing}
        onClose={() => setEditing(null)}
        onSaved={() => void reload()}
      />
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
