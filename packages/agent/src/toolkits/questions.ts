import type { JsonValue } from "@earendil-works/chord/json";
import { Type } from "typebox";
import { defineDoc, type TaskId, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { z } from "zod";
import { innerDetails } from "../approvals";
import type { Capability } from "../capabilities";
import { parseStored, toJson } from "../durable-json";
import { defineToolkit, tool } from "../toolkit";
import { messageOwnerTool } from "./message-owner";
import type { ChatToolCall, OwnerAnswer, OwnerQuestion } from "../types";
import { MAX_ANSWER_TEXT } from "../wire";
import {
  pendingToolTask,
  refuseUnattended,
  sealedAsNotPending,
  unattendedOnce,
  waitForOwner,
  type HostTx,
  type WaitTracker,
} from "../waiting";

const ASK_OWNER = "ask_owner";

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 6;

const QuestionsDoc = defineDoc<{
  status: "pending" | "answered" | "dismissed";
  questions: JsonValue[];
  answers: JsonValue[];
}>({
  kind: "tiny.questions",
  version: 1,
  scope: "task",
  initial: () => ({ status: "pending", questions: [], answers: [] }),
  checkpointWhen: () => false,
});

export class QuestionNotPendingError extends Error {
  constructor(taskId: number) {
    super(`Tool call ${taskId} is not waiting for answers`);
    this.name = "QuestionNotPendingError";
  }
}

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

export interface QuestionView extends Pick<ChatToolCall, "questions" | "answers"> {
  pending: boolean;
}

const pendingDetails = (questions: OwnerQuestion[]) => ({
  question: "pending",
  questions: toJson(questions),
});

export function questionsOf(details: unknown): QuestionView {
  const value = innerDetails(details);
  if (!value || !Array.isArray(value.questions)) return { pending: false };
  return {
    pending: value.question === "pending",
    questions: value.questions as OwnerQuestion[],
    ...(Array.isArray(value.answers) ? { answers: value.answers as OwnerAnswer[] } : {}),
  };
}

export async function recordAnswers(
  tx: HostTx,
  conversation: number,
  taskId: number,
  answers: readonly OwnerAnswer[] | null,
): Promise<void> {
  const id = taskId as TaskId;
  const notPending = () => new QuestionNotPendingError(taskId);
  await pendingToolTask(tx, id, conversation, notPending);
  const doc = await tx.doc(QuestionsDoc, id);
  if (doc.status !== "pending" || doc.questions.length === 0) throw notPending();
  if (answers) {
    doc.answers = checkAnswers(storedQuestions(doc), answers).map(toJson);
    doc.status = "answered";
  } else {
    doc.status = "dismissed";
  }
}

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

const UNATTENDED =
  "Nobody can answer questions here: this is a scheduled routine run, not a chat with the owner. Continue on your best judgment, say which assumptions you made, and put any open question in your reply.";

export function createQuestionsCapability(tracker: WaitTracker): Capability {
  const askOwner = tool({
    name: ASK_OWNER,
    label: "Asked you questions",
    askLabel: "ask you questions",
    summary: "Ask you clarifying questions and wait for your answers",
    policy: { readOnly: true, chatOnly: true },
    description:
      "Ask the owner 1-4 clarifying questions and wait for their answers. Only when a wrong guess would waste real work or the decision is theirs (preferences, trade-offs). Not for what your tools can find out or you can sensibly assume, and not for permission to run a tool (tools ask for that themselves).",
    parameters: Type.Object({
      questions: Type.Array(questionSchema, { minItems: 1, maxItems: MAX_QUESTIONS }),
    }),
    replay: "safe",
    execute: async (args, api, context): Promise<ToolExecutionResult> => {
      if (await unattendedOnce(api, context, "questions:unattended")) {
        return refuseUnattended(UNATTENDED);
      }
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
