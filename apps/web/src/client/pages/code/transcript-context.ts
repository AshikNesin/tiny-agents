import type { RecoveryAction, RequestAnswer, ThreadSummary } from "../../lib/code/api";

export interface TranscriptActions {
  recovery: RecoveryAction[];
  recover(action: RecoveryAction): void;
  rewind?: { turns: ReadonlySet<string>; edit(id: string): void; retry(id: string): void };
  respond(requestId: string, answer: RequestAnswer): Promise<void>;
}

export interface TranscriptContext {
  instanceId: string;
  rows: ThreadSummary[];
}
