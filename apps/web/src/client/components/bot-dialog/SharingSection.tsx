import type { Guest } from "../../../shared/api/people";
import type { BotDraft } from "../../lib/bot-draft";
import { Switch } from "../ui/switch";

/** Sharing (issue #145): guests picked here are in the bot's chat with you. */
export function SharingSection({
  guests,
  draft,
  setDraft,
}: {
  guests: Guest[];
  draft: BotDraft;
  setDraft: (next: (current: BotDraft) => BotDraft) => void;
}) {
  return (
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
}
