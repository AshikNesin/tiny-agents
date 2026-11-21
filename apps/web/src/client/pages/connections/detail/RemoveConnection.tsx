import { Trash2 } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Card, CardContent } from "@groot/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { Section } from "@groot/shell/components/layout/Section";
import type { Connection } from "../../../../shared/api/connections";

export function ConnectionDangerZone({
  connection,
  onRemove,
}: {
  connection: Connection;
  onRemove: () => void;
}) {
  return (
    <Section title="Danger zone">
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Remove connection</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {connection.botIds.length === 0
                ? "Removes the server and its cached tools."
                : connection.botIds.length === 1
                  ? "1 bot will lose these tools."
                  : `${connection.botIds.length} bots will lose these tools.`}
            </p>
          </div>
          <Button variant="destructive" onClick={onRemove}>
            <Trash2 className="size-4" />
            Remove
          </Button>
        </CardContent>
      </Card>
    </Section>
  );
}

export function RemoveConnectionDialog({
  connection,
  open,
  onOpenChange,
  removing,
  onRemove,
}: {
  connection: Connection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  removing: boolean;
  onRemove: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove connection?</DialogTitle>
          <DialogDescription>
            {connection.botIds.length === 0
              ? `"${connection.name}" will be permanently removed.`
              : connection.botIds.length === 1
                ? `1 bot will lose these tools. "${connection.name}" will be permanently removed.`
                : `${connection.botIds.length} bots will lose these tools. "${connection.name}" will be permanently removed.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={removing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onRemove} disabled={removing}>
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
