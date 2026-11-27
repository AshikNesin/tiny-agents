import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@groot/ui/badge";
import { Button } from "@groot/ui/button";
import { Card, CardContent } from "@groot/ui/card";
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
import { listRowClass } from "@groot/ui/list-row";
import { monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { Section } from "@groot/shell/components/layout/Section";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import type { ValueField, VaultItemDetail as Detail, VaultPolicy } from "../../../shared/api/vault";
import {
  apiError,
  BACKEND_LABEL,
  FIELD_LABEL,
  FIELDS_BY_KIND,
  KIND_LABEL,
  SECRET_FIELDS,
} from "../../lib/vault-api";
import { useVaultItem, useVaultMutations, useVaultReveal } from "../../queries/vault";
import { PolicyForm } from "../../components/vault/PolicyForm";
import { useStepUp } from "../../components/vault/StepUp";
import { Switch } from "@groot/ui/switch";
import { ValueFieldInput } from "./NewVaultItem";

const SHOW_MS = 30_000;

const OUTCOME_LABEL: Record<string, string> = {
  used: "used",
  approved_used: "used (approved)",
  denied: "denied by you",
  expired: "approval expired",
  refused_origin: "refused: wrong origin",
  refused_policy: "refused: not allowed",
  refused_unattended: "refused: unattended",
  unknown_handle: "refused: not visible to the bot",
  disabled: "refused: disabled",
  vault_locked: "refused: vault locked",
  backend_error: "backend error",
  sink_error: "failed before use",
  created: "created",
  updated: "updated",
  linked: "linked",
  deleted: "deleted",
  revealed: "revealed",
  copied: "copied",
  filled: "filled",
  cancelled: "cancelled",
};

function policyOf(detail: Detail): VaultPolicy {
  const { item } = detail;
  return {
    handle: item.handle,
    label: item.label,
    origins: item.origins,
    hosts: item.hosts,
    inject: item.inject,
    tools: item.tools,
    bots: item.bots,
    approval: item.approval,
    allowUnattended: item.allowUnattended,
    whenToUse: item.whenToUse ?? "",
    disabled: item.disabled,
    field: item.field,
  };
}

function FieldRow({
  handle,
  field,
  canReveal,
  canEdit,
  onEdit,
  plain,
}: {
  handle: string;
  field: ValueField;
  plain?: string;
  canReveal: boolean;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { run } = useStepUp();
  const revealValue = useVaultReveal();
  const [value, setValue] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const reveal = async () => {
    if (value !== null) {
      setValue(null);
      return;
    }
    try {
      const result = await run(() => revealValue.mutateAsync({ handle, field, purpose: "reveal" }));
      if (!result) return;
      setValue(result.value);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setValue(null), SHOW_MS);
    } catch (error) {
      toast.error(apiError(error, "Couldn't reveal it"));
    }
  };

  const copy = async () => {
    try {
      const result = await run(() => revealValue.mutateAsync({ handle, field, purpose: "copy" }));
      if (!result) return;
      await navigator.clipboard.writeText(result.value);
      toast.success(`${FIELD_LABEL[field]} copied; it's cleared from the clipboard in 30 seconds`);
      setTimeout(() => void navigator.clipboard.writeText("").catch(() => {}), SHOW_MS);
    } catch (error) {
      toast.error(apiError(error, "Couldn't copy it"));
    }
  };

  return (
    <li className={listRowClass}>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{FIELD_LABEL[field]}</p>
        <p className={cn(monoClass, "truncate text-foreground")}>
          {value ?? plain ?? (SECRET_FIELDS.has(field) ? "••••••••••" : "hidden")}
        </p>
      </div>
      {canReveal && (
        <>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void reveal()}
            aria-label={value ? "Hide" : "Reveal"}
          >
            {value ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
          <Button size="icon" variant="ghost" onClick={() => void copy()} aria-label="Copy">
            <Copy className="size-4" />
          </Button>
        </>
      )}
      {canEdit && (
        <Button size="icon" variant="ghost" onClick={onEdit} aria-label="Edit">
          <Pencil className="size-4" />
        </Button>
      )}
    </li>
  );
}

export function VaultItemDetail({ handle }: { handle: string }) {
  const navigate = useNavigate();
  const { run } = useStepUp();
  const { data: detail, loadError, refresh } = useVaultItem(handle);
  const mutations = useVaultMutations();
  const [policy, setPolicy] = useState<VaultPolicy | null>(null);
  const [policyFrom, setPolicyFrom] = useState<Detail | null>(null);
  if (detail && detail !== policyFrom) {
    setPolicyFrom(detail);
    setPolicy(policyOf(detail));
  }
  const [editing, setEditing] = useState<ValueField | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const savePolicy = async (next: VaultPolicy) => {
    setBusy(true);
    try {
      const item = await run(() =>
        mutations.update.mutateAsync({ handle, input: { policy: next } }),
      );
      if (!item) return;
      toast.success("Saved");
      if (item.handle !== handle) void navigate(`/vault/items/${item.handle}`, { replace: true });
      else await refresh();
    } catch (error) {
      toast.error(apiError(error, "Couldn't save"));
    } finally {
      setBusy(false);
    }
  };

  const saveValue = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await mutations.update.mutateAsync({ handle, input: { values: { [editing]: draft } } });
      toast.success(`${FIELD_LABEL[editing]} saved`);
      setEditing(null);
      setDraft("");
      await refresh();
    } catch (error) {
      toast.error(apiError(error, "Couldn't save"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (purge: boolean) => {
    setBusy(true);
    try {
      const done = await run(() => mutations.remove.mutateAsync({ handle, purge }));
      if (done) {
        toast.success(purge ? "Deleted" : "Unlinked");
        void navigate("/vault", { replace: true });
      }
    } catch (error) {
      toast.error(apiError(error, "Couldn't delete"));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <PageLayout title="Vault item" backTo="/vault" maxWidth="4xl">
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load the item"
          description={loadError}
          variant="destructive"
        />
      </PageLayout>
    );
  }
  if (!detail || !policy) {
    return (
      <PageLayout title="Vault item" backTo="/vault" maxWidth="4xl">
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      </PageLayout>
    );
  }

  const { item, capabilities } = detail;
  const missing = FIELDS_BY_KIND[item.kind].filter((field) => !detail.fields.includes(field));
  const readOnlyNote = !capabilities.update
    ? `Read-only here: edit it in ${item.backend === "local" ? "the source app" : BACKEND_LABEL[item.backend]}.`
    : undefined;

  return (
    <PageLayout
      title={item.label}
      description={
        <span>
          {KIND_LABEL[item.kind]} · <span className={monoClass}>{item.handle}</span>
          {item.lastUsedAt
            ? ` · last used ${formatRelativeTime(item.lastUsedAt)}${item.lastUsedBy ? ` by ${item.lastUsedBy}` : ""}`
            : ""}
        </span>
      }
      titleAdornment={<Badge variant="outline">{BACKEND_LABEL[item.backend]}</Badge>}
      backTo="/vault"
      maxWidth="4xl"
    >
      {(detail.stale || detail.backendError) && (
        <Card size="sm" className="border-destructive/40">
          <CardContent className="text-sm text-destructive">
            {detail.stale
              ? "This item is gone from the backend (deleted or moved). Bots can't use it; delete the link."
              : detail.backendError}
          </CardContent>
        </Card>
      )}

      <Section
        title="Values"
        description={
          readOnlyNote ??
          "Values never leave the vault except to you, here, or into the page or request a bot is approved for."
        }
      >
        <Card className="divide-y overflow-hidden p-0">
          <ul role="list">
            {detail.fields.map((field) => (
              <FieldRow
                key={field}
                handle={item.handle}
                field={field}
                {...(field === "username" && item.username ? { plain: item.username } : {})}
                {...(field === "card_expiry" && item.card?.expiry
                  ? { plain: item.card.expiry }
                  : {})}
                canReveal={capabilities.reveal}
                canEdit={capabilities.update}
                onEdit={() => {
                  setDraft("");
                  setEditing(field);
                }}
              />
            ))}
            {detail.fields.length === 0 && (
              <li className="px-4 py-3 text-sm text-muted-foreground">No values yet.</li>
            )}
          </ul>
        </Card>
        {capabilities.update && missing.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {missing.map((field) => (
              <Button
                key={field}
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraft("");
                  setEditing(field);
                }}
              >
                <Plus className="size-4" />
                {FIELD_LABEL[field]}
              </Button>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Who may use it"
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{policy.disabled ? "Off" : "On"}</span>
            <Switch
              checked={!policy.disabled}
              onCheckedChange={(checked) => void savePolicy({ ...policy, disabled: !checked })}
              aria-label="Let bots use this item"
            />
          </div>
        }
      >
        <Card>
          <CardContent className="space-y-4">
            <PolicyForm
              key={item.updatedAt}
              kind={item.kind}
              value={policy}
              onChange={setPolicy}
              defaultTools={item.effectiveTools}
              idPrefix="detail-policy"
            />
            <div className="flex justify-end">
              <Button onClick={() => void savePolicy(policy)} disabled={busy || !policy.handle}>
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Activity" meta={String(detail.events.length)}>
        {detail.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not used yet.</p>
        ) : (
          <Card className="divide-y overflow-hidden p-0">
            <ul role="list">
              {detail.events.map((event) => (
                <li key={event.id} className="flex items-start gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      {OUTCOME_LABEL[event.outcome] ?? event.outcome}
                      <span className="text-muted-foreground"> · {event.tool}</span>
                      {event.unattended && (
                        <span className="text-muted-foreground"> · unattended</span>
                      )}
                    </p>
                    <p className={cn(monoClass, "truncate text-muted-foreground")}>
                      {event.target}
                    </p>
                    {event.reason && (
                      <p className="text-xs text-muted-foreground">{event.reason}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(event.at)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section title="Danger zone">
        <Card size="sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Delete item</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Unlink it (bots lose it, the value stays in the backend) or delete it there too.
              </p>
            </div>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          </CardContent>
        </Card>
      </Section>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? FIELD_LABEL[editing] : ""}</DialogTitle>
            <DialogDescription>
              Saved straight to the backend; tiny-agents keeps no copy.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {editing && (
              <Field label="New value" htmlFor={`edit-${editing}`}>
                <ValueFieldInput
                  field={editing}
                  value={draft}
                  onChange={setDraft}
                  idPrefix="edit"
                />
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void saveValue()} disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{item.label}”?</DialogTitle>
            <DialogDescription>
              Bots lose the handle <span className={monoClass}>{item.handle}</span> either way.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => void remove(false)} disabled={busy}>
              Unlink only
            </Button>
            {capabilities.delete && (
              <Button variant="destructive" onClick={() => void remove(true)} disabled={busy}>
                Delete everywhere
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
