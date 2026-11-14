/** The pane's standing notices: no model can answer, and YOLO is on. */
import { Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@groot/ui/button";

/** Sending is off: no model is set up, or none can run. */
export function ModelWarning({ anyEnabled }: { anyEnabled: boolean | undefined }) {
  return (
    <div className="border-b bg-destructive/10 px-4 py-2 text-destructive text-xs">
      {anyEnabled ? (
        <>No model can run right now. Check the accounts in </>
      ) : (
        <>No model is set up. Add one in </>
      )}
      <Link to="/settings/models" className="font-medium underline underline-offset-2">
        Settings → Models
      </Link>
      . Sending is disabled.
    </div>
  );
}

/** YOLO mode (issue #151) is on in this chat; the owner can turn it off here. */
export function YoloBanner({ guest, onTurnOff }: { guest: boolean; onTurnOff: () => void }) {
  return (
    <div
      role="status"
      data-testid="yolo-banner"
      className="mx-auto flex w-full max-w-[784px] items-center gap-2 px-4 pt-2 text-xs md:px-5"
    >
      <span className="bg-warning/10 text-warning flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-3 py-1.5">
        <Zap className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">YOLO on: tools run without asking (vault items still ask)</span>
      </span>
      {!guest && (
        <Button size="xs" variant="ghost" onClick={onTurnOff}>
          Turn off
        </Button>
      )}
    </div>
  );
}
