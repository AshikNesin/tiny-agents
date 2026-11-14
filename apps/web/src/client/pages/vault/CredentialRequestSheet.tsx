/**
 * The credential request sheet (issue #56): a bot asked you to sign in, enter
 * a code or pay on a page. What you type goes to the server, straight into
 * the bot's page on the origin shown here, and never to the bot.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Lock, MonitorPlay, ShieldAlert } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Card, CardContent } from "@groot/ui/card";
import { EmptyState } from "@groot/ui/empty-state";
import { Field } from "@groot/ui/form";
import { Input } from "@groot/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { apiError } from "../../lib/vault-api";
import { useCredentialRequest, useVaultMutations } from "../../queries/vault";
import { SecretInput } from "../../components/vault/SecretInput";
import { Switch } from "../../components/ui/switch";

const MASKED = new Set(["password", "otp", "card_number", "cvc"]);

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function minutesLeft(expiresAt: number): string {
  const minutes = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function CredentialRequestSheet({ taskId }: { taskId: number }) {
  const navigate = useNavigate();
  const { data: request, loadError } = useCredentialRequest(taskId);
  const mutations = useVaultMutations();
  const [values, setValues] = useState<Record<string, string>>({});
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);

  const done = () => void navigate(request?.bot ? `/chats/${request.bot.id}` : "/chats");

  const submit = async () => {
    if (!request) return;
    setBusy(true);
    try {
      const result = await mutations.submitRequest.mutateAsync({
        taskId,
        values,
        save: save && canSave,
      });
      setValues({});
      toast.success(
        result.savedHandle ? `Filled and saved as ${result.savedHandle}` : "Filled into the page",
      );
      done();
    } catch (error) {
      toast.error(apiError(error, "Couldn't fill the page"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await mutations.cancelRequest.mutateAsync(taskId);
      done();
    } catch (error) {
      toast.error(apiError(error, "Couldn't cancel"));
    } finally {
      setBusy(false);
    }
  };

  if (loadError || !request) {
    return (
      <PageLayout title="Credential request" maxWidth="4xl" backTo="/chats">
        {loadError ? (
          <EmptyState icon={Lock} title="Nothing to fill" description={loadError} />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        )}
      </PageLayout>
    );
  }

  const host = hostOf(request.origin);
  const moved = request.liveOrigin !== null && request.liveOrigin !== request.origin;
  // OTPs and security codes are never saved; anything with a password or a card number can be.
  const canSave = request.fields.some(
    (field) => field.type === "password" || field.type === "card_number",
  );
  const missing = request.fields.some((field) => field.required && !values[field.key]?.trim());
  const botName = request.bot?.name ?? "A bot";

  return (
    <PageLayout
      title={request.title}
      maxWidth="4xl"
      backTo={request.bot ? `/chats/${request.bot.id}` : "/chats"}
    >
      <Card className="mx-auto w-full max-w-md">
        <CardContent className="space-y-5">
          <div className="space-y-1 text-center">
            <p className="text-xs text-muted-foreground">Only filled on</p>
            <p className={cn(monoClass, "text-base font-semibold break-all text-foreground")}>
              {request.origin}
            </p>
            <p className="text-xs text-muted-foreground">
              {botName} asked: “{request.purpose}”
            </p>
          </div>

          {moved && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                The bot's page is now on <span className={monoClass}>{request.liveOrigin}</span>.
                Nothing will be filled there; check the live browser.
              </span>
            </div>
          )}

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!missing) void submit();
            }}
          >
            {request.fields.map((field) => {
              const id = `request-${field.key}`;
              const set = (value: string) => setValues((prev) => ({ ...prev, [field.key]: value }));
              return (
                <Field
                  key={field.key}
                  label={`${field.label}${field.required ? "*" : ""}`}
                  htmlFor={id}
                >
                  {field.type === "select" ? (
                    <Select value={values[field.key] ?? ""} onValueChange={set}>
                      <SelectTrigger id={id}>
                        <SelectValue placeholder="Choose…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(field.options ?? []).map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : MASKED.has(field.type) ? (
                    <SecretInput
                      id={id}
                      value={values[field.key] ?? ""}
                      onChange={set}
                      autoComplete={field.autocomplete}
                    />
                  ) : (
                    <Input
                      id={id}
                      type={field.type === "email" ? "email" : "text"}
                      value={values[field.key] ?? ""}
                      onChange={(event) => set(event.target.value)}
                      autoComplete={field.autocomplete}
                      inputMode={field.type === "expiry" ? "numeric" : undefined}
                    />
                  )}
                </Field>
              );
            })}

            {canSave && (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {request.savedHandle ? "Update saved login" : "Securely save to vault"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    One-time codes and security codes are never saved.
                  </p>
                </div>
                <Switch checked={save} onCheckedChange={setSave} aria-label="Save to vault" />
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              Only filled on {host}. Never shown to {botName}. Expires in{" "}
              {minutesLeft(request.expiresAt)}.
            </p>

            <div className="flex flex-col gap-2">
              <Button type="submit" disabled={busy || missing || moved}>
                Continue
              </Button>
              <div className="flex gap-2">
                {request.bot && (
                  <Button variant="outline" className="flex-1" asChild>
                    <Link to={`/chats/${request.bot.id}`}>
                      <MonitorPlay className="size-4" />
                      Live browser
                    </Link>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => void cancel()}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageLayout>
  );
}
