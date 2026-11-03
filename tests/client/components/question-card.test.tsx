/**
 * @vitest-environment jsdom
 *
 * A bot's questions for the owner (ask_owner): the questionnaire card while
 * the call waits, and the asked-and-answered row once it ends.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ChatMessageView } from "@/components/ChatMessageView";
import { toOwnerAnswers } from "@/components/QuestionCard";
import type { ChatMessage, ChatToolCall, OwnerQuestion } from "@/lib/chat-types";
import { OwnerActionsProvider, type OwnerActions } from "@/lib/owner-actions";

// A recording fake: the card acts only through the owner actions in scope.
const answerQuestions = vi.fn();
const actions: OwnerActions = {
  decideApproval: vi.fn(),
  answerQuestions: (...args) => answerQuestions(...args),
};
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const QUESTIONS: OwnerQuestion[] = [
  { question: "Which database?", options: [{ label: "Postgres" }, { label: "SQLite" }] },
  {
    question: "Which features?",
    description: "Pick any",
    options: [{ label: "Auth" }, { label: "Billing", description: "Stripe" }],
    multiple: true,
  },
  { question: "When is it due?" },
];

function view(call: Partial<ChatToolCall>) {
  const message: ChatMessage = {
    id: "m1",
    role: "assistant",
    text: "",
    status: call.status === "awaiting_answer" ? "streaming" : "done",
    createdAt: 0,
    toolCalls: [
      {
        id: "c1",
        name: "ask_owner",
        args: { questions: QUESTIONS },
        status: "awaiting_answer",
        taskId: 42,
        questions: QUESTIONS,
        ...call,
      },
    ],
  };
  return render(
    <OwnerActionsProvider actions={actions}>
      <ChatMessageView message={message} botName="Chief" />
    </OwnerActionsProvider>,
  );
}

describe("QuestionCard", () => {
  const user = userEvent.setup();
  beforeEach(() => {
    answerQuestions.mockReset();
    answerQuestions.mockResolvedValue({ answered: true });
  });

  it("steps through the questions and sends one answer per question", async () => {
    view({});
    expect(screen.getByText("Chief has 3 questions for you")).toBeInTheDocument();
    expect(screen.getByText("Question 1 of 3")).toBeInTheDocument();
    // No typing dots while the bot waits on the owner.
    expect(screen.queryByTestId("typing-indicator")).not.toBeInTheDocument();

    // A single-choice question answers on the click.
    await user.click(screen.getByRole("radio", { name: /Postgres/ }));
    expect(await screen.findByText("Question 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Pick any")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Auth/ }));
    await user.click(screen.getByRole("checkbox", { name: /Billing/ }));
    await user.type(
      screen.getByRole("textbox", { name: /Other answer to: Which features/ }),
      "CSV",
    );
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.type(await screen.findByRole("textbox", { name: "When is it due?" }), "Friday");
    await user.click(screen.getByRole("button", { name: /Send answers/ }));

    await waitFor(() =>
      expect(answerQuestions).toHaveBeenCalledWith(42, [
        { selected: ["Postgres"] },
        { selected: ["Auth", "Billing"], text: "CSV" },
        { selected: [], text: "Friday" },
      ]),
    );
  });

  it("an answer in the owner's own words replaces a picked option", async () => {
    view({});
    await user.type(
      screen.getByRole("textbox", { name: /Other answer to: Which database/ }),
      "DuckDB{Enter}",
    );
    expect(await screen.findByText("Question 2 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Back/ }));
    await user.click(await screen.findByRole("radio", { name: /SQLite/ }));
    await user.click(await screen.findByRole("button", { name: /Skip/ }));
    await user.click(await screen.findByRole("button", { name: /Skip/ }));
    await waitFor(() =>
      expect(answerQuestions).toHaveBeenCalledWith(42, [
        { selected: ["SQLite"] },
        { selected: [] },
        { selected: [] },
      ]),
    );
  });

  it("Skip leaves an empty answer, and Next waits for one", async () => {
    view({});
    await user.click(screen.getByRole("button", { name: /Skip/ }));
    expect(await screen.findByRole("button", { name: /Next/ })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Auth/ }));
    await user.click(screen.getByRole("button", { name: /Next/ }));
    // Skipping the last question sends the answers.
    await user.click(await screen.findByRole("button", { name: /Skip/ }));
    await waitFor(() =>
      expect(answerQuestions).toHaveBeenCalledWith(42, [
        { selected: [] },
        { selected: ["Auth"] },
        { selected: [] },
      ]),
    );
  });

  it("dismisses the questions", async () => {
    view({});
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(answerQuestions).toHaveBeenCalledWith(42, null);
  });

  it("maps the questionnaire's answers to labels and text", () => {
    expect(
      toOwnerAnswers(
        {
          q0: { questionId: "q0", selectedIds: [], otherText: " Something else " },
          q1: { questionId: "q1", selectedIds: ["o1"] },
          q2: { questionId: "q2", selectedIds: [], otherText: "Friday", skipped: true },
        },
        QUESTIONS,
      ),
    ).toEqual([
      { selected: [], text: "Something else" },
      { selected: ["Billing"] },
      { selected: [] },
    ]);
  });
});

describe("asked questions row", () => {
  const user = userEvent.setup();

  it("shows the owner's answers once the call is done", async () => {
    view({
      status: "done",
      taskId: undefined,
      answers: [{ selected: ["SQLite"] }, { selected: ["Auth"], text: "CSV" }, { selected: [] }],
    });
    expect(screen.queryByTestId("question-card")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Asked you 3 questions/ }));
    expect(screen.getByText("SQLite")).toBeInTheDocument();
    expect(screen.getByText("Auth, Other: CSV")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
  });

  it("marks dismissed and stopped questions", () => {
    const { unmount } = view({ status: "done", taskId: undefined });
    expect(screen.getByText("dismissed by you")).toBeInTheDocument();
    unmount();
    view({ status: "aborted", taskId: undefined });
    expect(screen.getByText("stopped")).toBeInTheDocument();
  });
});
