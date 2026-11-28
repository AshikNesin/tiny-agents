import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@groot/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@groot/ui/tabs";
import type { Bot, ToolPermission } from "../../shared/api/bots";
import type { CatalogModel } from "../../shared/api/models";
import { toast } from "sonner";
import { ApiError } from "@groot/shell/lib/api";
import { botsApi } from "../lib/bots-api";
import { errorMessage } from "../lib/errors";
import {
  canSaveDraft,
  draftFrom,
  draftPayload,
  draftProblem,
  fallbackModelId,
  type BotDraft,
} from "../lib/bot-draft";
import { BotDialogFooter } from "./bot-dialog/BotDialogFooter";
import { ProfileSection } from "./bot-dialog/ProfileSection";
import { SharingSection } from "./bot-dialog/SharingSection";
import { SkillsSection } from "./bot-dialog/SkillsSection";
import { ToolsSection } from "./bot-dialog/ToolsSection";
import { useBotDialogLists } from "./bot-dialog/use-bot-dialog-lists";
import { useToolPermissions } from "../queries/tool-permissions";

interface BotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: CatalogModel[];
  defaultModelId?: string;
  bot?: Bot | null;
  onSaved: (bot: Bot) => void;
  onDeleted?: (bot: Bot) => void;
}

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
  const setToolPermissions = (
    next: (current: Record<string, ToolPermission>) => Record<string, ToolPermission>,
  ) => setDraft((current) => ({ ...current, toolPermissions: next(current.toolPermissions) }));

  const [nameError, setNameError] = useState<string | null>(null);
  const [tab, setTab] = useState("profile");
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [toolQuery, setToolQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  useEffect(() => {
    if (!open || fallbackModel === undefined) return;
    setDraft((current) => (current.modelId ? current : { ...current, modelId: fallbackModel }));
  }, [open, fallbackModel]);

  const { toolkitsList, allTools, connections, skills, guests } = useBotDialogLists(open);
  const ownerPermissions = useToolPermissions(open);

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
      if (bot) toast.success("Bot updated");
    } catch (error) {
      const message = errorMessage(error, "Failed to save bot");
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
    <ProfileSection
      bot={bot}
      draft={draft}
      edit={edit}
      nameError={nameError}
      onNameEdited={() => setNameError(null)}
      models={models}
      modelMissing={modelMissing}
      saving={saving}
      onDelete={() => setConfirmingDelete(true)}
    />
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfirmingDelete(false);
        onOpenChange(next);
      }}
    >
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
              <TabsContent value="tools">
                <ToolsSection
                  draft={draft}
                  edit={edit}
                  setDraft={setDraft}
                  setToolPermissions={setToolPermissions}
                  toolkitsList={toolkitsList}
                  allTools={allTools}
                  connections={connections}
                  toolQuery={toolQuery}
                  setToolQuery={setToolQuery}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  inherited={
                    ownerPermissions.status === "ready"
                      ? ownerPermissions.data.permissions
                      : ownerPermissions.status === "failed"
                        ? ownerPermissions.last?.permissions
                        : undefined
                  }
                />
              </TabsContent>
              <TabsContent value="skills">
                <SkillsSection skills={skills} draft={draft} setDraft={setDraft} />
              </TabsContent>
              <TabsContent value="sharing">
                <SharingSection guests={guests} draft={draft} setDraft={setDraft} />
              </TabsContent>
            </DialogBody>
          </Tabs>
        ) : (
          <DialogBody className="space-y-4">{profile}</DialogBody>
        )}

        <BotDialogFooter
          bot={bot}
          confirmingDelete={confirmingDelete}
          deleting={deleting}
          saving={saving}
          canSave={canSaveDraft(draft)}
          onAskDelete={() => setConfirmingDelete(true)}
          onCancelDelete={() => setConfirmingDelete(false)}
          onDelete={remove}
          onCancel={() => onOpenChange(false)}
          onSave={save}
        />
      </DialogContent>
    </Dialog>
  );
}
