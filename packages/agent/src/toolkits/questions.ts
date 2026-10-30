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
import {
  defineDoc,
  defineExtension,
  defineTool,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import { isUnattendedConversation } from "../approvals";
import type { Capability } from "../capabilities";
import type { OwnerAnswer, OwnerQuestion } from "../types";
import { waitForOwner, type WaitTracker } from "../waiting";

export const ASK_OWNER = "ask_owner";

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 6;
/** Longest answer in the owner's own words. */
export const MAX_ANSWER_TEXT = 2_000;

/** One ask_owner call's questions and the owner's response, owned by its tool task. */
export const QuestionsDoc = defineDoc<{
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

/** The answers do not fit the questions they answer. */
export class InvalidAnswersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAnswersError";
  }
}

// Normalized questions and answers never carry undefined fields, so they are
// JSON as they are; the document and the details store them as such.
const toJson = (value: OwnerQuestion[] | OwnerAnswer[]) => value as unknown as JsonValue[];
export const storedQuestions = (doc: { questions: JsonValue[] }) =>
  doc.questions as unknown as OwnerQuestion[];

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
      description:
        "Likely answers to pick from. The owner can always answer in their own words instead. Omit for open questions.",
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
export function checkAnswers(questions: readonly OwnerQuestion[], answers: readonly OwnerAnswer[]) {
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

const UNATTENDED =
  "Nobody can answer questions here: this is a scheduled routine run, not a chat with the owner. Continue on your best judgment, say which assumptions you made, and put any open question in your reply.";

const DISMISSED =
  "The owner dismissed these questions without answering (a message from them may follow). Don't ask them again: go by their message, or continue on your best judgment and say which assumptions you made.";

export function createQuestionsCapability(tracker: WaitTracker): Capability {
  const askOwner = defineTool({
    name: ASK_OWNER,
    description:
      "Ask the owner 1-4 clarifying questions and wait for their answers. Use it when a request is ambiguous and a wrong guess would waste real work, or when a decision is the owner's to make (preferences, trade-offs, details you cannot look up). Don't ask what your other tools can find out or what you can sensibly assume, and don't ask permission to run a tool (tools that need approval ask for it themselves). Your reply pauses until the owner answers.",
    parameters: Type.Object({
      questions: Type.Array(questionSchema, { minItems: 1, maxItems: MAX_QUESTIONS }),
    }),
    // Re-running only re-attaches to the call's document (waitForOwner).
    replay: "safe",
    execute: async (args, api, context): Promise<ToolExecutionResult> => {
      // Decided once per call, so a replay never starts waiting after all.
      if (
        await api.memo(
          "questions:unattended",
          await isUnattendedConversation(api, context),
          context,
        )
      ) {
        return { output: [{ type: "text", text: UNATTENDED }], isError: true };
      }
      const asked = normalizeQuestions(args.questions);
      const doc = await waitForOwner(
        api,
        tracker,
        QuestionsDoc,
        { question: "pending", questions: toJson(asked) },
        context,
        (value) => {
          if (value.questions.length === 0) value.questions = toJson(asked);
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
      const answers = doc.answers as unknown as OwnerAnswer[];
      return {
        output: [{ type: "text", text: formatAnswers(questions, answers) }],
        details: { question: "answered", questions: toJson(questions), answers: toJson(answers) },
      };
    },
  });

  return {
    id: "questions",
    kind: "toolkit",
    name: "Questions",
    description: "Asks you clarifying questions mid-reply",
    extension: defineExtension({ name: "questions", tools: [askOwner] }),
    tools: [
      {
        name: ASK_OWNER,
        label: "Asked you questions",
        askLabel: "ask you questions",
        description: "Ask you clarifying questions and wait for your answers",
        readOnly: true,
      },
    ],
  };
}
