import { Button } from "@groot/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";

export function YoloConfirmDialog({
  botName,
  open,
  onOpenChange,
  onTurnOn,
}: {
  botName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTurnOn: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Turn on YOLO mode?</DialogTitle>
          <DialogDescription>
            {botName} runs every tool call in this chat without asking you first, including ones
            already waiting. Anything that uses a vault item still asks, and so do turns another bot
            or a guest started. It stays on until you turn it off or start a new chat.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onTurnOn}>Turn on</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
