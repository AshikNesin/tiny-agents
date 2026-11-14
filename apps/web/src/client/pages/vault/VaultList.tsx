import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CreditCard, KeyRound, Link2, Plus, RefreshCw, ShieldCheck, User } from "lucide-react";
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
import { listRowClass } from "@groot/ui/list-row";
import { monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { Section } from "@groot/shell/components/layout/Section";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import type {
  UnlinkedItem,
  VaultBackendView,
  VaultItem,
  VaultKind,
  VaultOverview,
  VaultPolicy,
} from "../../../shared/api/vault";
import { apiError, KIND_LABEL, vaultApi } from "../../lib/vault-api";
import { defaultPolicy, PolicyForm, suggestHandle } from "../../components/vault/PolicyForm";
import { useStepUp } from "../../components/vault/StepUp";

const SECTIONS: { kind: VaultKind; title: string }[] = [
  { kind: "login", title: "Logins" },
  { kind: "card", title: "Cards" },
  { kind: "identity", title: "Contacts" },
  { kind: "api_key", title: "API keys" },
];

const KIND_ICON = { login: KeyRound, card: CreditCard, identity: User, api_key: ShieldCheck };

const BACKEND_LABEL: Record<VaultBackendView["name"], string> = {
  local: "Local",
};

function subtitle(item: VaultItem): string {
  if (item.card)
    return `${item.card.brand} ••${item.card.last4}${item.card.expiry ? ` · ${item.card.expiry}` : ""}`;
  const where = item.kind === "api_key" ? item.hosts : item.origins;
  return [item.username, where.join(", ")].filter(Boolean).join(" · ") || "No origin yet";
}

function lastUsed(item: VaultItem): string | undefined {
  if (!item.lastUsedAt) return undefined;
  return `used ${formatRelativeTime(item.lastUsedAt)}${item.lastUsedBy ? ` by ${item.lastUsedBy}` : ""}`;
}

function BackendCard({ backend }: { backend: VaultBackendView }) {
  const states = [backend.read, backend.write].filter(Boolean);
  const problem = states.find((s) => s!.state !== "ready");
  return (
    <Card size="sm">
      <CardContent className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">{BACKEND_LABEL[backend.name]}</p>
          <Badge variant={!backend.configured ? "outline" : problem ? "destructive" : "secondary"}>
            {!backend.configured ? "Not set up" : problem ? "Error" : "Ready"}
          </Badge>
        </div>
        {backend.configured && (
          <p className="text-xs text-muted-foreground">{problem?.detail ?? backend.read.detail}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ItemRows({ items }: { items: VaultItem[] }) {
  return (
    <Card className="divide-y overflow-hidden p-0">
      <ul role="list">
        {items.map((item) => {
          const Icon = KIND_ICON[item.kind];
          return (
            <li key={item.id}>
              <Link to={`/vault/items/${item.handle}`} className={listRowClass}>
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.label}{" "}
                    <span className={cn(monoClass, "text-muted-foreground")}>{item.handle}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle(item)}</p>
                  {lastUsed(item) && (
                    <p className="text-xs text-muted-foreground">{lastUsed(item)}</p>
                  )}
                </div>
                {item.disabled && <Badge variant="outline">off</Badge>}
                <Badge variant="outline">{BACKEND_LABEL[item.backend]}</Badge>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function LinkDialog({
  candidate,
  defaults,
  onClose,
  onLinked,
}: {
  candidate: UnlinkedItem | null;
  defaults: Record<VaultKind, string[]>;
  onClose: () => void;
  onLinked: (item: VaultItem) => void;
}) {
  const { run } = useStepUp();
  const kind: VaultKind = candidate && candidate.kind !== "other" ? candidate.kind : "login";
  const [policy, setPolicy] = useState<VaultPolicy>(() => defaultPolicy(kind));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (candidate) setPolicy(defaultPolicy(kind, suggestHandle(candidate.title)));
  }, [candidate, kind]);

  const link = async () => {
    if (!candidate) return;
    setBusy(true);
    try {
      const item = await run(() =>
        vaultApi.link({ backend: candidate.backend, externalId: candidate.externalId, policy }),
      );
      if (item) onLinked(item);
    } catch (error) {
      toast.error(apiError(error, "Couldn't link the item"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={candidate !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Let bots use “{candidate?.title}”</DialogTitle>
          <DialogDescription>
            Give it a handle and say where it may be used. The value stays in{" "}
            {candidate ? BACKEND_LABEL[candidate.backend] : "the vault"}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <PolicyForm
            kind={kind}
            value={policy}
            onChange={setPolicy}
            defaultTools={defaults[kind] ?? []}
            idPrefix="link"
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void link()} disabled={busy || !policy.handle}>
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Keys the server uses itself (audience `app`): listed read-only, changed where they are used. */
function AppItemsSection({ items }: { items: VaultItem[] }) {
  const appItems = items.filter((item) => item.audience === "app");
  if (appItems.length === 0) return null;
  return (
    <Section
      title="Used by the app"
      meta={String(appItems.length)}
      description="Keys the server uses itself, such as model providers'. Bots never see them; change them in Settings → Models."
    >
      <ItemRows items={appItems} />
    </Section>
  );
}

export function VaultList() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<VaultOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [linking, setLinking] = useState<UnlinkedItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (force = false) => {
    setRefreshing(force);
    try {
      setOverview(await vaultApi.overview(force));
      setLoadError(null);
    } catch (error) {
      setLoadError(apiError(error, "Failed to load the vault"));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The primary backend must actually be able to create items (issue #124):
  // the local backend is "configured" but unusable without SECRETS_KEY.
  const primary = overview?.backends.find((b) => b.name === overview.primaryBackend);
  const canCreate =
    !!overview &&
    (primary?.capabilities?.create ?? false) &&
    [primary?.read.state, primary?.write?.state].every((s) => !s || s === "ready");
  const createBlockedWhy =
    primary?.read.state !== "ready" || primary?.write?.state !== "ready"
      ? (primary?.read.detail ?? primary?.write?.detail)
      : undefined;

  const byKind = useMemo(() => {
    const groups: Record<VaultKind, VaultItem[]> = {
      login: [],
      card: [],
      identity: [],
      api_key: [],
    };
    for (const item of overview?.items ?? []) {
      if (item.audience === "bots") groups[item.kind].push(item);
    }
    return groups;
  }, [overview]);

  return (
    <PageLayout
      title="Vault"
      description="Logins, cards and API keys your bots use without ever seeing them."
      maxWidth="4xl"
      actions={
        <>
          <Button variant="outline" onClick={() => void refresh(true)} disabled={refreshing}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          {/* Wrapped so the reason still hovers while the button is disabled
              (disabled buttons swallow pointer events). */}
          <span
            title={
              canCreate
                ? undefined
                : `${createBlockedWhy ?? "The vault backend isn't ready."} New items are disabled until it is.`
            }
          >
            <Button onClick={() => setPicker(true)} disabled={!canCreate}>
              <Plus className="size-4" />
              New item
            </Button>
          </span>
        </>
      }
    >
      {loadError ? (
        <EmptyState
          icon={KeyRound}
          title="Couldn't load the vault"
          description={loadError}
          variant="destructive"
          action={
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : overview === null ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Section title="Backends">
            <div className="grid gap-3 sm:grid-cols-2">
              {overview.backends.map((backend) => (
                <BackendCard key={backend.name} backend={backend} />
              ))}
            </div>
          </Section>

          {overview.items.length === 0 && (
            <EmptyState
              icon={KeyRound}
              title="No vault items yet"
              description="Add a login, card or API key. Bots only ever get its handle."
            />
          )}

          {SECTIONS.map(({ kind, title }) =>
            byKind[kind].length > 0 ? (
              <Section key={kind} title={title} meta={String(byKind[kind].length)}>
                <ItemRows items={byKind[kind]} />
              </Section>
            ) : null,
          )}

          <AppItemsSection items={overview.items} />

          {overview.unlinked.length > 0 && (
            <Section
              title="Not linked yet"
              meta={String(overview.unlinked.length)}
              description="In the vault, but no bot can use them until you give them a handle."
            >
              <Card className="divide-y overflow-hidden p-0">
                <ul role="list">
                  {overview.unlinked.map((item) => (
                    <li key={`${item.backend}:${item.externalId}`} className={listRowClass}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {[
                            item.kind === "other" ? "Not usable by bots" : KIND_LABEL[item.kind],
                            item.username,
                            item.card ? `${item.card.brand} ••${item.card.last4}` : undefined,
                            item.urls[0],
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <Badge variant="outline">{BACKEND_LABEL[item.backend]}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={item.kind === "other"}
                        onClick={() => setLinking(item)}
                      >
                        <Link2 className="size-4" />
                        Link
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>
          )}
        </>
      )}

      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New item</DialogTitle>
            <DialogDescription>
              Saved in {overview ? BACKEND_LABEL[overview.primaryBackend] : "the vault"}.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid grid-cols-2 gap-2">
            {SECTIONS.map(({ kind }) => {
              const Icon = KIND_ICON[kind];
              return (
                <Button
                  key={kind}
                  variant="outline"
                  className="h-auto flex-col gap-1.5 py-4"
                  onClick={() => {
                    setPicker(false);
                    void navigate(`/vault/new/${kind}`);
                  }}
                >
                  <Icon className="size-4" />
                  {KIND_LABEL[kind]}
                </Button>
              );
            })}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicker(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LinkDialog
        candidate={linking}
        defaults={overview?.kindDefaults ?? { login: [], card: [], identity: [], api_key: [] }}
        onClose={() => setLinking(null)}
        onLinked={(item) => {
          setLinking(null);
          void navigate(`/vault/items/${item.handle}`);
        }}
      />
    </PageLayout>
  );
}
