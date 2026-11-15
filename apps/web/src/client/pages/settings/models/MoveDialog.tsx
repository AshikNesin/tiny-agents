import { useState } from "react";
import { Button } from "@groot/ui/button";
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
import { ApiError } from "@groot/shell/lib/api";
import { ModelPicker, type ModelPickerOption } from "../../../components/ModelPicker";

/** Pick the model that takes over. Mounted only while asking, so it opens empty. */
export function MoveDialog({
  what,
  users,
  options,
  onCancel,
  onMove,
}: {
  what: string;
  users: string;
  options: ModelPickerOption[];
  onCancel: () => void;
  onMove: (modelId: string) => void;
}) {
  const [target, setTarget] = useState("");
  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{what} is in use</DialogTitle>
          <DialogDescription>
            {users} Pick the model that takes over, then delete.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Move to">
            <ModelPicker value={target} options={options} onChange={setTarget} label="Move to" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!target} onClick={() => onMove(target)}>
            Move and delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Who a 409 `in_use` names, as a sentence. */
export function inUseText(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  const details = (error.details ?? {}) as {
    in_use?: { bots?: { name: string }[]; roles?: string[]; claudePlanFallback?: boolean };
  };
  const use = details.in_use;
  if (!use) return undefined;
  const parts = [
    use.bots?.length
      ? `${use.bots.length} bot${use.bots.length === 1 ? "" : "s"} (${use.bots.map((b) => b.name).join(", ")})`
      : undefined,
    use.roles?.length
      ? `the ${use.roles.join(", ")} role${use.roles.length === 1 ? "" : "s"}`
      : undefined,
    use.claudePlanFallback ? "the Claude plan's fallback" : undefined,
  ].filter(Boolean);
  return `Used by ${parts.join(" and ")}.`;
}
