import { RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@groot/ui/button";
import { CardAction } from "@groot/ui/card";
import type { Account } from "../../../../shared/api/models";

/** An account card's actions: Enable or Disable, Check again, Edit, Custom providers, Delete. */

export function AccountActions({
  account,
  onToggle,
  onRefresh,
  onEdit,
  onCustomProviders,
  onDelete,
}: {
  account: Account;
  onToggle: () => void;
  onRefresh: () => void;
  onEdit: () => void;
  onCustomProviders: () => void;
  onDelete: () => void;
}) {
  // A Claude plan or faux account has no endpoint to edit. The Claude plan
  // still checks again: Claude Code on the sandbox lists its models.
  const editable = account.kind !== "claude-plan" && account.kind !== "faux";
  const checkable = account.kind !== "faux";
  return (
    // On a phone the actions go under the summary, which otherwise wraps
    // into a narrow column beside them.
    <CardAction className="flex flex-wrap gap-1 max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:justify-self-start">
      <Button variant="ghost" size="sm" onClick={onToggle}>
        {account.enabled ? "Disable" : "Enable"}
      </Button>
      {checkable && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Check ${account.name} again`}
          onClick={onRefresh}
        >
          <RefreshCw className="size-4" />
        </Button>
      )}
      {editable && (
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
      )}
      {account.kind === "cloudflare-ai-gateway" && (
        <Button variant="ghost" size="sm" onClick={onCustomProviders}>
          Custom providers
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${account.name}`}
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
      </Button>
    </CardAction>
  );
}
