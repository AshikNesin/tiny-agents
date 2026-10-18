import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PlugZap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Label } from "@groot/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { connectionsApi, type Connection, type TestResult } from "../../lib/connections-api";
import { errorMessage, openOAuthPopup } from "./connection-status";

type AuthType = "none" | "header" | "oauth";

const AUTH_OPTIONS: { value: AuthType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "header", label: "API key or header" },
  { value: "oauth", label: "Sign in (OAuth)" },
];

const EMPTY_FORM = {
  name: "",
  url: "",
  authType: "none" as AuthType,
  headerName: "x-api-key",
  secret: "",
  clientId: "",
  clientSecret: "",
};

function transportLabel(transport: string): string {
  return transport === "sse" ? "SSE" : "Streamable HTTP";
}

// new URL() alone would accept mailto:; MCP endpoints are http(s) only.
function isValidConnectionUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function AddConnectionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (connection: Connection) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState({ name: false, url: false, secret: false });
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setTouched({ name: false, url: false, secret: false });
      setTestResult(null);
      setTesting(false);
      setSaving(false);
    }
  }, [open]);

  const setField = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const touch = (key: "name" | "url" | "secret") => () =>
    setTouched((prev) => ({ ...prev, [key]: true }));

  const nameValid = form.name.trim().length > 0;
  const urlValid = isValidConnectionUrl(form.url.trim());
  const secretValid = form.authType !== "header" || form.secret.length > 0;
  const showNameError = touched.name && !nameValid;
  const showUrlError = touched.url && !urlValid;
  const showSecretError = touched.secret && !secretValid;
  const canTest = form.authType === "none" || form.authType === "header";
  const canSave = nameValid && urlValid && secretValid && !saving;

  const test = async () => {
    setTesting(true);
    try {
      setTestResult(
        await connectionsApi.test({
          url: form.url.trim(),
          ...(form.authType === "header"
            ? {
                headerName: form.headerName.trim() || "x-api-key",
                ...(form.secret ? { secret: form.secret } : {}),
              }
            : {}),
        }),
      );
    } catch (error) {
      setTestResult(null);
      toast.error(errorMessage(error, "Test failed"));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const connection = await connectionsApi.create({
        name: form.name.trim(),
        url: form.url.trim(),
        authType: form.authType,
        ...(form.authType === "header"
          ? { headerName: form.headerName.trim() || "x-api-key", secret: form.secret }
          : {}),
        ...(form.authType === "oauth" && form.clientId.trim()
          ? {
              clientId: form.clientId.trim(),
              ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
            }
          : {}),
      });
      if (form.authType === "oauth") {
        try {
          const { authorizationUrl } = await connectionsApi.authorize(connection.id);
          if (authorizationUrl) {
            if (!openOAuthPopup(authorizationUrl))
              toast.error("Allow pop-ups to finish signing in");
          }
        } catch (error) {
          toast.error(errorMessage(error, "Could not start sign-in"));
        }
      }
      toast.success("Connection added");
      onCreated(connection);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to add connection"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add connection</DialogTitle>
          <DialogDescription>Connect a remote MCP server for your bots.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="connection-name">Name</Label>
            <Input
              id="connection-name"
              value={form.name}
              maxLength={60}
              placeholder="e.g. GitHub"
              aria-invalid={showNameError}
              onBlur={touch("name")}
              onChange={(e) => setField("name", e.target.value)}
            />
            {showNameError && <p className="text-xs text-destructive">Enter a name</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="connection-url">URL</Label>
            <Input
              id="connection-url"
              type="url"
              value={form.url}
              maxLength={2000}
              placeholder="https://example.com/mcp"
              aria-invalid={showUrlError}
              onBlur={touch("url")}
              onChange={(e) => setField("url", e.target.value)}
            />
            {showUrlError && <p className="text-xs text-destructive">Enter a valid https:// URL</p>}
          </div>
          <div className="space-y-2">
            <Label>Authentication</Label>
            <Select
              value={form.authType}
              onValueChange={(v) => setField("authType", v as AuthType)}
            >
              <SelectTrigger className="w-full" aria-label="Authentication type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTH_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.authType === "header" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="connection-header-name">Header name</Label>
                <Input
                  id="connection-header-name"
                  value={form.headerName}
                  maxLength={100}
                  autoComplete="off"
                  onChange={(e) => setField("headerName", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="connection-secret">Secret</Label>
                <Input
                  id="connection-secret"
                  type="password"
                  value={form.secret}
                  maxLength={8000}
                  autoComplete="new-password"
                  aria-invalid={showSecretError}
                  onBlur={touch("secret")}
                  onChange={(e) => setField("secret", e.target.value)}
                />
                {showSecretError && (
                  <p className="text-xs text-destructive">Enter the header value to send</p>
                )}
              </div>
            </>
          )}
          {form.authType === "oauth" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="connection-client-id">Client ID</Label>
                <Input
                  id="connection-client-id"
                  value={form.clientId}
                  maxLength={500}
                  autoComplete="off"
                  onChange={(e) => setField("clientId", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="connection-client-secret">Client secret</Label>
                <Input
                  id="connection-client-secret"
                  type="password"
                  value={form.clientSecret}
                  maxLength={2000}
                  autoComplete="new-password"
                  onChange={(e) => setField("clientSecret", e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Only if the server requires a pre-registered app.
              </p>
            </>
          )}
          {testResult && (
            <div className="space-y-1.5 rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium text-foreground">
                {transportLabel(testResult.transport)} ·{" "}
                {testResult.tools.length === 1
                  ? "1 tool found"
                  : `${testResult.tools.length} tools found`}
              </p>
              {testResult.tools.length > 0 && (
                <ul className="space-y-0.5">
                  {testResult.tools.slice(0, 8).map((tool, index) => (
                    <li
                      key={`${tool.label}-${index}`}
                      className="truncate text-xs text-muted-foreground"
                    >
                      {tool.label}
                      {tool.readOnly ? " · read-only" : ""}
                    </li>
                  ))}
                  {testResult.tools.length > 8 && (
                    <li className="text-xs text-muted-foreground">
                      +{testResult.tools.length - 8} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          {canTest ? (
            <Button
              variant="outline"
              onClick={() => void test()}
              disabled={!urlValid || testing || saving}
            >
              <PlugZap className="size-4" />
              {testing ? "Testing…" : "Test connection"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Sign-in (OAuth) is tested after saving
            </span>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!canSave}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
