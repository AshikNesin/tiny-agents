/**
 * The Add Models dialog (issue #179). "Connect a provider" checks which
 * models an endpoint lists and adds the ones the owner picks; "Add a single
 * model" adds one model by id, with its capabilities set by hand. Saving asks
 * for step-up: the account's key goes straight into the vault.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@groot/ui/button";
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
import { Field } from "@groot/ui/form";
import { Input } from "@groot/ui/input";
import { Label } from "@groot/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@groot/ui/tabs";
import { Text } from "@groot/ui/typography";
import { useStepUp } from "../../../components/vault/StepUp";
import { errorMessage } from "../../../lib/errors";
import {
  modelsApi,
  type Account,
  type Connection,
  type DiscoveredModel,
  type ProviderTemplate,
} from "../../../lib/models-api";
import { formatTokens, KIND_LABEL, KINDS } from "./model-labels";

type Kind = Connection["kind"];
type ImageInput = "auto" | "yes" | "no";

interface Draft {
  kind: Kind;
  baseUrl: string;
  apiKey: string;
  name: string;
  accountId: string;
  gatewayId: string;
  viaProviderId: string;
  upstream: string;
  basePath: string;
  allowPrivateNetwork: boolean;
}

const EMPTY: Draft = {
  kind: "anthropic",
  baseUrl: "",
  apiKey: "",
  name: "",
  accountId: "",
  gatewayId: "",
  viaProviderId: "",
  upstream: "",
  basePath: "",
  allowPrivateNetwork: false,
};

function fromTemplate(template: ProviderTemplate | undefined): Draft {
  if (!template) return EMPTY;
  return {
    ...EMPTY,
    kind: template.kind as Kind,
    baseUrl: template.baseUrl ?? "",
    name: template.label,
    allowPrivateNetwork: template.privateNetwork ?? false,
  };
}

/** The connection a draft describes, as the API takes it. */
function connectionOf(draft: Draft): Connection {
  const via = draft.kind === "openai-chat" && draft.viaProviderId ? draft.viaProviderId : null;
  return {
    kind: draft.kind,
    ...(via || draft.kind === "claude-plan" || !draft.baseUrl.trim()
      ? {}
      : { baseUrl: draft.baseUrl.trim() }),
    ...(draft.apiKey.trim() && !via ? { apiKey: draft.apiKey.trim() } : {}),
    allowPrivateNetwork: draft.allowPrivateNetwork,
    ...(via ? { viaProviderId: via } : {}),
    settings:
      draft.kind === "cloudflare-ai-gateway"
        ? { accountId: draft.accountId.trim(), gatewayId: draft.gatewayId.trim() }
        : via
          ? {
              upstream: draft.upstream.trim(),
              ...(draft.basePath.trim() ? { basePath: draft.basePath.trim() } : {}),
            }
          : {},
  };
}

function ConnectionFields({
  draft,
  set,
  templates,
  gateways,
}: {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  templates: ProviderTemplate[];
  gateways: Account[];
}) {
  const routed = draft.kind === "openai-chat" && draft.viaProviderId !== "";
  const presets = templates.filter((t) => t.kind === draft.kind && t.baseUrl);
  return (
    <div className="space-y-4">
      <Field label="Kind" htmlFor="model-kind">
        <Select value={draft.kind} onValueChange={(kind) => set({ ...EMPTY, kind: kind as Kind })}>
          <SelectTrigger id="model-kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {draft.kind === "openai-chat" && gateways.length > 0 && (
        <Field label="Route" htmlFor="model-route">
          <Select
            value={draft.viaProviderId || "direct"}
            onValueChange={(value) => set({ viaProviderId: value === "direct" ? "" : value })}
          >
            <SelectTrigger id="model-route" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="direct">Its own endpoint and key</SelectItem>
              {gateways.map((gateway) => (
                <SelectItem key={gateway.id} value={gateway.id}>
                  Route through gateway: {gateway.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {routed ? (
        <>
          <Field
            label="Upstream provider"
            htmlFor="model-upstream"
            hint="The gateway's name for it, e.g. custom-zai-coding-plan."
          >
            <Input
              id="model-upstream"
              value={draft.upstream}
              onChange={(e) => set({ upstream: e.target.value })}
            />
          </Field>
          <Field
            label="Base path"
            htmlFor="model-base-path"
            hint="Optional, e.g. /api/coding/paas/v4."
          >
            <Input
              id="model-base-path"
              value={draft.basePath}
              onChange={(e) => set({ basePath: e.target.value })}
            />
          </Field>
        </>
      ) : draft.kind === "claude-plan" ? (
        <Text variant="meta" className="block">
          The Claude plan needs no key here: Claude Code signs in on the sandbox (Settings → Claude
          plan).
        </Text>
      ) : (
        <>
          {draft.kind === "cloudflare-ai-gateway" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Account ID" htmlFor="model-account-id">
                <Input
                  id="model-account-id"
                  value={draft.accountId}
                  onChange={(e) => set({ accountId: e.target.value })}
                />
              </Field>
              <Field label="Gateway ID" htmlFor="model-gateway-id">
                <Input
                  id="model-gateway-id"
                  value={draft.gatewayId}
                  onChange={(e) => set({ gatewayId: e.target.value })}
                />
              </Field>
            </div>
          ) : (
            <Field label="Endpoint" htmlFor="model-endpoint">
              <Input
                id="model-endpoint"
                list="model-endpoint-presets"
                placeholder="https://"
                value={draft.baseUrl}
                onChange={(e) => set({ baseUrl: e.target.value })}
              />
              <datalist id="model-endpoint-presets">
                {presets.map((t) => (
                  <option key={t.id} value={t.baseUrl ?? ""}>
                    {t.label}
                  </option>
                ))}
              </datalist>
            </Field>
          )}
          <Field label="API key" htmlFor="model-key">
            <Input
              id="model-key"
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
            />
          </Field>
          {draft.kind !== "cloudflare-ai-gateway" && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="model-private"
                checked={draft.allowPrivateNetwork}
                onCheckedChange={(checked) => set({ allowPrivateNetwork: checked === true })}
              />
              <Label htmlFor="model-private" className="font-normal">
                Private or local endpoint (Ollama, LM Studio, a LAN host)
              </Label>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ModelChecklist({
  models,
  chosen,
  setChosen,
}: {
  models: DiscoveredModel[];
  chosen: Set<string>;
  setChosen: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? models.filter((m) => `${m.name} ${m.upstreamId}`.toLowerCase().includes(q)) : models;
  }, [models, query]);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    setChosen(next);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search models…"
          aria-label="Search models"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setChosen(new Set([...chosen, ...shown.map((m) => m.upstreamId)]))}
        >
          All
        </Button>
        <Button variant="outline" size="sm" onClick={() => setChosen(new Set())}>
          None
        </Button>
      </div>
      <Text variant="meta" className="block">
        {chosen.size} of {models.length} selected
      </Text>
      <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
        {shown.map((model) => (
          <li key={model.upstreamId} className="flex items-center gap-3 px-3 py-2">
            <Checkbox
              id={`pick-${model.upstreamId}`}
              aria-label={model.name}
              checked={chosen.has(model.upstreamId)}
              onCheckedChange={(checked) => toggle(model.upstreamId, checked === true)}
            />
            <label htmlFor={`pick-${model.upstreamId}`} className="min-w-0 flex-1 cursor-pointer">
              <Text variant="body" className="block truncate">
                {model.name}
              </Text>
              <Text variant="meta" className="block truncate">
                {model.type === "classifier"
                  ? "classifier"
                  : [
                      `${formatTokens(model.contextWindow)} context`,
                      model.imageInput ? "images" : undefined,
                      model.reasoning ? "reasoning" : undefined,
                      model.known ? undefined : "unknown capabilities",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </Text>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AddModelsDialog({
  open,
  onOpenChange,
  templates,
  template,
  accounts,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: ProviderTemplate[];
  template?: ProviderTemplate;
  accounts: Account[];
  onAdded: () => void;
}) {
  const { run } = useStepUp();
  const [tab, setTab] = useState<"connect" | "single">("connect");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [found, setFound] = useState<DiscoveredModel[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [single, setSingle] = useState({
    upstreamId: "",
    name: "",
    maxOutputTokens: "",
    contextWindow: "",
    imageInput: "auto" as ImageInput,
    reasoning: false,
  });
  const [tested, setTested] = useState<string | null>(null);
  const gateways = accounts.filter((a) => a.kind === "cloudflare-ai-gateway");

  useEffect(() => {
    if (!open) return;
    setTab("connect");
    setDraft(fromTemplate(template));
    setFound(null);
    setChosen(new Set());
    setTested(null);
    setSingle({
      upstreamId: "",
      name: "",
      maxOutputTokens: "",
      contextWindow: "",
      imageInput: "auto",
      reasoning: false,
    });
  }, [open, template]);

  const set = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setFound(null);
    setTested(null);
  };

  const aggregator = templates.some(
    (t) => t.aggregator && t.kind === draft.kind && (t.baseUrl ?? "") === draft.baseUrl,
  );

  const check = async () => {
    setBusy(true);
    try {
      const { models } = await modelsApi.discover(connectionOf(draft));
      setFound(models);
      // Aggregators list hundreds: start with none.
      setChosen(new Set(aggregator ? [] : models.map((m) => m.upstreamId)));
      if (models.length === 0) toast.info("The endpoint lists no models. Add one by id instead.");
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't check the endpoint"));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      const created = await run(() =>
        modelsApi.create({
          ...connectionOf(draft),
          ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
          discovery: "auto",
          models: [...chosen],
        }),
      );
      if (!created) return;
      toast.success(`Connected ${created.name}`);
      onOpenChange(false);
      onAdded();
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't connect"));
    } finally {
      setBusy(false);
    }
  };

  const overrides = () => ({
    ...(single.maxOutputTokens ? { maxOutputTokens: Number(single.maxOutputTokens) } : {}),
    ...(single.contextWindow ? { contextWindow: Number(single.contextWindow) } : {}),
    ...(single.imageInput !== "auto" ? { imageInput: single.imageInput === "yes" } : {}),
    ...(single.reasoning ? { reasoning: true } : {}),
  });

  const test = async () => {
    setBusy(true);
    try {
      const result = await modelsApi.test({
        ...connectionOf(draft),
        upstreamId: single.upstreamId.trim(),
        image: single.imageInput === "yes",
      });
      if (result.ok) {
        setTested(`Works (${result.latencyMs} ms)`);
        toast.success(`The model answered in ${result.latencyMs} ms`);
      } else {
        setTested(null);
        toast.error(result.error ?? "The model didn't answer");
      }
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't test the model"));
    } finally {
      setBusy(false);
    }
  };

  const addSingle = async () => {
    setBusy(true);
    try {
      const created = await run(() =>
        modelsApi.create({
          ...connectionOf(draft),
          ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
          discovery: "manual",
          model: {
            upstreamId: single.upstreamId.trim(),
            ...(single.name.trim() ? { name: single.name.trim() } : {}),
            overrides: overrides(),
          },
        }),
      );
      if (!created) return;
      toast.success(`Added ${single.name.trim() || single.upstreamId.trim()}`);
      onOpenChange(false);
      onAdded();
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't add the model"));
    } finally {
      setBusy(false);
    }
  };

  const nameField = (
    <Field label="Account name" htmlFor="model-account-name" hint="How pickers name it.">
      <Input
        id="model-account-name"
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
      />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add models</DialogTitle>
          <DialogDescription>
            Keys go straight into the vault. Bots never see them.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
            <TabsList className="mb-4">
              <TabsTrigger value="connect">Connect a provider</TabsTrigger>
              <TabsTrigger value="single">Add a single model</TabsTrigger>
            </TabsList>
            <TabsContent value="connect" className="space-y-4">
              <ConnectionFields draft={draft} set={set} templates={templates} gateways={gateways} />
              {nameField}
              {found && found.length > 0 && (
                <ModelChecklist models={found} chosen={chosen} setChosen={setChosen} />
              )}
            </TabsContent>
            <TabsContent value="single" className="space-y-4">
              <ConnectionFields draft={draft} set={set} templates={templates} gateways={gateways} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Model ID" htmlFor="single-id">
                  <Input
                    id="single-id"
                    value={single.upstreamId}
                    onChange={(e) => {
                      setSingle((s) => ({ ...s, upstreamId: e.target.value }));
                      setTested(null);
                    }}
                  />
                </Field>
                <Field label="Display name" htmlFor="single-name">
                  <Input
                    id="single-name"
                    value={single.name}
                    onChange={(e) => setSingle((s) => ({ ...s, name: e.target.value }))}
                  />
                </Field>
                <Field label="Max output tokens" htmlFor="single-max">
                  <Input
                    id="single-max"
                    inputMode="numeric"
                    placeholder="Auto"
                    value={single.maxOutputTokens}
                    onChange={(e) =>
                      setSingle((s) => ({
                        ...s,
                        maxOutputTokens: e.target.value.replace(/\D/g, ""),
                      }))
                    }
                  />
                </Field>
                <Field label="Image input" htmlFor="single-image">
                  <Select
                    value={single.imageInput}
                    onValueChange={(value) =>
                      setSingle((s) => ({ ...s, imageInput: value as ImageInput }))
                    }
                  >
                    <SelectTrigger id="single-image" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="yes">Supported</SelectItem>
                      <SelectItem value="no">Not supported</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <details className="space-y-3">
                <summary className="cursor-pointer text-sm">Advanced</summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field label="Context window" htmlFor="single-context">
                    <Input
                      id="single-context"
                      inputMode="numeric"
                      placeholder="Auto"
                      value={single.contextWindow}
                      onChange={(e) =>
                        setSingle((s) => ({
                          ...s,
                          contextWindow: e.target.value.replace(/\D/g, ""),
                        }))
                      }
                    />
                  </Field>
                  <div className="flex items-center gap-2 pt-6">
                    <Checkbox
                      id="single-reasoning"
                      checked={single.reasoning}
                      onCheckedChange={(checked) =>
                        setSingle((s) => ({ ...s, reasoning: checked === true }))
                      }
                    />
                    <Label htmlFor="single-reasoning" className="font-normal">
                      Reasoning model
                    </Label>
                  </div>
                </div>
              </details>
              {nameField}
              {tested && (
                <Text variant="meta" tone="success" className="block">
                  {tested}
                </Text>
              )}
            </TabsContent>
          </Tabs>
        </DialogBody>
        <DialogFooter>
          {tab === "connect" ? (
            draft.kind === "openai-chat" && draft.viaProviderId ? (
              <Button variant="outline" onClick={() => setTab("single")}>
                Add its models by id
              </Button>
            ) : found === null ? (
              <Button onClick={check} disabled={busy}>
                Check models
              </Button>
            ) : (
              <Button onClick={connect} disabled={busy || chosen.size === 0}>
                Connect
              </Button>
            )
          ) : (
            <>
              <Button
                variant="outline"
                onClick={test}
                disabled={busy || !single.upstreamId.trim() || draft.kind === "claude-plan"}
              >
                Test
              </Button>
              <Button onClick={addSingle} disabled={busy || !single.upstreamId.trim()}>
                Add
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
