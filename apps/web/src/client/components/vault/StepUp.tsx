/**
 * Step-up for the Vault UI: before a write, reveal or copy the owner
 * re-enters their password (or uses a passkey). `useStepUp().run(fn)` asks
 * when there is no fresh token and retries `fn` once confirmed.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
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
import { Input } from "@groot/ui/input";
import { apiError, hasStepUp, StepUpRequiredError, vaultApi } from "../../lib/vault-api";

type Run = <T>(work: () => Promise<T>) => Promise<T | undefined>;

const StepUpContext = createContext<{ run: Run } | null>(null);

export function useStepUp(): { run: Run } {
  const context = useContext(StepUpContext);
  if (!context) throw new Error("useStepUp needs a <StepUpProvider>");
  return context;
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  const ask = () =>
    new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setPassword("");
      setOpen(true);
    });

  const settle = (ok: boolean) => {
    pending.current?.(ok);
    pending.current = null;
    setOpen(false);
    setPassword("");
  };

  const run: Run = useCallback(async (work) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!hasStepUp() && !(await ask())) return undefined;
      try {
        return await work();
      } catch (error) {
        if (error instanceof StepUpRequiredError && attempt === 0) continue;
        throw error;
      }
    }
    return undefined;
  }, []);

  const confirm = async (how: "password" | "passkey") => {
    setBusy(true);
    try {
      if (how === "password") await vaultApi.confirmWithPassword(password);
      else await vaultApi.confirmWithPasskey();
      settle(true);
    } catch (error) {
      toast.error(apiError(error, "Couldn't confirm it's you"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepUpContext.Provider value={{ run }}>
      {children}
      <Dialog open={open} onOpenChange={(next) => !next && settle(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm it's you</DialogTitle>
            <DialogDescription>
              Changing or revealing vault items needs your password again. You stay confirmed for 5
              minutes.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form
              id="vault-step-up"
              onSubmit={(event) => {
                event.preventDefault();
                if (password) void confirm("password");
              }}
            >
              <Field label="Password" htmlFor="vault-step-up-password">
                <Input
                  id="vault-step-up-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                />
              </Field>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => void confirm("passkey")}>
              <KeyRound className="size-4" />
              Use a passkey
            </Button>
            <Button type="submit" form="vault-step-up" disabled={busy || !password}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StepUpContext.Provider>
  );
}
