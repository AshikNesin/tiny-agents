import { Link } from "react-router-dom";

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

export function YoloBanner({ guest, onTurnOff }: { guest: boolean; onTurnOff: () => void }) {
  return (
    <div
      role="status"
      data-testid="yolo-banner"
      className="text-muted-foreground mx-auto flex w-full max-w-[784px] items-center gap-2 px-5 pt-2 text-xs md:px-6"
    >
      <span aria-hidden className="bg-warning size-1.5 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-foreground font-medium">YOLO</span> · no approval needed, except vault
        items
      </span>
      {!guest && (
        <button
          type="button"
          onClick={onTurnOff}
          className="hover:text-foreground shrink-0 font-medium underline-offset-2 hover:underline"
        >
          Turn off
        </button>
      )}
    </div>
  );
}
