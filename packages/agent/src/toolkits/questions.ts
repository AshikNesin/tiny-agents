/**
 * Questions for the owner (human in the loop): `ask_owner` lets a bot ask one
 * to four clarifying questions mid-reply and wait for the answers, which come
 * back to the model as the tool's result.
 *
 * The wait is the approval gate's (`waiting.ts`): the call creates its
 * task-scoped `tiny.questions` document holding the questions, publishes
 * `{ question: "pending", questions }` details the chat renders the
 * questionnaire from, and resumes when the host records the owner's answers
 * or dismissal (`AgentRuntime.answerQuestions`) — also after a restart. The
 * runtime installs this capability itself, since it owns the document.
 * A conversation nobody watches (a routine's, issue #63) gets no wait: the
 * call returns at once and the model carries on without the answers.
 */
import type { JsonValue } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { defineDoc, type TaskId, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { z } from "zod";
import { innerDetails } from "../approvals";
import type { Capability } from "../capabilities";
import { parseStored, toJson } from "../durable-json";
import { defineToolkit, tool } from "../toolkit";
import { messageOwnerTool } from "./message-owner";
import type { ChatToolCall, OwnerAnswer, OwnerQuestion } from "../types";
import {
  pendingToolTask,
  sealedAsNotPending,
  waitForOwner,
  type HostTx,
  type WaitTracker,
} from "../waiting";

const ASK_OWNER = "ask_owner";

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 6;
/** Longest answer in the owner's own words. */
export const MAX_ANSWER_TEXT = 2_000;

/** One ask_owner call's questions and the owner's response, owned by its tool task. */
const QuestionsDoc = defineDoc<{
  status: "pending" | "answered" | "dismissed";
  /** The normalized questions: what the answers are checked against. */
  questions: JsonValue[];
  answers: JsonValue[];
}>({
  kind: "tiny.questions",
  version: 1,
  scope: "task",
  initial: () => ({ status: "pending", questions: [], answers: [] }),
  checkpointWhen: () => false,
});

/** The questions were already answered or dismissed, or their call ended. */
export class QuestionNotPendingError extends Error {
  constructor(taskId: number) {
    super(`Tool call ${taskId} is not waiting for answers`);
    this.name = "QuestionNotPendingError";
  }
}

/** The answers do not fit the questions they answer. */
export class InvalidAnswersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAnswersError";
  }
}

const ownerQuestions: z.ZodType<OwnerQuestion[]> = z.array(
  z.object({
    question: z.string(),
    description: z.string().optional(),
    options: z
      .array(z.object({ label: z.string(), description: z.string().optional() }))
      .optional(),
    multiple: z.boolean().optional(),
  }),
);

const ownerAnswers: z.ZodType<OwnerAnswer[]> = z.array(
  z.object({ selected: z.array(z.string()), text: z.string().optional() }),
);

const storedQuestions = (doc: { questions: JsonValue[] }) =>
  parseStored("tiny.questions.questions", doc.questions, ownerQuestions);

// ── The card's details: one shape, produced and parsed here ─────────────

/** An `ask_owner` call as the chat reads it off the call's details. */
export interface QuestionView extends Pick<ChatToolCall, "questions" | "answers"> {
  pending: boolean;
}

const pendingDetails = (questions: OwnerQuestion[]) => ({
  question: "pending",
  questions: toJson(questions),
});

/** The questions (and answers) of an `ask_owner` call's details; `pending` while it waits. */
export function questionsOf(details: unknown): QuestionView {
  const value = innerDetails(details);
  if (!value || !Array.isArray(value.questions)) return { pending: false };
  return {
    pending: value.question === "pending",
    questions: value.questions as OwnerQuestion[],
    ...(Array.isArray(value.answers) ? { answers: value.answers as OwnerAnswer[] } : {}),
  };
}

// ── Host side: the owner's answers ──────────────────────────────────────

/**
 * Record the owner's answers (or a dismissal with `null`) on a waiting
 * `ask_owner` call, in the host's transaction. Throws
 * `QuestionNotPendingError` for a call that is not waiting on questions
 * (another tool's call, already answered, ended) and `InvalidAnswersError`
 * when the answers do not fit.
 */
export async function recordAnswers(
  tx: HostTx,
  conversation: number,
  taskId: number,
  answers: readonly OwnerAnswer[] | null,
): Promise<void> {
  const id = taskId as TaskId;
  const notPending = () => new QuestionNotPendingError(taskId);
  await pendingToolTask(tx, id, conversation, notPending);
  // Another tool's task has no questions (and the throw rolls back the
  // document this read would create).
  const doc = await tx.doc(QuestionsDoc, id);
  if (doc.status !== "pending" || doc.questions.length === 0) throw notPending();
  if (answers) {
    doc.answers = checkAnswers(storedQuestions(doc), answers).map(toJson);
    doc.status = "answered";
  } else {
    doc.status = "dismissed";
  }
}

/** Map a sealed-document error (the call ended) to `QuestionNotPendingError`; rethrow the rest. */
export function questionNotPending(error: unknown, taskId: number): never {
  if (error instanceof QuestionNotPendingError || error instanceof InvalidAnswersError) {
    throw error;
  }
  return sealedAsNotPending(error, () => new QuestionNotPendingError(taskId));
}

const optionSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 100, description: "Short answer, 1-5 words" }),
  description: Type.Optional(
    Type.String({ maxLength: 200, description: "What picking this answer means" }),
  ),
});

const questionSchema = Type.Object({
  question: Type.String({
    minLength: 1,
    maxLength: 300,
    description: "One clear question, ending with a question mark",
  }),
  description: Type.Optional(
    Type.String({ maxLength: 500, description: "Context shown under the question" }),
  ),
  options: Type.Optional(
    Type.Array(optionSchema, {
      minItems: 2,
      maxItems: MAX_OPTIONS,
      description: "Likely answers; the owner can still write their own. Omit for open questions.",
    }),
  ),
  multiple: Type.Optional(
    Type.Boolean({ description: "Let the owner pick several options (default: one)" }),
  ),
});

/** Trimmed, without empty fields or repeated options. */
function normalizeQuestions(questions: readonly OwnerQuestion[]): OwnerQuestion[] {
  return questions.map((input) => {
    const seen = new Set<string>();
    const options: NonNullable<OwnerQuestion["options"]> = [];
    for (const option of input.options ?? []) {
      const label = option.label.trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      const description = option.description?.trim();
      options.push(description ? { label, description } : { label });
    }
    const description = input.description?.trim();
    return {
      question: input.question.trim(),
      ...(description ? { description } : {}),
      ...(options.length > 0 ? { options } : {}),
      ...(options.length > 0 && input.multiple ? { multiple: true } : {}),
    };
  });
}

/**
 * The owner's answers checked against the questions, normalized: one answer
 * per question, picks among its options (at most one unless `multiple`), own
 * words trimmed and bounded.
 */
function checkAnswers(questions: readonly OwnerQuestion[], answers: readonly OwnerAnswer[]) {
  if (answers.length !== questions.length) {
    throw new InvalidAnswersError(`Expected ${questions.length} answer(s), got ${answers.length}`);
  }
  return answers.map((answer, index): OwnerAnswer => {
    const question = questions[index];
    const labels = new Set(question.options?.map((option) => option.label));
    const selected = [...new Set(answer.selected)];
    const unknown = selected.find((label) => !labels.has(label));
    if (unknown !== undefined) {
      throw new InvalidAnswersError(`"${unknown}" is not an option of question ${index + 1}`);
    }
    if (selected.length > 1 && !question.multiple) {
      throw new InvalidAnswersError(`Question ${index + 1} takes one option`);
    }
    const text = answer.text?.trim();
    if (text && text.length > MAX_ANSWER_TEXT) {
      throw new InvalidAnswersError(`Answer ${index + 1} is too long`);
    }
    return text ? { selected, text } : { selected };
  });
}

/** The answers as the model reads them. */
function formatAnswers(questions: readonly OwnerQuestion[], answers: readonly OwnerAnswer[]) {
  const lines = questions.map((question, index) => {
    const { selected, text } = answers[index];
    const parts = [...selected];
    if (text) parts.push(selected.length > 0 ? `Other: ${text}` : text);
    return `Q: ${question.question}\nA: ${parts.length > 0 ? parts.join("; ") : "(skipped)"}`;
  });
  return `The owner answered your questions:\n\n${lines.join("\n\n")}`;
}

const DISMISSED =
  "The owner dismissed these questions without answering (a message from them may follow). Don't ask them again: go by their message, or continue on your best judgment and say which assumptions you made.";

export function createQuestionsCapability(tracker: WaitTracker): Capability {
  const askOwner = tool({
    name: ASK_OWNER,
    label: "Asked you questions",
    askLabel: "ask you questions",
    summary: "Ask you clarifying questions and wait for your answers",
    // Nobody can answer in a routine run or a bot message's conversation.
    policy: { readOnly: true, chatOnly: true },
    description:
      "Ask the owner 1-4 clarifying questions and wait for their answers. Only when a wrong guess would waste real work or the decision is theirs (preferences, trade-offs). Not for what your tools can find out or you can sensibly assume, and not for permission to run a tool (tools ask for that themselves).",
    parameters: Type.Object({
      questions: Type.Array(questionSchema, { minItems: 1, maxItems: MAX_QUESTIONS }),
    }),
    // Re-running only re-attaches to the call's document (waitForOwner).
    replay: "safe",
    execute: async (args, api, context): Promise<ToolExecutionResult> => {
      const asked = normalizeQuestions(args.questions);
      const doc = await waitForOwner(
        api,
        tracker,
        QuestionsDoc,
        pendingDetails(asked),
        context,
        (value) => {
          if (value.questions.length === 0) value.questions = asked.map(toJson);
        },
        { tool: ASK_OWNER, preview: asked[0]?.question },
      );
      const questions = storedQuestions(doc);
      if (doc.status === "dismissed") {
        return {
          output: [{ type: "text", text: DISMISSED }],
          details: { question: "dismissed", questions: toJson(questions) },
        };
      }
      const answers = parseStored("tiny.questions.answers", doc.answers, ownerAnswers);
      return {
        output: [{ type: "text", text: formatAnswers(questions, answers) }],
        details: { question: "answered", questions: toJson(questions), answers: toJson(answers) },
      };
    },
  });

  return defineToolkit({
    id: "questions",
    name: "Questions",
    description: "Asks you clarifying questions mid-reply, and messages you",
    tools: [askOwner, messageOwnerTool],
  });
}
