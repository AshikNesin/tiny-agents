/**
 * The Add Models dialog (issue #179). "Connect a provider" checks which
 * models an endpoint lists and adds the ones the owner picks; "Add a single
 * model" adds one model by id, with its capabilities set by hand. Saving asks
 * for step-up: the account's key goes straight into the vault.
 */
import { useMemo, useState } from "react";
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
import type {
  Account,
  AccountCreateBody,
  DiscoveredModel,
  ModelEndpoint,
  ProviderTemplate,
} from "../../../../shared/api/models";
import { useModelDiscovery, useModelMutations } from "../../../queries/models";
import {
  cleanCustomProviders,
  CustomProvidersEditor,
  type CustomProvider,
} from "./CustomProvidersEditor";
import { formatTokens, KIND_LABEL, KINDS } from "./model-labels";

type Kind = ModelEndpoint["kind"];
type ImageInput = "auto" | "yes" | "no";

interface Draft {
  kind: Kind;
  baseUrl: string;
  apiKey: string;
  name: string;
  accountId: string;
  gatewayId: string;
  customProviders: CustomProvider[];
  allowPrivateNetwork: boolean;
}

const EMPTY: Draft = {
  kind: "anthropic",
  baseUrl: "",
  apiKey: "",
  name: "",
  accountId: "",
  gatewayId: "",
  customProviders: [],
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
function connectionOf(draft: Draft): ModelEndpoint {
  return {
    kind: draft.kind,
    ...(draft.kind === "claude-plan" || !draft.baseUrl.trim()
      ? {}
      : { baseUrl: draft.baseUrl.trim() }),
    ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
    allowPrivateNetwork: draft.allowPrivateNetwork,
    settings:
      draft.kind === "cloudflare-ai-gateway"
        ? {
            accountId: draft.accountId.trim(),
            gatewayId: draft.gatewayId.trim(),
            customProviders: cleanCustomProviders(draft.customProviders),
          }
        : {},
  };
}

function GatewayFields({ draft, set }: { draft: Draft; set: (patch: Partial<Draft>) => void }) {
  return (
    <>
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
      <CustomProvidersEditor
        value={draft.customProviders}
        onChange={(customProviders) => set({ customProviders })}
      />
    </>
  );
}

function ConnectionFields({
  draft,
  set,
  templates,
}: {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  templates: ProviderTemplate[];
}) {
  const presets = templates.filter((t) => t.kind === draft.kind && t.baseUrl);
  const gateway = draft.kind === "cloudflare-ai-gateway";
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
      {draft.kind === "claude-plan" ? (
        <Text variant="meta" className="block">
          The Claude plan needs no key here: Claude Code signs in on the sandbox (sign in from this
          account's card once it is added). Its models are the ones your subscription offers, listed
          by Claude Code.
        </Text>
      ) : (
        <>
          {gateway ? (
            <GatewayFields draft={draft} set={set} />
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
          <Field
            label={gateway ? "Gateway token" : "API key"}
            htmlFor="model-key"
            {...(gateway
              ? {
                  hint: "The provider keys you stored in the gateway (Anthropic, TypeSafe, custom providers) stay there.",
                }
              : {})}
          >
            <Input
              id="model-key"
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
            />
          </Field>
          {!gateway && (
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

export function ModelChecklist({
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

interface SingleModel {
  upstreamId: string;
  name: string;
  maxOutputTokens: string;
  contextWindow: string;
  imageInput: ImageInput;
  reasoning: boolean;
}

const EMPTY_SINGLE: SingleModel = {
  upstreamId: "",
  name: "",
  maxOutputTokens: "",
  contextWindow: "",
  imageInput: "auto",
  reasoning: false,
};

/** Capability overrides the owner typed for a single model. */
function overridesOf(single: SingleModel) {
  return {
    ...(single.maxOutputTokens ? { maxOutputTokens: Number(single.maxOutputTokens) } : {}),
    ...(single.contextWindow ? { contextWindow: Number(single.contextWindow) } : {}),
    ...(single.imageInput !== "auto" ? { imageInput: single.imageInput === "yes" } : {}),
    ...(single.reasoning ? { reasoning: true } : {}),
  };
}

const digits = (value: string) => value.replace(/\D/g, "");

function SingleModelFields({
  single,
  setSingle,
}: {
  single: SingleModel;
  setSingle: (patch: Partial<SingleModel>) => void;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Model ID" htmlFor="single-id">
          <Input
            id="single-id"
            value={single.upstreamId}
            onChange={(e) => setSingle({ upstreamId: e.target.value })}
          />
        </Field>
        <Field label="Display name" htmlFor="single-name">
          <Input
            id="single-name"
            value={single.name}
            onChange={(e) => setSingle({ name: e.target.value })}
          />
        </Field>
        <Field label="Max output tokens" htmlFor="single-max">
          <Input
            id="single-max"
            inputMode="numeric"
            placeholder="Auto"
            value={single.maxOutputTokens}
            onChange={(e) => setSingle({ maxOutputTokens: digits(e.target.value) })}
          />
        </Field>
        <Field label="Image input" htmlFor="single-image">
          <Select
            value={single.imageInput}
            onValueChange={(value) => setSingle({ imageInput: value as ImageInput })}
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
              onChange={(e) => setSingle({ contextWindow: digits(e.target.value) })}
            />
          </Field>
          <div className="flex items-center gap-2 pt-6">
            <Checkbox
              id="single-reasoning"
              checked={single.reasoning}
              onCheckedChange={(checked) => setSingle({ reasoning: checked === true })}
            />
            <Label htmlFor="single-reasoning" className="font-normal">
              Reasoning model
            </Label>
          </div>
        </div>
      </details>
    </>
  );
}

/** The dialog's buttons: what the current tab and step can do next. */
function Actions({
  tab,
  checked,
  canConnect,
  canAdd,
  canTest,
  busy,
  onCheck,
  onConnect,
  onTest,
  onAdd,
}: {
  tab: "connect" | "single";
  checked: boolean;
  canConnect: boolean;
  canAdd: boolean;
  canTest: boolean;
  busy: boolean;
  onCheck: () => void;
  onConnect: () => void;
  onTest: () => void;
  onAdd: () => void;
}) {
  if (tab === "single") {
    return (
      <>
        <Button variant="outline" onClick={onTest} disabled={busy || !canTest}>
          Test
        </Button>
        <Button onClick={onAdd} disabled={busy || !canAdd}>
          Add
        </Button>
      </>
    );
  }
  return checked ? (
    <Button onClick={onConnect} disabled={busy || !canConnect}>
      Connect
    </Button>
  ) : (
    <Button onClick={onCheck} disabled={busy}>
      Check models
    </Button>
  );
}

interface FormProps {
  templates: ProviderTemplate[];
  template?: ProviderTemplate;
  onDone: () => void;
}

/** One pass through the dialog: mounted on open, so each open starts fresh. */
function AddModelsForm({ templates, template, onDone }: FormProps) {
  const { run } = useStepUp();
  const { create } = useModelMutations();
  const { discover, test: testModel } = useModelDiscovery();
  const [tab, setTab] = useState<"connect" | "single">("connect");
  const [draft, setDraft] = useState<Draft>(() => fromTemplate(template));
  const [found, setFound] = useState<DiscoveredModel[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [single, setSingleState] = useState<SingleModel>(EMPTY_SINGLE);
  const [tested, setTested] = useState<string | null>(null);

  const set = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setFound(null);
    setTested(null);
  };
  const setSingle = (patch: Partial<SingleModel>) => {
    setSingleState((current) => ({ ...current, ...patch }));
    if (patch.upstreamId !== undefined) setTested(null);
  };

  const aggregator = templates.some(
    (t) => t.aggregator && t.kind === draft.kind && (t.baseUrl ?? "") === draft.baseUrl,
  );

  /** Run `work` with the buttons off; a failure becomes a toast. */
  const busyWith = async (work: () => Promise<void>, failed: string) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(errorMessage(error, failed));
    } finally {
      setBusy(false);
    }
  };

  const check = () =>
    busyWith(async () => {
      const { models } = await discover.mutateAsync(connectionOf(draft));
      setFound(models);
      // Aggregators list hundreds: start with none.
      setChosen(new Set(aggregator ? [] : models.map((m) => m.upstreamId)));
      if (models.length === 0) {
        toast.info(
          draft.kind === "claude-plan"
            ? "Claude Code lists its models once it is signed in. Connect, sign in from the account's card, then check again."
            : "The endpoint lists no models. Add one by id instead.",
        );
      }
    }, "Couldn't check the endpoint");

  const save = (input: AccountCreateBody, done: (account: Account) => string, failed: string) =>
    busyWith(async () => {
      const created = await run(() => create.mutateAsync(input));
      if (!created) return;
      toast.success(done(created));
      onDone();
    }, failed);

  const name = draft.name.trim() ? { name: draft.name.trim() } : {};
  const connect = () =>
    save(
      { ...connectionOf(draft), ...name, discovery: "auto", models: [...chosen] },
      (account) => `Connected ${account.name}`,
      "Couldn't connect",
    );
  const addSingle = () =>
    save(
      {
        ...connectionOf(draft),
        ...name,
        discovery: "manual",
        model: {
          upstreamId: single.upstreamId.trim(),
          ...(single.name.trim() ? { name: single.name.trim() } : {}),
          overrides: overridesOf(single),
        },
      },
      () => `Added ${single.name.trim() || single.upstreamId.trim()}`,
      "Couldn't add the model",
    );
  const test = () =>
    busyWith(async () => {
      const result = await testModel.mutateAsync({
        ...connectionOf(draft),
        upstreamId: single.upstreamId.trim(),
        image: single.imageInput === "yes",
      });
      setTested(result.ok ? `Works (${result.latencyMs} ms)` : null);
      if (result.ok) toast.success(`The model answered in ${result.latencyMs} ms`);
      else toast.error(result.error ?? "The model didn't answer");
    }, "Couldn't test the model");

  const nameField = (
    <Field label="Account name" htmlFor="model-account-name" hint="How pickers name it.">
      <Input
        id="model-account-name"
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
      />
    </Field>
  );
  const fields = <ConnectionFields draft={draft} set={set} templates={templates} />;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add models</DialogTitle>
        <DialogDescription>Keys go straight into the vault. Bots never see them.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
          <TabsList className="mb-4">
            <TabsTrigger value="connect">Connect a provider</TabsTrigger>
            <TabsTrigger value="single">Add a single model</TabsTrigger>
          </TabsList>
          <TabsContent value="connect" className="space-y-4">
            {fields}
            {nameField}
            {found && found.length > 0 && (
              <ModelChecklist models={found} chosen={chosen} setChosen={setChosen} />
            )}
          </TabsContent>
          <TabsContent value="single" className="space-y-4">
            {fields}
            <SingleModelFields single={single} setSingle={setSingle} />
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
        <Actions
          tab={tab}
          checked={found !== null}
          // A Claude plan connects before sign-in; its models come on the next check.
          canConnect={chosen.size > 0 || draft.kind === "claude-plan"}
          canAdd={single.upstreamId.trim() !== ""}
          canTest={single.upstreamId.trim() !== "" && draft.kind !== "claude-plan"}
          busy={busy}
          onCheck={check}
          onConnect={connect}
          onTest={test}
          onAdd={addSingle}
        />
      </DialogFooter>
    </>
  );
}

export function AddModelsDialog({
  open,
  onOpenChange,
  ...form
}: Omit<FormProps, "onDone"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const { onAdded, ...rest } = form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {/* Mounted per open (and per template), so every open starts from a clean form. */}
        {open && (
          <AddModelsForm
            key={rest.template?.id ?? "blank"}
            {...rest}
            onDone={() => {
              onOpenChange(false);
              onAdded();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
