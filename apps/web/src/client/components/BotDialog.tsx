import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@groot/ui/dialog";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Textarea } from "@groot/ui/textarea";
import { Label } from "@groot/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@groot/ui/tabs";
import { Switch } from "./ui/switch";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { ModelSelector } from "./ai-elements/ModelSelector";
import { toast } from "sonner";
import { Wrench } from "lucide-react";
import { metaLabelClass } from "@groot/ui/typography";
import {
  botsApi,
  type Bot,
  type BrowserProfile,
  type CapabilityInfo,
  type ModelInfo,
  type ToolPermission,
} from "../lib/bots-api";
import { skillsApi, type SkillSummary } from "../lib/skills-api";
import { connectionsApi, type ConnectionSummary } from "../lib/connections-api";
import { BotAvatar } from "./BotAvatar";
import { errorMessage } from "../lib/errors";

/** The server caps the persona at ~24 KB (bots.schema.ts). */
const SYSTEM_PROMPT_MAX = 24_576;

interface BotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: ModelInfo[];
  defaultModelId?: string;
  /** Existing bot to edit; omitted = create. */
  bot?: Bot | null;
  onSaved: (bot: Bot) => void;
  /** Edit mode only: the bot was deleted from the dialog. */
  onDeleted?: (bot: Bot) => void;
}

function defaultPermission(tool: CapabilityInfo["tools"][number]): ToolPermission {
  return tool.readOnly && !tool.askOnly ? "allow" : "ask";
}

/**
 * Create/edit bot dialog. Create stays single-page (PRD §6.3); edit adds
 * Tools and Skills tabs for the bot's capabilities (issue #1).
 */
export function BotDialog({
  open,
  onOpenChange,
  models,
  defaultModelId,
  bot,
  onSaved,
  onDeleted,
}: BotDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([]);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [toolPermissions, setToolPermissions] = useState<Record<string, ToolPermission>>({});
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const [browserProfile, setBrowserProfile] = useState<BrowserProfile>("shared");
  const [autoReview, setAutoReview] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(bot?.name ?? "");
    setDescription(bot?.description ?? "");
    setSystemPrompt(bot?.systemPrompt ?? "");
    setModelId(bot?.modelId ?? defaultModelId ?? models[0]?.id ?? "");
    setToolPermissions(bot?.toolPermissions ?? {});
    setSelectedSkills(bot?.skillIds ?? []);
    setSelectedConnections(bot?.connectionIds ?? []);
    setBrowserProfile(bot?.browserProfile ?? "shared");
    setAutoReview(bot?.autoReview ?? false);
  }, [open, bot, defaultModelId, models]);

  useEffect(() => {
    if (!open) return;
    void botsApi
      .capabilities()
      .then(setCapabilities)
      .catch(() => undefined);
    void skillsApi
      .list()
      .then((all) => setSkills(all.map(({ id, name, description }) => ({ id, name, description }))))
      .catch(() => undefined);
    void connectionsApi
      .list()
      .then((all) =>
        setConnections(
          all.map(({ id, name, status, tools }) => ({
            id,
            name,
            status,
            toolCount: tools.filter((tool) => tool.enabled).length,
          })),
        ),
      )
      .catch(() => undefined);
  }, [open]);

  // Every bot has every toolkit; the app switches the automatic ones (vision,
  // tool search, today's date) on its own, so they are not shown.
  const toolkitsList = useMemo(
    () =>
      capabilities.filter(
        (capability) =>
          capability.kind === "toolkit" &&
          !capability.auto &&
          (capability.tools.length > 0 || capability.setupHint),
      ),
    [capabilities],
  );

  const save = async () => {
    if (!name.trim() || !modelId) {
      toast.error("Name and model are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        systemPrompt,
        modelId,
        toolPermissions,
        skillIds: selectedSkills,
        connectionIds: selectedConnections,
        browserProfile,
        autoReview,
      };
      const saved = bot ? await botsApi.update(bot.id, payload) : await botsApi.create(payload);
      onSaved(saved);
      onOpenChange(false);
      // A new bot opens its chat, which says it all; an edit stays put.
      if (bot) toast.success("Bot updated");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save bot"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!bot) return;
    setDeleting(true);
    try {
      await botsApi.remove(bot.id);
      setConfirmingDelete(false);
      onOpenChange(false);
      onDeleted?.(bot);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete bot"));
    } finally {
      setDeleting(false);
    }
  };

  const modelMissing = Boolean(bot) && !models.some((m) => m.id === bot?.modelId);

  const profile = (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="bot-name">Name</Label>
        <div className="flex items-center gap-3">
          <BotAvatar name={name || "Bot"} className="size-10 shrink-0" />
          <Input
            id="bot-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Research helper"
            maxLength={100}
            autoFocus={!bot}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bot-description">Description</Label>
        <Input
          id="bot-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One line, shown under the name"
          maxLength={200}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>Model</Label>
        <ModelSelector
          models={models}
          value={modelId}
          onChange={setModelId}
          unknownValue={modelMissing ? bot?.modelId : undefined}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bot-prompt">System prompt</Label>
        <Textarea
          id="bot-prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Who is this bot? How should it reply?"
          rows={6}
          maxLength={SYSTEM_PROMPT_MAX}
          aria-describedby="bot-prompt-count"
        />
        {systemPrompt.length > SYSTEM_PROMPT_MAX * 0.8 && (
          <p id="bot-prompt-count" className="text-muted-foreground text-right text-xs">
            {systemPrompt.length.toLocaleString()} / {SYSTEM_PROMPT_MAX.toLocaleString()}
          </p>
        )}
      </div>
    </>
  );

  const toolRow = (tool: CapabilityInfo["tools"][number]) => {
    const value = toolPermissions[tool.name] ?? defaultPermission(tool);
    return (
      <div key={tool.name} className="flex items-center gap-3 py-1.5 pl-8">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{tool.label}</p>
          <p className="text-muted-foreground truncate text-xs">{tool.description}</p>
        </div>
        <ToggleGroup
          type="single"
          value={value}
          onValueChange={(next: string) => {
            if (!next) return; // clicking the active item must not clear it
            setToolPermissions((permissions) => ({
              ...permissions,
              [tool.name]: next as ToolPermission,
            }));
          }}
          spacing={0}
          size="sm"
          aria-label={`${tool.label} permission`}
        >
          {tool.askOnly ? null : (
            <ToggleGroupItem value="allow" className="text-xs">
              Allow
            </ToggleGroupItem>
          )}
          <ToggleGroupItem value="ask" className="text-xs">
            {tool.askOnly ? "Ask (always)" : "Ask"}
          </ToggleGroupItem>
          <ToggleGroupItem value="off" className="text-xs">
            Off
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    );
  };

  // Bots share one browser (and its sign-ins) unless one needs its own.
  const browserProfileRow = (
    <div className="flex items-center gap-3 py-1.5 pl-8">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">Browser profile</p>
        <p className="text-muted-foreground text-xs">
          {browserProfile === "shared"
            ? "Signed in where your other bots are."
            : "A browser of its own, with separate sign-ins."}
        </p>
      </div>
      <ToggleGroup
        type="single"
        value={browserProfile}
        onValueChange={(next: string) => {
          if (next) setBrowserProfile(next as BrowserProfile);
        }}
        spacing={0}
        size="sm"
        aria-label="Browser profile"
      >
        <ToggleGroupItem value="shared" className="text-xs">
          Shared
        </ToggleGroupItem>
        <ToggleGroupItem value="own" className="text-xs">
          Own
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );

  const tools = (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        Every bot has these tools. <strong>Allow</strong> runs a tool unattended,{" "}
        <strong>Ask</strong> waits for your approval, <strong>Off</strong> hides it from this bot.
      </p>
      <div className="bg-secondary/50 flex items-start gap-3 rounded-2xl p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Auto-review</p>
          <p className="text-muted-foreground text-xs">
            A classifier approves low-risk Ask actions you clearly asked for, so they run without a
            card. Anything else still asks you, and so do vault use and Ask (always) tools.
          </p>
        </div>
        <Switch checked={autoReview} onCheckedChange={setAutoReview} aria-label="Auto-review" />
      </div>
      {toolkitsList.map((toolkit) => (
        <div key={toolkit.id} className="bg-secondary/50 rounded-2xl">
          <div className="flex items-center gap-3 p-3.5">
            <Wrench className="text-muted-foreground size-4" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{toolkit.name}</p>
              <p className="text-muted-foreground truncate text-xs">
                {toolkit.setupHint ?? toolkit.description}
              </p>
            </div>
          </div>
          {!toolkit.setupHint && (
            <div className="border-border/60 border-t px-3 pb-3 pt-1">
              {toolkit.id === "browser" && browserProfileRow}
              {toolkit.tools.map(toolRow)}
            </div>
          )}
        </div>
      ))}
      {connections.length > 0 && (
        <div>
          <p className={`${metaLabelClass} mb-1.5`}>Connections</p>
          {connections.map((connection) => {
            const enabled = selectedConnections.includes(connection.id);
            return (
              <div key={connection.id} className="flex items-center gap-3 py-1.5">
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) =>
                    setSelectedConnections((current) =>
                      checked
                        ? [...current, connection.id]
                        : current.filter((id) => id !== connection.id),
                    )
                  }
                  aria-label={`Enable ${connection.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{connection.name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {connection.toolCount} tools · {connection.status.replace("_", " ")}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const skillsTab = (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">
        Skills from your library the bot can load when a task needs them.
      </p>
      {skills.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No skills yet — create or import one on the Skills page.
        </p>
      )}
      {skills.map((skill) => {
        const enabled = selectedSkills.includes(skill.id);
        return (
          <div
            key={skill.id}
            className="bg-secondary/50 flex cursor-pointer items-start gap-3 rounded-2xl p-3.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{skill.name}</p>
              <p className="text-muted-foreground line-clamp-2 text-xs">{skill.description}</p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) =>
                setSelectedSkills((current) =>
                  checked ? [...current, skill.id] : current.filter((id) => id !== skill.id),
                )
              }
              aria-label={`Assign ${skill.name}`}
            />
          </div>
        );
      })}
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A dismissed dialog reopens on its form, never on the confirmation.
        if (!next) setConfirmingDelete(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{bot ? `Edit ${bot.name}` : "New bot"}</DialogTitle>
          <DialogDescription>
            {bot
              ? "Prompt and model changes apply from the next turn; history is kept."
              : "A bot is a contact with its own persona and model."}
          </DialogDescription>
        </DialogHeader>
        {bot ? (
          <Tabs defaultValue="profile" className="min-h-0 flex-1 gap-4">
            <TabsList className="w-full shrink-0">
              <TabsTrigger value="profile" className="flex-1">
                Profile
              </TabsTrigger>
              <TabsTrigger value="tools" className="flex-1">
                Tools
              </TabsTrigger>
              <TabsTrigger value="skills" className="flex-1">
                Skills
              </TabsTrigger>
            </TabsList>
            <DialogBody>
              <TabsContent value="profile" className="space-y-4">
                {profile}
              </TabsContent>
              <TabsContent value="tools">{tools}</TabsContent>
              <TabsContent value="skills">{skillsTab}</TabsContent>
            </DialogBody>
          </Tabs>
        ) : (
          <DialogBody className="space-y-4">{profile}</DialogBody>
        )}

        {confirmingDelete && bot ? (
          // Inline confirmation in place of the footer: no stacked dialog.
          <DialogFooter className="items-center sm:justify-between">
            <p className="text-destructive text-sm">Delete {bot.name}? This cannot be undone.</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={remove} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete bot"}
              </Button>
            </div>
          </DialogFooter>
        ) : (
          <DialogFooter className={bot ? "sm:justify-between" : undefined}>
            {bot && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmingDelete(true)}
                disabled={saving}
              >
                Delete bot
              </Button>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving || !name.trim() || !modelId}>
                {saving ? "Saving…" : bot ? "Save changes" : "Create bot"}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
