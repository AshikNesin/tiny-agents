import { record } from "@tiny-agents/std";
import { CodingError } from "./coding-error";
import type { CodingAnswer, CodingApproval, CodingEvent } from "./coding-protocol";
import type { CodingCanUseTool, CodingPermissionResult } from "./coding-sdk";

export type ApprovalStatus = "allowed" | "denied" | "answered" | "expired";

export interface PendingApproval {
  approval: CodingApproval;
  settle: (result: CodingPermissionResult, status: ApprovalStatus) => void;
}

export class CodingApprovals {
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly closedApprovals = new Map<string, ApprovalStatus>();

  constructor(private readonly publish: (event: CodingEvent) => void) {}

  get size(): number {
    return this.approvals.size;
  }

  get(id: string): PendingApproval | undefined {
    return this.approvals.get(id);
  }

  wasClosed(id: string): boolean {
    return this.closedApprovals.has(id);
  }

  open(approval: CodingApproval, signal: AbortSignal): Promise<CodingPermissionResult> {
    const { approvalId } = approval;
    return new Promise<CodingPermissionResult>((resolve) => {
      this.approvals.set(approvalId, {
        approval,
        settle: (result) => resolve(result),
      });
      this.publish({ type: "request", approval });
      signal.addEventListener(
        "abort",
        () =>
          this.close(
            approvalId,
            { behavior: "deny", message: "The request was cancelled.", interrupt: true },
            "expired",
          ),
        { once: true },
      );
    });
  }

  close(id: string, result: CodingPermissionResult, status: ApprovalStatus): void {
    const pending = this.approvals.get(id);
    if (!pending) return;
    this.approvals.delete(id);
    this.closedApprovals.set(id, status);
    if (this.closedApprovals.size > 500) {
      const oldest = this.closedApprovals.keys().next().value;
      if (oldest) this.closedApprovals.delete(oldest);
    }
    pending.settle(result, status);
    this.publish({ type: "request_closed", approvalId: id, status });
  }

  respond(approvalId: string, answer: CodingAnswer): void {
    const pending = this.approvals.get(approvalId);
    if (!pending) {
      if (this.closedApprovals.has(approvalId)) return;
      throw new CodingError("not_found", "That request is no longer open.");
    }
    const { approval } = pending;
    const input = record(approval.input) ?? {};
    const isQuestion = approval.toolName === "AskUserQuestion";
    if ("answers" in answer) {
      if (!isQuestion) throw new CodingError("bad_answer", "A tool approval takes allow or deny.");
      this.close(
        approvalId,
        {
          behavior: "allow",
          updatedInput: { ...input, answers: questionAnswers(input, answer.answers) },
        },
        "answered",
      );
      return;
    }
    if (answer.decision === "allow") {
      if (isQuestion) throw new CodingError("bad_answer", "A question takes answers.");
      this.close(approvalId, { behavior: "allow", updatedInput: input }, "allowed");
      return;
    }
    const message =
      answer.message?.trim() ||
      (isQuestion ? "The user dismissed the question." : "The user declined this tool call.");
    this.close(approvalId, { behavior: "deny", message }, "denied");
  }

  closeAll(result: CodingPermissionResult, status: ApprovalStatus): void {
    for (const id of this.approvals.keys()) this.close(id, result, status);
  }
}

export function questionAnswers(
  input: Record<string, unknown>,
  answers: Record<string, string>,
): Record<string, string> {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const out: Record<string, string> = {};
  questions.forEach((raw, index) => {
    const question = record(raw);
    const text = typeof question?.question === "string" ? question.question : undefined;
    if (!text) return;
    const header = typeof question?.header === "string" ? question.header : undefined;
    const value = answers[text] ?? (header ? answers[header] : undefined) ?? answers[String(index)];
    if (value !== undefined) out[text] = value;
  });
  return out;
}

export function approvalOf(
  approvalId: string,
  toolName: string,
  input: Record<string, unknown>,
  options: Parameters<CodingCanUseTool>[2],
): CodingApproval {
  return {
    approvalId,
    toolName,
    input,
    ...(options.toolUseID ? { toolUseId: options.toolUseID } : {}),
    ...(options.suggestions?.length ? { suggestions: options.suggestions } : {}),
    ...(options.decisionReason ? { reason: options.decisionReason } : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(options.blockedPath ? { blockedPath: options.blockedPath } : {}),
    ...(options.agentID ? { agentId: options.agentID } : {}),
  };
}
