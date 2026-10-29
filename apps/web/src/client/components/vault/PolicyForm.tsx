/**
 * Who and what may use a vault item: its handle, where it fills or is sent,
 * which bots and tools may use it, and when you're asked. Never a value.
 */
import { useEffect, useState } from "react";
import { Checkbox } from "@groot/ui/checkbox";
import { Field } from "@groot/ui/form";
import { Input } from "@groot/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { Textarea } from "@groot/ui/textarea";
import { botsApi, type BotListEntry } from "../../lib/bots-api";
import type { VaultApproval, VaultKind, VaultPolicy } from "../../lib/vault-api";
import { Switch } from "../ui/switch";

const APPROVAL_LABEL: Record<VaultApproval, string> = {
  every_use: "Ask every time",
  per_conversation: "Ask once per chat",
  allowed: "Don't ask",
};

const lines = (value: string) =>
  value
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);

/** A handle from a title: "GitHub (work)" → "github-work". */
export function suggestHandle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function defaultPolicy(kind: VaultKind, handle = ""): VaultPolicy {
  return {
    handle,
    origins: [],
    hosts: [],
    inject:
      kind === "api_key" ? { as: "header", name: "Authorization", format: "Bearer {value}" } : null,
    tools: [],
    bots: null,
    approval: kind === "card" ? "every_use" : "per_conversation",
    allowUnattended: false,
    whenToUse: "",
    disabled: false,
  };
}

export function PolicyForm({
  kind,
  value,
  onChange,
  defaultTools,
  idPrefix = "policy",
}: {
  kind: VaultKind;
  value: VaultPolicy;
  onChange: (next: VaultPolicy) => void;
  defaultTools: string[];
  idPrefix?: string;
}) {
  const [bots, setBots] = useState<BotListEntry[]>([]);
  const [originsText, setOriginsText] = useState(value.origins.join("\n"));
  const [hostsText, setHostsText] = useState(value.hosts.join("\n"));
  const [toolsText, setToolsText] = useState(value.tools.join(", "));

  useEffect(() => {
    void botsApi.list().then(setBots, () => setBots([]));
  }, []);

  const set = <K extends keyof VaultPolicy>(key: K, next: VaultPolicy[K]) =>
    onChange({ ...value, [key]: next });
  const id = (name: string) => `${idPrefix}-${name}`;
  const card = kind === "card";
  const fills = kind === "login" || kind === "card";

  return (
    <div className="space-y-4">
      <Field
        label="Handle"
        htmlFor={id("handle")}
        hint="The only name bots see, e.g. github. Lowercase letters, digits and dashes."
      >
        <Input
          id={id("handle")}
          value={value.handle}
          onChange={(event) => set("handle", event.target.value.toLowerCase())}
          placeholder="github"
        />
      </Field>

      {fills && (
        <Field
          label="Fills only on"
          htmlFor={id("origins")}
          hint="Exact origins, one per line (https://github.com). Subdomains don't count. Left empty on a new item, the item's websites are used."
        >
          <Textarea
            id={id("origins")}
            rows={2}
            value={originsText}
            onChange={(event) => {
              setOriginsText(event.target.value);
              set("origins", lines(event.target.value));
            }}
            placeholder="https://github.com"
          />
        </Field>
      )}

      {(kind === "api_key" || value.tools.includes("run_command")) && (
        <>
          <Field
            label="Sent only to"
            htmlFor={id("hosts")}
            hint="Hostnames the key may go to, one per line (api.openai.com)."
          >
            <Textarea
              id={id("hosts")}
              rows={2}
              value={hostsText}
              onChange={(event) => {
                setHostsText(event.target.value);
                set("hosts", lines(event.target.value));
              }}
              placeholder="api.example.com"
            />
          </Field>
          {kind === "api_key" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Header" htmlFor={id("header")}>
                <Input
                  id={id("header")}
                  value={value.inject?.name ?? ""}
                  onChange={(event) =>
                    set("inject", {
                      as: "header",
                      name: event.target.value,
                      format: value.inject?.format ?? "{value}",
                    })
                  }
                  placeholder="Authorization"
                />
              </Field>
              <Field label="Format" htmlFor={id("format")} hint="{value} is replaced by the key.">
                <Input
                  id={id("format")}
                  value={value.inject?.format ?? ""}
                  onChange={(event) =>
                    set("inject", {
                      as: "header",
                      name: value.inject?.name ?? "Authorization",
                      format: event.target.value,
                    })
                  }
                  placeholder="Bearer {value}"
                />
              </Field>
            </div>
          )}
        </>
      )}

      <Field
        label="Approval"
        htmlFor={id("approval")}
        hint={card ? "Cards always ask, every time." : "Approvals expire after 10 minutes."}
      >
        <Select
          value={card ? "every_use" : value.approval}
          onValueChange={(next) => set("approval", next as VaultApproval)}
          disabled={card}
        >
          <SelectTrigger id={id("approval")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(APPROVAL_LABEL) as VaultApproval[]).map((approval) => (
              <SelectItem key={approval} value={approval}>
                {APPROVAL_LABEL[approval]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Use in routines</p>
          <p className="text-xs text-muted-foreground">
            {card
              ? "Cards are never used without you present."
              : "Allow it in routines and messages from other bots (you're still asked when it needs approval)."}
          </p>
        </div>
        <Switch
          checked={!card && value.allowUnattended}
          disabled={card}
          onCheckedChange={(checked) => set("allowUnattended", checked)}
          aria-label="Use in routines"
        />
      </div>

      <Field label="Bots" description="Which bots may use it.">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.bots === null}
              onCheckedChange={(checked) => set("bots", checked === true ? null : [])}
            />
            Every bot
          </label>
          {value.bots !== null &&
            bots.map((bot) => (
              <label key={bot.id} className="flex items-center gap-2 pl-6 text-sm">
                <Checkbox
                  checked={value.bots?.includes(bot.id) ?? false}
                  onCheckedChange={(checked) =>
                    set(
                      "bots",
                      checked === true
                        ? [...(value.bots ?? []), bot.id]
                        : (value.bots ?? []).filter((botId) => botId !== bot.id),
                    )
                  }
                />
                {bot.name}
              </label>
            ))}
        </div>
      </Field>

      <Field
        label="Tools"
        htmlFor={id("tools")}
        hint={`Empty: ${defaultTools.join(", ") || "none"}. Add run_command to pass it to sandbox commands as an env var (every use asks; the command can reach only the hosts above).`}
      >
        <Input
          id={id("tools")}
          value={toolsText}
          onChange={(event) => {
            setToolsText(event.target.value);
            set("tools", lines(event.target.value));
          }}
          placeholder={defaultTools.join(", ")}
        />
      </Field>

      <Field
        label="When to use"
        htmlFor={id("when")}
        hint="A hint for the bot, e.g. “for the work GitHub account”."
      >
        <Input
          id={id("when")}
          value={value.whenToUse ?? ""}
          onChange={(event) => set("whenToUse", event.target.value)}
        />
      </Field>
    </div>
  );
}
