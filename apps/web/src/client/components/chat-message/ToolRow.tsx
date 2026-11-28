import { useRef } from "react";
import { Ban, Clock, ExternalLink, ListChecks, Sparkles } from "lucide-react";
import type { ChatToolCall } from "../../lib/chat-types";
import { viewOf } from "../../lib/tool-call-view";
import {
  approvalNote,
  durationText,
  groupText,
  stepTitle,
  type ToolLabelCatalog,
} from "../../lib/tool-call-text";
import { useOwnerActions } from "../../lib/owner-actions";
import { BotHandoff } from "../BotHandoff";
import { CodeHandoffCard } from "../CodeHandoffCard";
import { ArtifactCard } from "../artifacts/ArtifactCard";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "../ui/code-block";
import { useHighlightedCode } from "../ui/hooks/use-highlighted-code";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "../ui/trace";
import { AskedQuestions, QuestionCard } from "../QuestionCard";
import { ApprovalCard, CredentialRequestCard, TakeoverCard, VaultApprovalCard } from "./tool-cards";

const STATUS_ICONS = {
  clock: <Clock className="text-primary size-3.5" />,
  ban: <Ban className="size-3.5" />,
};

function ToolDetailBlock({
  title,
  value,
  destructive = false,
}: {
  title: string;
  value: string;
  destructive?: boolean;
}) {
  const lines = useHighlightedCode(value, "json");
  return (
    <CodeBlock size="sm" variant={destructive ? "destructive" : "default"}>
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
      </CodeBlockHeader>
      <CodeBlockContent
        wrap
        className="max-h-64 overflow-y-auto overscroll-contain [scrollbar-width:auto] [scrollbar-gutter:stable]"
      >
        {lines.map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

export function ToolRow({
  call,
  labels,
  botName,
}: {
  call: ChatToolCall;
  labels: ToolLabelCatalog;
  botName: string;
}) {
  const actions = useOwnerActions();
  const view = viewOf(call, { readOnly: !actions });
  const contentRef = useRef<HTMLDivElement | null>(null);
  const argsJson = JSON.stringify(call.args, null, 2);
  const detail =
    call.output || argsJson !== "{}" ? (
      <div className="flex flex-col gap-2">
        {argsJson !== "{}" && <ToolDetailBlock title="Input" value={argsJson} />}
        {call.output && (
          <ToolDetailBlock
            title="Output"
            value={call.output}
            destructive={view.phase === "failed"}
          />
        )}
        {call.sources && call.sources.length > 0 && (
          <Trace>
            {call.sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                <TraceLine>
                  <TraceIcon>
                    <ExternalLink />
                  </TraceIcon>
                  <TraceTitle>{source.title}</TraceTitle>
                </TraceLine>
              </a>
            ))}
          </Trace>
        )}
      </div>
    ) : null;

  switch (view.card) {
    case "vault-approval":
      return (
        <div data-waiting={view.anchor}>
          <VaultApprovalCard
            call={{ ...call, taskId: call.taskId!, vault: call.vault! }}
            actions={actions!}
            botName={botName}
          />
        </div>
      );
    case "approval":
      return (
        <div data-waiting={view.anchor}>
          <ApprovalCard
            call={{ ...call, taskId: call.taskId! }}
            labels={labels}
            actions={actions!}
            botName={botName}
          />
        </div>
      );
    case "credentials":
      return (
        <div data-waiting={view.anchor}>
          <CredentialRequestCard
            call={{ ...call, taskId: call.taskId!, credentials: call.credentials! }}
            botName={botName}
          />
        </div>
      );
    case "takeover":
      return (
        <div data-waiting={view.anchor}>
          <TakeoverCard
            call={{ ...call, takeover: call.takeover! }}
            actions={actions!}
            botName={botName}
          />
        </div>
      );
    case "question":
      return (
        <div data-waiting={view.anchor}>
          <QuestionCard
            call={{ ...call, taskId: call.taskId!, questions: call.questions! }}
            actions={actions!}
            botName={botName}
          />
        </div>
      );
    case "asked-questions":
      return <AskedQuestions call={call} note={view.note} />;
    case "bot-handoff":
      return <BotHandoff call={call} botName={botName} />;
    case "code-handoff":
      return <CodeHandoffCard handoff={call.code!} />;
    case "artifact":
      return <ArtifactCard call={{ ...call, artifact: call.artifact! }} />;
  }

  const title = stepTitle(call, labels);
  const note = approvalNote(view.note, call.approval);
  const duration = durationText(call);
  const line = (
    <TraceLine status={view.trace}>
      {view.icon ? <TraceIcon>{STATUS_ICONS[view.icon]}</TraceIcon> : null}
      <TraceTitle>
        {call.name === "load_skill" ? (
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3" />
            {title}
          </span>
        ) : (
          title
        )}
      </TraceTitle>
      {note !== undefined && <TraceDescription>{note}</TraceDescription>}
      {duration !== undefined && <TraceDescription>{duration}</TraceDescription>}
    </TraceLine>
  );

  return (
    <Trace className="gap-1">
      {detail ? (
        <TraceCollapsible
          onOpenChange={(open) => {
            if (!open) return;
            requestAnimationFrame(() =>
              contentRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
            );
          }}
        >
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="space-y-2">
            <div ref={contentRef}>{detail}</div>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        line
      )}
    </Trace>
  );
}

export function ToolGroupRow({
  calls,
  labels,
  botName,
}: {
  calls: ChatToolCall[];
  labels: ToolLabelCatalog;
  botName: string;
}) {
  const text = groupText(calls, labels);
  return (
    <Trace data-testid="tool-group">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <ListChecks />
            </TraceIcon>
            <TraceTitle>{text.title}</TraceTitle>
            {text.failed !== undefined && (
              <TraceDescription className="text-destructive">{text.failed}</TraceDescription>
            )}
            {text.duration !== undefined && <TraceDescription>{text.duration}</TraceDescription>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="space-y-1">
          {calls.map((call, i) => (
            <ToolRow
              key={`${call.id}-${i}-${call.name}`}
              call={call}
              labels={labels}
              botName={botName}
            />
          ))}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
