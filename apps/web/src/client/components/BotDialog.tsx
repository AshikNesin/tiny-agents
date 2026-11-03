import { useEffect, useMemo, useRef, useState } from "react";
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
import { peopleApi, type Guest } from "../lib/people-api";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { ModelSelector } from "./ai-elements/ModelSelector";
import { toast } from "sonner";
import { ApiError } from "@groot/shell/lib/api";
import { ChevronRight, Search, Wrench } from "lucide-react";
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
import {
  canSaveDraft,
  draftFrom,
  draftPayload,
  draftProblem,
  fallbackModelId,
  SYSTEM_PROMPT_MAX,
  toggleId,
  type BotDraft,
} from "../lib/bot-draft";
import {
  applyPreset,
  COLLAPSE_OVER,
  groupValue,
  matchesQuery,
  permissionOf,
  setAll,
  summary,
  toolTitle,
  type ToolInfo,
} from "../lib/tool-permissions";

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
  const fallbackModel = fallbackModelId(defaultModelId, models);
  const [draft, setDraft] = useState<BotDraft>(() => draftFrom(bot, fallbackModel));
  const edit = <K extends keyof BotDraft>(key: K, value: BotDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const { name, description, systemPrompt, modelId, toolPermissions, browserProfile, autoReview } =
    draft;
  const setToolPermissions = (
    next: (current: Record<string, ToolPermission>) => Record<string, ToolPermission>,
  ) => setDraft((current) => ({ ...current, toolPermissions: next(current.toolPermissions) }));

  /** The server's refusal of the name (another bot has it, issue #80). */
  const [nameError, setNameError] = useState<string | null>(null);
  const [tab, setTab] = useState("profile");
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([]);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [toolQuery, setToolQuery] = useState("");
  /** Toolkits the user opened or closed; the rest follow their size. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // The form starts over when the dialog opens, and only then: a model
  // catalog that arrives while it is open must not wipe the owner's edits.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(draftFrom(bot, fallbackModel));
      setNameError(null);
      setTab("profile");
      setToolQuery("");
      setExpanded({});
    }
    wasOpen.current = open;
  }, [open, bot, fallbackModel]);

  // A new bot opened before the catalog loaded takes the default once it is known.
  useEffect(() => {
    if (!open || fallbackModel === undefined) return;
    setDraft((current) => (current.modelId ? current : { ...current, modelId: fallbackModel }));
  }, [open, fallbackModel]);

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
    void peopleApi
      .list()
      .then(({ guests: all }) => setGuests(all))
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
  const allTools = useMemo(
    () => toolkitsList.flatMap((toolkit) => (toolkit.setupHint ? [] : toolkit.tools)),
    [toolkitsList],
  );

  const save = async () => {
    const problem = draftProblem(draft);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const payload = draftPayload(draft);
      const saved = bot ? await botsApi.update(bot.id, payload) : await botsApi.create(payload);
      onSaved(saved);
      onOpenChange(false);
      // A new bot opens its chat, which says it all; an edit stays put.
      if (bot) toast.success("Bot updated");
    } catch (error) {
      const message = errorMessage(error, "Failed to save bot");
      // A taken name shows under the Name field (on the Profile tab).
      if (error instanceof ApiError && error.status === 409) {
        setNameError(message);
        setTab("profile");
      } else {
        toast.error(message);
      }
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
            onChange={(e) => {
              edit("name", e.target.value);
              setNameError(null);
            }}
            placeholder="e.g. Research helper"
            maxLength={100}
            autoFocus={!bot}
            aria-invalid={nameError !== null}
            aria-describedby={nameError ? "bot-name-error" : undefined}
          />
        </div>
        {nameError && (
          <p id="bot-name-error" className="text-xs text-destructive">
            {nameError}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bot-description">Description</Label>
        <Input
          id="bot-description"
          value={description}
          onChange={(e) => edit("description", e.target.value)}
          placeholder="One line, shown under the name"
          maxLength={200}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>Model</Label>
        <ModelSelector
          models={models}
          value={modelId}
          onChange={(next) => edit("modelId", next)}
          unknownValue={modelMissing ? bot?.modelId : undefined}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bot-prompt">System prompt</Label>
        <Textarea
          id="bot-prompt"
          value={systemPrompt}
          onChange={(e) => edit("systemPrompt", e.target.value)}
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

      {bot && (
        // On a phone the footer keeps only Cancel and Save; delete lives here.
        <div className="border-border/60 flex items-center gap-3 border-t pt-4 sm:hidden">
          <p className="text-muted-foreground min-w-0 flex-1 text-xs">
            Deletes the bot and its chat history.
          </p>
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmingDelete(true)}
            disabled={saving}
          >
            Delete bot
          </Button>
        </div>
      )}
    </>
  );

  const permissionToggle = (
    value: ToolPermission | "",
    onChange: (next: ToolPermission) => void,
    label: string,
    askOnly?: boolean,
  ) => (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next: string) => {
        if (next) onChange(next as ToolPermission); // clicking the active item must not clear it
      }}
      spacing={0}
      size="sm"
      aria-label={label}
      className="shrink-0"
    >
      {askOnly ? null : (
        <ToggleGroupItem value="allow" className="text-xs">
          Allow
        </ToggleGroupItem>
      )}
      <ToggleGroupItem value="ask" className="text-xs">
        {askOnly ? "Ask (always)" : "Ask"}
      </ToggleGroupItem>
      <ToggleGroupItem value="off" className="text-xs">
        Off
      </ToggleGroupItem>
    </ToggleGroup>
  );

  const toolRow = (tool: ToolInfo) => {
    const title = toolTitle(tool);
    return (
      <div key={tool.name} className="flex items-center gap-3 py-1.5 sm:pl-7">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{title}</p>
          <p className="text-muted-foreground line-clamp-2 text-xs sm:truncate">
            {tool.description}
          </p>
        </div>
        {permissionToggle(
          permissionOf(toolPermissions, tool),
          (next) => setToolPermissions((permissions) => ({ ...permissions, [tool.name]: next })),
          `${title} permission`,
          tool.askOnly,
        )}
      </div>
    );
  };

  // Bots share one browser (and its sign-ins) unless one needs its own.
  const browserProfileRow = (
    <div className="flex items-center gap-3 py-1.5 sm:pl-7">
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
          if (next) edit("browserProfile", next as BrowserProfile);
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

  const searching = toolQuery.trim().length > 0;
  // A query naming the toolkit ("notion") matches all of its tools.
  const toolGroups = toolkitsList.map((toolkit) => ({
    toolkit,
    shown: toolkit.tools.filter((tool) => matchesQuery(tool, toolkit.name, toolQuery)),
  }));
  const visibleGroups = searching
    ? toolGroups.filter(({ toolkit, shown }) => !toolkit.setupHint && shown.length > 0)
    : toolGroups;

  const toolkitGroup = ({ toolkit, shown }: (typeof toolGroups)[number]) => {
    const setUp = !toolkit.setupHint;
    // Searching opens every group with a match; otherwise big groups start closed.
    const isOpen =
      setUp && (searching || (expanded[toolkit.id] ?? toolkit.tools.length <= COLLAPSE_OVER));
    // While searching, the group control and counts cover only the matches.
    const value = groupValue(toolPermissions, shown);
    const bodyId = `toolkit-${toolkit.id}-tools`;
    return (
      <div key={toolkit.id} className="bg-secondary/50 rounded-2xl">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default max-sm:basis-full"
            onClick={() => setExpanded((current) => ({ ...current, [toolkit.id]: !isOpen }))}
            disabled={!setUp || searching}
            aria-expanded={setUp ? isOpen : undefined}
            aria-controls={setUp ? bodyId : undefined}
          >
            {setUp ? (
              <ChevronRight
                className={`text-muted-foreground size-4 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                aria-hidden
              />
            ) : (
              <Wrench className="text-muted-foreground size-4 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{toolkit.name}</span>
              <span className="text-muted-foreground block truncate text-xs">
                {toolkit.setupHint ??
                  `${shown.length} ${shown.length === 1 ? "tool" : "tools"} · ${summary(toolPermissions, shown)}`}
              </span>
            </span>
          </button>
          {setUp && shown.length > 1 && (
            <div className="ml-auto flex items-center gap-2">
              {value === "mixed" && <span className="text-muted-foreground text-xs">Mixed</span>}
              {permissionToggle(
                value === "mixed" ? "" : value,
                (next) => setToolPermissions((current) => setAll(current, shown, next)),
                searching ? `All matching ${toolkit.name} tools` : `All ${toolkit.name} tools`,
              )}
            </div>
          )}
        </div>
        {isOpen && (
          <div id={bodyId} className="border-border/60 border-t px-3.5 pb-3 pt-1">
            {toolkit.id === "browser" && !searching && browserProfileRow}
            {shown.map(toolRow)}
          </div>
        )}
      </div>
    );
  };

  const tools = (
    <div className="space-y-4">
      <div className="bg-popover sticky -top-1 z-10 -mx-1 space-y-2 px-1 pt-1 pb-2">
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            value={toolQuery}
            onChange={(e) => setToolQuery(e.target.value)}
            placeholder={`Search ${allTools.length} tools`}
            aria-label="Search tools"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs max-sm:w-full">
            {summary(toolPermissions, allTools) || "No tools"}
          </span>
          <span className="flex-1 max-sm:hidden" />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setToolPermissions((current) => applyPreset(current, allTools, "read-only"))
            }
          >
            Allow read-only
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setToolPermissions((current) => applyPreset(current, allTools, "ask-all"))
            }
          >
            Ask for everything
          </Button>
        </div>
      </div>
      {!searching && (
        <>
          <p className="text-muted-foreground text-xs">
            Every bot has these tools. <strong>Allow</strong> runs a tool unattended,{" "}
            <strong>Ask</strong> waits for your approval, <strong>Off</strong> hides it from this
            bot.
          </p>
          <div className="bg-secondary/50 flex items-start gap-3 rounded-2xl p-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Auto-review</p>
              <p className="text-muted-foreground text-xs">
                A classifier approves low-risk Ask actions you clearly asked for, so they run
                without a card. Anything else still asks you, and so do vault use and Ask (always)
                tools.
              </p>
            </div>
            <Switch
              checked={autoReview}
              onCheckedChange={(on) => edit("autoReview", on)}
              aria-label="Auto-review"
            />
          </div>
        </>
      )}
      {visibleGroups.map(toolkitGroup)}
      {searching && visibleGroups.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No tools match “{toolQuery.trim()}”.
        </p>
      )}
      {connections.length > 0 && !searching && (
        <div>
          <p className={`${metaLabelClass} mb-1.5`}>Connections</p>
          {connections.map((connection) => {
            const enabled = draft.connectionIds.includes(connection.id);
            return (
              <div key={connection.id} className="flex items-center gap-3 py-1.5">
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      connectionIds: toggleId(current.connectionIds, connection.id, checked),
                    }))
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
        const enabled = draft.skillIds.includes(skill.id);
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
                setDraft((current) => ({
                  ...current,
                  skillIds: toggleId(current.skillIds, skill.id, checked),
                }))
              }
              aria-label={`Assign ${skill.name}`}
            />
          </div>
        );
      })}
    </div>
  );

  // Sharing (issue #145): guests picked here are in the bot's chat with you.
  const sharingTab = (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">
        Guests you share this bot with join its chat: everyone sees every message, and the bot works
        for them with the tools you allowed. Vault use still waits for you, and memory is off while
        the bot is shared. Its current chat history is visible to them too.
      </p>
      {guests.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No guests yet. Add one in Settings → People.
        </p>
      )}
      {guests.map((guest) => {
        const shared = draft.guestIds.includes(guest.id);
        const label = guest.name?.trim() || guest.email;
        return (
          <div key={guest.id} className="bg-secondary/50 flex items-center gap-3 rounded-2xl p-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{label}</p>
              <p className="text-muted-foreground truncate text-xs">{guest.email}</p>
            </div>
            <Switch
              checked={shared}
              onCheckedChange={(checked) =>
                setDraft((current) => ({
                  ...current,
                  guestIds: checked
                    ? [...new Set([...current.guestIds, guest.id])]
                    : current.guestIds.filter((id) => id !== guest.id),
                }))
              }
              aria-label={`Share with ${label}`}
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
      {/* Editing has a fixed height, so switching tabs never moves the tab bar. */}
      <DialogContent className={bot ? "h-[min(85dvh,760px)] sm:max-w-xl" : "sm:max-w-xl"}>
        <DialogHeader>
          <DialogTitle>{bot ? `Edit ${bot.name}` : "New bot"}</DialogTitle>
          <DialogDescription>
            {bot
              ? "Prompt and model changes apply from the next turn; history is kept."
              : "A bot is a contact with its own persona and model."}
          </DialogDescription>
        </DialogHeader>
        {bot ? (
          <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-4">
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
              <TabsTrigger value="sharing" className="flex-1">
                Sharing
              </TabsTrigger>
            </TabsList>
            <DialogBody>
              <TabsContent value="profile" className="space-y-4">
                {profile}
              </TabsContent>
              <TabsContent value="tools">{tools}</TabsContent>
              <TabsContent value="skills">{skillsTab}</TabsContent>
              <TabsContent value="sharing">{sharingTab}</TabsContent>
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
                className="text-destructive hover:text-destructive max-sm:hidden"
                onClick={() => setConfirmingDelete(true)}
                disabled={saving}
              >
                Delete bot
              </Button>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="max-sm:flex-1"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                className="max-sm:flex-1"
                onClick={save}
                disabled={saving || !canSaveDraft(draft)}
              >
                {saving ? "Saving…" : bot ? "Save changes" : "Create bot"}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
