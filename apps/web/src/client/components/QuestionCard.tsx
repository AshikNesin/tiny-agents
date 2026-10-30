import { useMemo, useState, type FormEvent } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Questionnaire } from "@shadcn/react/questionnaire";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { toast } from "sonner";
import { botsApi } from "../lib/bots-api";
import type { ChatToolCall, OwnerAnswer, OwnerQuestion } from "../lib/chat-types";
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
import { errorMessage } from "../lib/errors";

/** Mirrors the agent package's MAX_ANSWER_TEXT (the server rejects longer answers). */
const MAX_ANSWER_TEXT = 2_000;

const itemName = (index: number) => `q${index}`;

function countText(questions: readonly OwnerQuestion[]): string {
  return questions.length === 1 ? "a question" : `${questions.length} questions`;
}

/**
 * One answer per question from the questionnaire's form data: values that
 * are option labels were picked, anything else came from the "Other" field.
 * Skipped questions submit nothing, so their answer is empty.
 */
export function readAnswers(form: FormData, questions: readonly OwnerQuestion[]): OwnerAnswer[] {
  return questions.map((question, index) => {
    const labels = new Set(question.options?.map((option) => option.label));
    const values = form.getAll(itemName(index)).map(String);
    const selected = values.filter((value) => labels.has(value));
    const text = values
      .filter((value) => !labels.has(value))
      .join("\n")
      .trim();
    return text ? { selected, text } : { selected };
  });
}

/**
 * A bot's questions for the owner (ask_owner), as a shadcn Questionnaire: one
 * question per step, its options as radios (checkboxes when it takes
 * several), an "Other" field for an answer in the owner's own words, and Skip
 * for a question they'd rather not answer. The bot's reply waits on the
 * answers; Dismiss, or writing in the chat, lets it go on without them.
 */
export function QuestionCard({
  call,
  botId,
  botName,
}: {
  call: ChatToolCall & { taskId: number; questions: OwnerQuestion[] };
  botId: string;
  botName: string;
}) {
  const { questions } = call;
  const [busy, setBusy] = useState(false);
  // Shortcut keys follow the declared option order.
  const items = useMemo(
    () =>
      questions.map((question, index) => ({
        name: itemName(index),
        choices: question.options?.map((option) => ({ value: option.label })),
      })),
    [questions],
  );

  const respond = async (answers: OwnerAnswer[] | null) => {
    if (busy) return;
    setBusy(true);
    try {
      await botsApi.answerQuestions(botId, call.taskId, answers);
      // Stay disabled: the stream replaces this card with the answered row.
    } catch (error) {
      toast.error(errorMessage(error, "Failed to send your answers"));
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void respond(readAnswers(new FormData(event.currentTarget), questions));
  };

  return (
    <Questionnaire.Root
      items={items}
      shortcuts="numbers"
      onSubmit={submit}
      aria-label={`Questions from ${botName}`}
      data-testid="question-card"
      className="border-primary/40 bg-primary/5 my-1 flex max-w-lg flex-col gap-3 rounded-lg border p-3"
    >
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="text-primary size-3.5 shrink-0" aria-hidden />
        <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
          {botName} has {countText(questions)} for you
        </p>
        {questions.length > 1 && (
          <Questionnaire.Progress className="text-muted-foreground shrink-0 text-xs tabular-nums" />
        )}
      </div>

      {questions.map((question, index) => (
        <Questionnaire.Item
          key={itemName(index)}
          name={itemName(index)}
          multiple={question.multiple}
          className="min-w-0 outline-none"
        >
          <Questionnaire.Title className="text-sm leading-snug font-medium">
            {question.question}
          </Questionnaire.Title>
          {question.description && (
            <Questionnaire.Description className="text-muted-foreground mt-0.5 text-xs">
              {question.description}
            </Questionnaire.Description>
          )}
          <Questionnaire.Choices className="mt-2.5 flex flex-col gap-1.5">
            {question.options?.map((option) => (
              <Questionnaire.Choice
                key={option.label}
                value={option.label}
                className="border-border hover:bg-muted data-checked:border-primary/60 data-checked:bg-primary/10 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <Questionnaire.ChoiceInput className="accent-primary mt-0.5 size-4 shrink-0 outline-none" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <Questionnaire.ChoiceLabel className="text-sm">
                    {option.label}
                  </Questionnaire.ChoiceLabel>
                  {option.description && (
                    <span className="text-muted-foreground text-xs">{option.description}</span>
                  )}
                </span>
                <Questionnaire.ChoiceShortcut className="text-muted-foreground rounded-md border px-1.5 text-xs tabular-nums pointer-coarse:hidden" />
              </Questionnaire.Choice>
            ))}
            {/* Dimmed while another option is picked: only the picked answer is sent. */}
            <Questionnaire.Input
              render={<Input className="h-9 [&[data-filled]:not([name])]:opacity-50" />}
              aria-label={
                question.options ? `Other answer to: ${question.question}` : question.question
              }
              placeholder={question.options ? "Other…" : "Your answer"}
              maxLength={MAX_ANSWER_TEXT}
            />
          </Questionnaire.Choices>
          <Questionnaire.Error className="text-destructive mt-1.5 text-xs" />
        </Questionnaire.Item>
      ))}

      <div className="flex flex-wrap items-center gap-1.5">
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
        <span className="grow" />
        <Questionnaire.Previous render={<Button size="xs" variant="ghost" />}>
          Back
        </Questionnaire.Previous>
        <Questionnaire.Skip render={<Button size="xs" variant="outline" disabled={busy} />} />
        <Questionnaire.Next render={<Button size="xs" />} />
        <Questionnaire.Submit render={<Button size="xs" disabled={busy} />}>
          {busy ? "Sending…" : "Send answers"}
        </Questionnaire.Submit>
      </div>
      <p className="text-muted-foreground text-xs">Or reply in the chat to skip these questions.</p>
    </Questionnaire.Root>
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
