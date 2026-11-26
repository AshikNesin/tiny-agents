import { useState } from "react";
import { Hand, KeyRound } from "lucide-react";
import { Button } from "@groot/ui/button";
import type { ChatToolCall } from "../../lib/chat-types";
import {
  approvalText,
  credentialRequestText,
  vaultApprovalText,
  type ToolLabelCatalog,
} from "../../lib/tool-call-text";
import { type OwnerActions, showComputerPanel, useOwnerDecision } from "../../lib/owner-actions";
import { useCredentialRequest } from "../../queries/vault";
import { CredentialRequestForm } from "../vault/CredentialRequestForm";
import { StepUpProvider } from "../vault/StepUp";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "../ui/item";

export function ApprovalCard({
  call,
  labels,
  actions,
  botName,
}: {
  call: ChatToolCall & { taskId: number };
  labels: ToolLabelCatalog;
  actions: OwnerActions;
  botName: string;
}) {
  const { busy, run } = useOwnerDecision("Failed to answer");
  const [showFull, setShowFull] = useState(false);
  const decide = (decision: "approved" | "denied", alwaysAllow?: string, everyBot?: boolean) =>
    run(() =>
      actions.decideApproval(call.taskId, decision, {
        alwaysAllow,
        ...(everyBot ? { everyBot } : {}),
      }),
    );
  const text = approvalText(call, botName, labels);
  return (
    <Item className="border-primary/40 bg-primary/5 my-1 max-w-lg">
      <ItemContent>
        <ItemTitle>{text.title}</ItemTitle>
        {text.facts && (
          <dl className="space-y-0.5 text-xs">
            {text.facts.map((fact) => (
              <div key={fact.label} className="flex gap-1.5">
                <dt className="text-muted-foreground shrink-0">{fact.label}</dt>
                <dd className="min-w-0 break-words whitespace-pre-wrap">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {text.foldedPayload !== undefined ? (
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setShowFull((v) => !v)}
              className="text-muted-foreground hover:text-foreground text-xs font-medium underline underline-offset-4"
              aria-expanded={showFull}
            >
              {showFull ? "Read less" : "Read more"}
            </button>
            {showFull && (
              <pre className="bg-muted max-h-64 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
                {text.foldedPayload}
              </pre>
            )}
          </div>
        ) : null}
        <ItemDescription>Nothing runs until you answer.</ItemDescription>
      </ItemContent>
      <ItemActions className="flex flex-col items-stretch gap-1.5">
        <Button size="xs" disabled={busy} onClick={() => decide("denied")}>
          Deny
        </Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => decide("approved")}>
          Approve
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => decide("approved", call.name)}
          title={text.alwaysAllowHint}
        >
          Always allow
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => decide("approved", call.name, true)}
          title={text.allowEveryBotHint}
        >
          Allow for every bot
        </Button>
      </ItemActions>
    </Item>
  );
}

export function VaultApprovalCard({
  call,
  actions,
  botName,
}: {
  call: ChatToolCall & { taskId: number; vault: NonNullable<ChatToolCall["vault"]> };
  actions: OwnerActions;
  botName: string;
}) {
  const { busy, run } = useOwnerDecision("Failed to answer");
  const decide = (decision: "approved" | "denied", grant?: boolean) =>
    run(() => actions.decideApproval(call.taskId, decision, { grant }));
  const text = vaultApprovalText(call, botName);
  return (
    <Item className="border-primary/40 bg-primary/5 my-1 max-w-lg">
      <ItemContent>
        <ItemTitle>
          <KeyRound className="size-4" />
          {text.title}
        </ItemTitle>
        {text.command !== undefined && (
          <pre className="bg-muted max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
            {text.command}
          </pre>
        )}
        <ItemDescription>{text.description}</ItemDescription>
      </ItemContent>
      <ItemActions className="flex flex-col items-stretch gap-1.5">
        <Button size="xs" disabled={busy} onClick={() => decide("denied")}>
          Deny
        </Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => decide("approved")}>
          Approve once
        </Button>
        {call.vault.grantable && (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => decide("approved", true)}
            title={text.grantHint}
          >
            For this chat
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}

export function CredentialRequestCard({
  call,
  botName,
}: {
  call: ChatToolCall & {
    taskId: number;
    credentials: NonNullable<ChatToolCall["credentials"]>;
  };
  botName: string;
}) {
  const text = credentialRequestText(call, botName);
  const { data: request, loadError } = useCredentialRequest(call.taskId);
  return (
    <Item className="border-primary/40 bg-primary/5 my-1 max-w-lg" data-testid="credential-card">
      <ItemContent className="gap-3">
        <ItemTitle>
          <KeyRound className="size-4" />
          {text.title}
        </ItemTitle>
        <ItemDescription>{call.credentials.purpose}</ItemDescription>
        {request ? (
          <StepUpProvider>
            <CredentialRequestForm taskId={call.taskId} request={request} />
          </StepUpProvider>
        ) : (
          <ItemDescription>{loadError ?? "Loading…"}</ItemDescription>
        )}
      </ItemContent>
    </Item>
  );
}

export function TakeoverCard({
  call,
  actions,
  botName,
}: {
  call: ChatToolCall & { takeover: NonNullable<ChatToolCall["takeover"]> };
  actions: OwnerActions;
  botName: string;
}) {
  const { busy, run } = useOwnerDecision("Failed to hand the computer back", { settle: false });
  return (
    <Item className="border-primary/40 bg-primary/5 my-1 max-w-lg" data-testid="takeover-card">
      <ItemContent>
        <ItemTitle>
          <Hand className="size-4" />
          {botName} needs you on the computer
        </ItemTitle>
        <ItemDescription>
          {call.takeover.reason} You have control; {botName} waits and takes no screenshots until
          you are done.
        </ItemDescription>
      </ItemContent>
      <ItemActions className="flex flex-col items-stretch gap-1.5">
        <Button size="xs" onClick={showComputerPanel}>
          Open computer
        </Button>
        {actions.handBackComputer && (
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => actions.handBackComputer!())}
          >
            I'm done
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}
