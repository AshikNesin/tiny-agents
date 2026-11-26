import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Play, Wrench } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@groot/ui/alert";
import { Breadcrumbs } from "@groot/ui/breadcrumb";
import { Badge } from "@groot/ui/badge";
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
import { DataField, DataFields } from "@groot/ui/display";
import { EmptyState } from "@groot/ui/empty-state";
import { Field } from "@groot/ui/form";
import { Input } from "@groot/ui/input";
import { Label } from "@groot/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { StatusBadge } from "@groot/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@groot/ui/tabs";
import { Textarea } from "@groot/ui/textarea";
import { monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { Section } from "@groot/shell/components/layout/Section";
import type {
  ConnectionToolDetail as ToolDetail,
  ToolCallResult,
} from "../../../shared/api/connections";
import {
  useConnectionMutations,
  useConnectionTool,
  useSetConnectionTool,
} from "../../queries/connections";
import { onConnectionChange } from "../../store/bots";
import { Switch } from "@groot/ui/switch";
import { errorMessage } from "../../components/connections/connection-status";
import {
  buildArgs,
  exampleArgs,
  hasOpenShape,
  initialValues,
  parseArgsJson,
  schemaFields,
  valuesFromArgs,
  type FieldValues,
  type SchemaField,
} from "../../components/connections/tool-schema";

const UNSET = "__unset__";
const codeBlockClass = cn(
  monoClass,
  "max-h-96 overflow-auto rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap break-words text-foreground",
);

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function prettyText(text: string): string {
  try {
    return pretty(JSON.parse(text));
  } catch {
    return text;
  }
}

function behaviorBadges(tool: ToolDetail): string[] {
  return [
    tool.readOnly ? "read-only" : "may change data",
    ...(tool.idempotent ? ["idempotent"] : []),
    ...(tool.destructive ? ["destructive"] : []),
    ...(tool.openWorld ? ["open world"] : []),
  ];
}

function SchemaView({ schema, label }: { schema: Record<string, unknown>; label: string }) {
  const fields = useMemo(() => schemaFields(schema), [schema]);
  const open = hasOpenShape(schema);
  return (
    <Tabs defaultValue={fields.length > 0 ? "fields" : "json"}>
      <TabsList>
        <TabsTrigger value="fields">Fields</TabsTrigger>
        <TabsTrigger value="json">JSON Schema</TabsTrigger>
      </TabsList>
      <TabsContent value="fields">
        {fields.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">
            {open ? `No fixed ${label}; see the JSON Schema.` : `No ${label}.`}
          </p>
        ) : (
          <Card className="divide-y overflow-hidden p-0">
            <ul role="list" className="divide-y">
              {fields.map((field) => (
                <li key={field.name} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cn(monoClass, "text-sm font-medium text-foreground")}>
                      {field.name}
                    </span>
                    <span className={cn(monoClass, "text-xs text-muted-foreground")}>
                      {field.type}
                    </span>
                    {field.required && <Badge variant="outline">required</Badge>}
                  </div>
                  {field.description && (
                    <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">
                      {field.description}
                    </p>
                  )}
                  {field.defaultValue !== undefined && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Default <span className={monoClass}>{pretty(field.defaultValue)}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </TabsContent>
      <TabsContent value="json">
        <pre className={codeBlockClass}>{pretty(schema)}</pre>
      </TabsContent>
    </Tabs>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `tool-arg-${field.name}`;
  if (field.kind === "boolean" || field.kind === "enum") {
    const options = field.kind === "boolean" ? ["true", "false"] : (field.options ?? []);
    return (
      <Select
        value={value === "" ? UNSET : value}
        onValueChange={(next) => onChange(next === UNSET ? "" : next)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent>
          {!field.required && <SelectItem value={UNSET}>Not set</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (field.kind === "number" || field.kind === "integer") {
    return (
      <Input
        id={id}
        inputMode={field.kind === "integer" ? "numeric" : "decimal"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <Textarea
      id={id}
      rows={1}
      className={cn("min-h-9", field.kind === "json" && monoClass)}
      placeholder={field.kind === "json" ? field.type : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function contentBlocks(content: ToolCallResult["result"]["content"] = []) {
  return content.map((block, position) => ({
    id: `${position}-${block.type}`,
    number: position + 1,
    block,
  }));
}

function CallResultView({ call }: { call: ToolCallResult }) {
  const { result } = call;
  const blocks = contentBlocks(result.content);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {result.isError ? (
          <StatusBadge status="error" label="Tool error" />
        ) : (
          <StatusBadge status="success" label="Success" />
        )}
        <span className="text-xs text-muted-foreground">{call.durationMs} ms</span>
      </div>
      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">Content</TabsTrigger>
          {result.structuredContent && <TabsTrigger value="structured">Structured</TabsTrigger>}
          <TabsTrigger value="raw">Raw</TabsTrigger>
        </TabsList>
        <TabsContent value="content" className="space-y-2">
          {blocks.length === 0 && (
            <p className="text-xs text-muted-foreground">The tool returned no content.</p>
          )}
          {blocks.map(({ id, number, block }) =>
            block.type === "text" && block.text !== undefined ? (
              <pre key={id} className={codeBlockClass}>
                {prettyText(block.text)}
              </pre>
            ) : block.type === "image" && block.data && block.mimeType ? (
              <img
                key={id}
                src={`data:${block.mimeType};base64,${block.data}`}
                alt={`Tool result ${number}`}
                className="max-h-96 rounded-lg ring-1 ring-foreground/10"
              />
            ) : (
              <pre key={id} className={codeBlockClass}>
                {pretty(block)}
              </pre>
            ),
          )}
        </TabsContent>
        {result.structuredContent && (
          <TabsContent value="structured">
            <pre className={codeBlockClass}>{pretty(result.structuredContent)}</pre>
          </TabsContent>
        )}
        <TabsContent value="raw">
          <pre className={codeBlockClass}>{pretty(result)}</pre>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Playground({ tool }: { tool: ToolDetail }) {
  const fields = useMemo(() => schemaFields(tool.inputSchema), [tool.inputSchema]);
  const openShape = hasOpenShape(tool.inputSchema);
  const [mode, setMode] = useState<"form" | "json">(fields.length > 0 ? "form" : "json");
  const [values, setValues] = useState<FieldValues>(() => initialValues(fields));
  const [jsonText, setJsonText] = useState(() => pretty(exampleArgs(fields)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [pendingArgs, setPendingArgs] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const [call, setCall] = useState<ToolCallResult | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const { callTool } = useConnectionMutations();

  const switchMode = (next: string) => {
    if (next === "json") {
      const built = buildArgs(fields, values);
      setJsonText(pretty(built.ok ? built.args : exampleArgs(fields)));
      setJsonError(null);
      setMode("json");
    } else if (next === "form") {
      const parsed = parseArgsJson(jsonText);
      if (!parsed.ok) {
        setJsonError(parsed.error);
        return;
      }
      setValues(valuesFromArgs(fields, parsed.args));
      setErrors({});
      setMode("form");
    }
  };

  const execute = async (args: Record<string, unknown>) => {
    setPendingArgs(null);
    setRunning(true);
    setCallError(null);
    try {
      setCall(await callTool.mutateAsync({ id: tool.connection.id, tool: tool.serverName, args }));
    } catch (error) {
      setCall(null);
      setCallError(errorMessage(error, "Call failed"));
    } finally {
      setRunning(false);
    }
  };

  const run = () => {
    let args: Record<string, unknown>;
    if (mode === "form") {
      const built = buildArgs(fields, values);
      if (!built.ok) {
        setErrors(built.errors);
        return;
      }
      setErrors({});
      args = built.args;
    } else {
      const parsed = parseArgsJson(jsonText);
      if (!parsed.ok) {
        setJsonError(parsed.error);
        return;
      }
      setJsonError(null);
      args = parsed.args;
    }
    if (tool.readOnly) void execute(args);
    else setPendingArgs(args);
  };

  const needsAuth = tool.connection.status === "needs_auth";

  return (
    <Card>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={switchMode}>
          <TabsList>
            <TabsTrigger value="form" disabled={fields.length === 0}>
              Form
            </TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
          </TabsList>
          <TabsContent value="form" className="space-y-4">
            {fields.map((field) => (
              <Field
                key={field.name}
                htmlFor={`tool-arg-${field.name}`}
                label={
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className={monoClass}>{field.name}</span>
                    <span className={cn(monoClass, "font-normal text-muted-foreground")}>
                      {field.type}
                    </span>
                    {field.required && <span className="text-destructive">*</span>}
                  </span>
                }
                description={field.description}
              >
                <FieldInput
                  field={field}
                  value={values[field.name] ?? ""}
                  onChange={(value) =>
                    setValues((current) => ({ ...current, [field.name]: value }))
                  }
                />
                {errors[field.name] && (
                  <p className="text-xs text-destructive">{errors[field.name]}</p>
                )}
              </Field>
            ))}
          </TabsContent>
          <TabsContent value="json" className="space-y-1.5">
            {fields.length === 0 && !openShape ? (
              <p className="text-xs text-muted-foreground">This tool takes no arguments.</p>
            ) : (
              <>
                <Label htmlFor="tool-args-json" className="text-sm font-medium">
                  Arguments
                </Label>
                <Textarea
                  id="tool-args-json"
                  className={cn(monoClass, "min-h-32")}
                  value={jsonText}
                  onChange={(event) => setJsonText(event.target.value)}
                  aria-invalid={jsonError ? true : undefined}
                  spellCheck={false}
                />
                {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
              </>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={running || needsAuth}>
            <Play className="size-4" />
            {running ? "Running…" : "Run tool"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {needsAuth
              ? `Sign in to ${tool.connection.name} to run tools.`
              : tool.readOnly
                ? "Runs on the live server."
                : `Runs for real on ${tool.connection.name}; you'll be asked to confirm.`}
          </span>
        </div>

        {callError && (
          <Alert variant="destructive">
            <AlertTitle>Couldn't run the tool</AlertTitle>
            <AlertDescription>{callError}</AlertDescription>
          </Alert>
        )}
        {call && <CallResultView call={call} />}
      </CardContent>

      <Dialog open={pendingArgs !== null} onOpenChange={(open) => !open && setPendingArgs(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Run {tool.label}?</DialogTitle>
            <DialogDescription>
              {tool.destructive
                ? `The server marks this tool destructive. It runs for real on ${tool.connection.name}.`
                : `This tool may change data on ${tool.connection.name}. It runs for real.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingArgs(null)}>
              Cancel
            </Button>
            <Button
              variant={tool.destructive ? "destructive" : "default"}
              onClick={() => pendingArgs && void execute(pendingArgs)}
            >
              Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function ConnectionToolDetail({ id, tool: serverName }: { id: string; tool: string }) {
  const { data: tool, loadError, refresh } = useConnectionTool(id, serverName);
  const setTool = useSetConnectionTool(id, serverName);
  const { updateTool } = useConnectionMutations();
  const [saving, setSaving] = useState(false);

  useEffect(
    () =>
      onConnectionChange((change) => {
        if (change.id === id) void refresh();
      }),
    [id, refresh],
  );

  const toggle = async (enabled: boolean) => {
    if (!tool) return;
    setTool({ ...tool, enabled });
    setSaving(true);
    try {
      setTool(await updateTool.mutateAsync({ id, tool: serverName, input: { enabled } }));
      toast.success(enabled ? "Bots can use this tool" : "Turned off for every bot");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update tool"));
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const backTo = `/connections/${id}`;

  if (loadError) {
    return (
      <PageLayout title="Tool" maxWidth="4xl" backTo={backTo}>
        <EmptyState
          icon={Wrench}
          title="Couldn't load tool"
          description={loadError}
          variant="destructive"
          action={
            <>
              <Button variant="outline" render={<Link to={backTo} />}>
                <ArrowLeft className="size-4" />
                Back to connection
              </Button>
              <Button onClick={() => void refresh()}>Retry</Button>
            </>
          }
        />
      </PageLayout>
    );
  }

  if (!tool) {
    return (
      <PageLayout title="Tool" maxWidth="4xl" backTo={backTo}>
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      </PageLayout>
    );
  }

  const breadcrumb = (
    <Breadcrumbs page={tool.label}>
      <Link to="/connections">Connections</Link>
      <Link to={backTo}>{tool.connection.name}</Link>
    </Breadcrumbs>
  );

  return (
    <PageLayout
      title={tool.label}
      description={
        <span className={cn(monoClass, "break-all text-muted-foreground")}>{tool.name}</span>
      }
      breadcrumb={breadcrumb}
      maxWidth="4xl"
      backTo={backTo}
      actions={
        <div className="flex items-center gap-2">
          <Switch
            id="tool-enabled"
            checked={tool.enabled}
            disabled={saving}
            onCheckedChange={(checked) => void toggle(checked)}
          />
          <Label htmlFor="tool-enabled" className="text-sm">
            Available to bots
          </Label>
        </div>
      }
    >
      {!tool.enabled && (
        <Alert>
          <AlertTitle>Off for every bot</AlertTitle>
          <AlertDescription>
            No bot sees this tool, whatever its own permissions say. You can still try it in the
            playground below.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4">
          {tool.description ? (
            <p className="text-sm whitespace-pre-wrap text-foreground">{tool.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">The server gives no description.</p>
          )}
          <DataFields columns={3}>
            <DataField label="Server name" valueClassName={cn(monoClass, "break-all")}>
              {tool.serverName}
            </DataField>
            <DataField label="Connection">
              <Link to={backTo} className="hover:underline">
                {tool.connection.name}
              </Link>
            </DataField>
            <DataField label="Behavior" valueClassName="flex flex-wrap gap-1">
              {behaviorBadges(tool).map((badge) => (
                <Badge key={badge} variant="outline">
                  {badge}
                </Badge>
              ))}
            </DataField>
          </DataFields>
          <p className="text-xs text-muted-foreground">
            Behavior comes from the server's hints. Each bot still decides whether it may run the
            tool or must ask first.
          </p>
        </CardContent>
      </Card>

      <Section title="Input" description="The arguments the tool accepts.">
        <SchemaView schema={tool.inputSchema} label="arguments" />
      </Section>

      <Section title="Output">
        {tool.outputSchema ? (
          <SchemaView schema={tool.outputSchema} label="fields" />
        ) : (
          <p className="text-xs text-muted-foreground">
            The server declares no output schema; results come back as content blocks.
          </p>
        )}
      </Section>

      <Section
        title="Playground"
        description={`Call the tool on ${tool.connection.name} as yourself. Nothing is sent to a bot.`}
      >
        <Playground key={tool.serverName} tool={tool} />
      </Section>
    </PageLayout>
  );
}
