import { toast } from "sonner";
import { Copy } from "lucide-react";
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
import { Input } from "@groot/ui/input";
import { monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";

export function HookUrlDialog({
  url,
  routineName,
  onOpenChange,
}: {
  url: string | null;
  routineName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Webhook URL copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't copy the URL");
    }
  };
  return (
    <Dialog open={url !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Webhook URL for {routineName}</DialogTitle>
          <DialogDescription>
            A POST to this URL runs the routine with the request body as its input. Copy it now: it
            is shown only once, and making a new one stops this one.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <Input
            readOnly
            aria-label="Webhook URL"
            value={url ?? ""}
            className={cn(monoClass, "w-full")}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="text-xs text-muted-foreground">
            Send an Idempotency-Key header so a retried delivery runs once. Deliveries that arrive
            during a run wait and go into the next run together.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => void copy()}>
            <Copy className="size-4" />
            Copy URL
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
