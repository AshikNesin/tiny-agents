import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  type CapabilityInfo,
  type ModelInfo,
  type ToolPermission,
} from "../lib/bots-api";
import { skillsApi, type SkillSummary } from "../lib/skills-api";
import { connectionsApi, type ConnectionSummary } from "../lib/connections-api";
import { BotAvatar } from "./BotAvatar";

const AVATAR_COLORS = [
  "#14b8a6",
  "#0ea5e9",
  "#8b5cf6",
  "#f43f5e",
  "#f59e0b",
  "#10b981",
  "#6366f1",
  "#ec4899",
];

const EMOJI_CHOICES = ["🤖", "🧠", "🔎", "📝", "🧪", "📊", "🛠️", "🌿", "🎯", "💬", "⚡", "🧭"];

interface BotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: ModelInfo[];
  defaultModelId?: string;
  /** Existing bot to edit; omitted = create. */
  bot?: Bot | null;
  onSaved: (bot: Bot) => void;
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
}: BotDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState<string>("");
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([]);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [toolkits, setToolkits] = useState<string[]>([]);
  const [toolPermissions, setToolPermissions] = useState<Record<string, ToolPermission>>({});
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(bot?.name ?? "");
    setDescription(bot?.description ?? "");
    setSystemPrompt(bot?.systemPrompt ?? "");
    setModelId(bot?.modelId ?? defaultModelId ?? models[0]?.id ?? "");
    setAvatarEmoji(bot?.avatarEmoji ?? "");
    setAvatarColor(
      bot?.avatarColor ?? AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    );
    setToolkits(bot?.toolkits ?? []);
    setToolPermissions(bot?.toolPermissions ?? {});
    setSelectedSkills(bot?.skillIds ?? []);
    setSelectedConnections(bot?.connectionIds ?? []);
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
            toolCount: tools.length,
          })),
        ),
      )
      .catch(() => undefined);
  }, [open]);

  const toolkitsList = useMemo(
    () => capabilities.filter((capability) => capability.kind === "toolkit"),
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
        avatarColor,
        toolkits,
        toolPermissions,
        skillIds: selectedSkills,
        connectionIds: selectedConnections,
      };
      // Create keeps an undefined emoji (server default); update can clear it.
      const saved = bot
        ? await botsApi.update(bot.id, {
            ...payload,
            avatarEmoji: avatarEmoji || null,
          })
        : await botsApi.create({ ...payload, ...(avatarEmoji ? { avatarEmoji } : {}) });
      onSaved(saved);
      onOpenChange(false);
      toast.success(bot ? "Bot updated" : "Bot created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save bot");
    } finally {
      setSaving(false);
    }
  };

  const modelMissing = Boolean(bot) && !models.some((m) => m.id === bot?.modelId);

  const profile = (
    <>
      <div className="flex items-center gap-3">
        <BotAvatar
          name={name || "Bot"}
          emoji={avatarEmoji || null}
          color={avatarColor}
          className="size-12 text-lg"
        />
        <div className="flex-1">
          <Label htmlFor="bot-name">Name</Label>
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
        <Label>Avatar</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {EMOJI_CHOICES.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setAvatarEmoji(avatarEmoji === emoji ? "" : emoji)}
              className={`rounded-md border p-1.5 text-base ${
                avatarEmoji === emoji
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-muted"
              }`}
              aria-pressed={avatarEmoji === emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {AVATAR_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setAvatarColor(color)}
              className={`size-6 rounded-md ring-offset-2 transition-transform ${
                avatarColor === color ? "ring-2 ring-ring scale-110" : ""
              }`}
              style={{ backgroundColor: color }}
              aria-label={`Colour ${color}`}
              aria-pressed={avatarColor === color}
            />
          ))}
          <span className="ml-1 text-xs text-muted-foreground">
            {avatarEmoji ? "" : "Initials of the name are used without an emoji"}
          </span>
        </div>
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
        />
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

  const tools = (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        Tools run <strong>Allow</strong> unattended, <strong>Ask</strong> waits for your approval,
        <strong> Off</strong> hides them from the bot.
      </p>
      {toolkitsList.map((toolkit) => {
        const enabled = toolkits.includes(toolkit.id);
        return (
          <div key={toolkit.id} className="rounded-lg border">
            <div className="flex cursor-pointer items-center gap-3 p-3">
              <Wrench className="text-muted-foreground size-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{toolkit.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {toolkit.setupHint ?? toolkit.description}
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(checked) =>
                  setToolkits((current) =>
                    checked ? [...current, toolkit.id] : current.filter((id) => id !== toolkit.id),
                  )
                }
                aria-label={`Enable ${toolkit.name}`}
              />
            </div>
            {enabled && (
              <div className="border-t px-3 pb-3 pt-1">
                {toolkit.setupHint ? null : toolkit.tools.map(toolRow)}
              </div>
            )}
          </div>
        );
      })}
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
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{bot ? `Edit ${bot.name}` : "New bot"}</DialogTitle>
          <DialogDescription>
            {bot
              ? "Prompt and model changes apply from the next turn; history is kept."
              : "A bot is a contact with its own persona and model."}
          </DialogDescription>
        </DialogHeader>

        {bot ? (
          <Tabs defaultValue="profile">
            <TabsList className="w-full">
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
            <TabsContent value="profile" className="mt-4 space-y-4">
              {profile}
            </TabsContent>
            <TabsContent value="tools">{tools}</TabsContent>
            <TabsContent value="skills">{skillsTab}</TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-4">{profile}</div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !name.trim() || !modelId}>
            {saving ? "Saving…" : bot ? "Save changes" : "Create bot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
