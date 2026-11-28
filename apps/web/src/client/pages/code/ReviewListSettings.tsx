import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { reviewsApi } from "../../lib/code/projects";
import { useResource } from "../../queries/resource";
import type { ReviewInboxSettings } from "../../../shared/api/code";
import { INBOX_SETTINGS_KEY } from "./ReviewList";
import { SettingsGroup, SettingsRow, SwitchRow, TextField, list } from "./SettingsRows";

export function ReviewListSettings() {
  const client = useQueryClient();
  const stored = useResource(
    INBOX_SETTINGS_KEY,
    () => reviewsApi.settings(),
    "Could not read your review list settings.",
  );
  const settings =
    stored.status === "ready" ? stored.data : stored.status === "failed" ? stored.last : undefined;
  if (!settings) {
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  }
  const save = async (change: Partial<ReviewInboxSettings>) => {
    try {
      client.setQueryData(INBOX_SETTINGS_KEY, await reviewsApi.saveSettings(change));
      void client.invalidateQueries({ queryKey: ["code", "reviews", "inbox"] });
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the review list settings."));
    }
  };
  return (
    <>
      <SettingsGroup title="Show">
        <SwitchRow
          label="Only requests to you"
          description="Leave out PRs that ask a team you are on."
          checked={settings.direct}
          onChange={(direct) => void save({ direct })}
        />
        <SwitchRow
          label="Only project repositories"
          description="Leave out repositories that are not a project here."
          checked={settings.repos === "projects"}
          onChange={(on) => void save({ repos: on ? "projects" : "all" })}
        />
        <SwitchRow
          label="Drafts"
          checked={settings.drafts}
          onChange={(drafts) => void save({ drafts })}
        />
        <SwitchRow
          label="PRs by bots"
          description="Renovate, Dependabot and logins that end in -bot."
          checked={settings.bots}
          onChange={(bots) => void save({ bots })}
        />
      </SettingsGroup>
      <SettingsGroup title="Hide">
        <SettingsRow
          label="Hide PRs matching"
          description="Words in the title, or @login for an author, separated by commas."
          htmlFor="reviews-mute"
          stack
        >
          <TextField
            id="reviews-mute"
            value={settings.mute.join(", ")}
            placeholder="back-merge, @release-bot"
            className="sm:w-full"
            onSave={(next) => void save({ mute: list(next) })}
          />
        </SettingsRow>
        <SettingsRow label="Show at most" htmlFor="reviews-limit">
          <TextField
            id="reviews-limit"
            value={String(settings.limit)}
            inputMode="numeric"
            className="sm:w-24"
            required
            onSave={(next) => {
              const n = Number(next);
              if (!Number.isInteger(n) || n < 1 || n > 100) {
                toast.error("Use a whole number from 1 to 100.");
                return false;
              }
              void save({ limit: n });
            }}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
