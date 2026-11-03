import { useMemo } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Button } from "@groot/ui/button";
import { cn } from "@groot/ui/lib/utils";
import type { ChatToolCall, OwnerAnswer, OwnerQuestion } from "../lib/chat-types";
import { type OwnerActions, useOwnerDecision } from "../lib/owner-actions";
import {
  AskUserQuestions,
  type AskUserAnswer,
  type AskUserQuestion,
} from "./fluid/ask-user-questions";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "./ui/trace";

/** Mirrors the agent package's MAX_ANSWER_TEXT (the server rejects longer answers). */
const MAX_ANSWER_TEXT = 2_000;

const questionId = (index: number) => `q${index}`;
const optionId = (index: number) => `o${index}`;

function countText(questions: readonly OwnerQuestion[]): string {
  return questions.length === 1 ? "a question" : `${questions.length} questions`;
}

/**
 * The owner's questions in the Fluid AskUserQuestions shape: options become
 * rows (checkboxes when the question takes several) with an Other row for an
 * answer in the owner's own words; a question without options is one open
 * text field. The last question's submit button sends the answers.
 */
export function toAskUserQuestions(questions: readonly OwnerQuestion[]): AskUserQuestion[] {
  return questions.map((question, index) => {
    const last = index === questions.length - 1;
    const base = {
      id: questionId(index),
      title: question.question,
      description: question.description,
      maxLength: MAX_ANSWER_TEXT,
      nextLabel: last ? "Send answers" : "Next",
    };
    if (!question.options?.length) {
      return { ...base, freeText: true, freeTextPlaceholder: "Your answer…" };
    }
    return {
      ...base,
      multiSelect: question.multiple,
      allowOther: true,
      otherPlaceholder: "Something else…",
      otherLabel: `Other answer to: ${question.question}`,
      options: question.options.map((option, optionIndex) => ({
        id: optionId(optionIndex),
        title: option.label,
        description: option.description,
      })),
    };
  });
}

/**
 * One answer per question from the questionnaire's answers: the picked
 * options' labels, and the Other / open field's text. Skipped (or never
 * reached) questions answer with nothing.
 */
export function toOwnerAnswers(
  answers: Record<string, AskUserAnswer>,
  questions: readonly OwnerQuestion[],
): OwnerAnswer[] {
  return questions.map((question, index) => {
    const answer = answers[questionId(index)];
    if (!answer || answer.skipped) return { selected: [] };
    const options = question.options ?? [];
    const selected = options
      .filter((_, optionIndex) => answer.selectedIds.includes(optionId(optionIndex)))
      .map((option) => option.label);
    const text = answer.otherText?.trim();
    return text ? { selected, text } : { selected };
  });
}

/**
 * A bot's questions for the owner (ask_owner), as a Fluid Functionalism
 * AskUserQuestions card: one question per step, a single-choice question
 * answers on a click (or its number key), a multiple-choice one with Next,
 * and Skip for a question they'd rather not answer. The bot's reply waits on
 * the answers; Dismiss, or writing in the chat, lets it go on without them.
 */
export function QuestionCard({
  call,
  actions,
  botName,
}: {
  call: ChatToolCall & { taskId: number; questions: OwnerQuestion[] };
  actions: OwnerActions;
  botName: string;
}) {
  const { questions } = call;
  // Stay disabled after answering: the stream replaces this card with the answered row.
  const { busy, run } = useOwnerDecision("Failed to send your answers", { settle: false });
  const items = useMemo(() => toAskUserQuestions(questions), [questions]);

  const respond = (answers: OwnerAnswer[] | null) =>
    run(() => actions.answerQuestions(call.taskId, answers));

  return (
    <div
      role="group"
      aria-label={`Questions from ${botName}`}
      aria-busy={busy || undefined}
      data-testid="question-card"
      className="my-1 flex w-full max-w-lg min-w-0 flex-col gap-1.5"
    >
      <AskUserQuestions
        questions={items}
        onComplete={(answers) => void respond(toOwnerAnswers(answers, questions))}
        className={cn("max-w-none", busy && "pointer-events-none opacity-60")}
        heading={
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <MessageCircleQuestion className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {busy ? "Sending your answers…" : `${botName} has ${countText(questions)} for you`}
            </span>
          </span>
        }
        headerAction={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => void respond(null)}
            title="Let the bot go on without your answers"
          >
            Dismiss
          </Button>
        }
      />
      <p className="text-muted-foreground px-1 text-xs">
        Or reply in the chat to skip these questions.
      </p>
    </div>
  );
}

function answerText(answer: OwnerAnswer | undefined): string {
  if (!answer) return "—";
  const parts = [...answer.selected];
  if (answer.text) parts.push(answer.selected.length > 0 ? `Other: ${answer.text}` : answer.text);
  return parts.length > 0 ? parts.join(", ") : "Skipped";
}

/**
 * A finished ask_owner call: one trace step ("Asked you 2 questions") that
 * expands to each question and the owner's answer; `note` says how it ended
 * when not with answers.
 */
export function AskedQuestions({ call, note }: { call: ChatToolCall; note?: string }) {
  const questions = call.questions ?? [];
  return (
    <Trace className="gap-1">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={call.status === "done" ? undefined : "error"}>
            <TraceIcon>
              <MessageCircleQuestion />
            </TraceIcon>
            <TraceTitle>Asked you {countText(questions)}</TraceTitle>
            {note && <TraceDescription>{note}</TraceDescription>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <dl className="flex flex-col gap-2 pt-1 text-sm">
            {questions.map((question, index) => (
              <div key={index} className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground">{question.question}</dt>
                <dd className="wrap-break-word whitespace-pre-wrap">
                  {answerText(call.answers?.[index])}
                </dd>
              </div>
            ))}
          </dl>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
