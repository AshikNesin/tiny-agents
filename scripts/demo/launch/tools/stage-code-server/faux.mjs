// The fake model for the `code` staging instance. The app's faux runtime
// (TINY_AGENTS_FAUX=1, bots.runtime.ts) queues its "Echo: …" factory; this
// wraps each queued step so Code Buddy says its CAST lines and makes the real
// `code_start` call. Anything else falls through to the app's own factory.
import * as faux from "@earendil-works/pi-ai/providers/faux";

export * from "@earendil-works/pi-ai/providers/faux";

const { fauxAssistantMessage: msg, fauxText: text, fauxToolCall: call } = faux;

// ../CAST.md, Chats → Code Buddy.
const ASK = "The checkout test is flaky. Fix it and run the suite.";
const CLOSING = "Fixed. All 48 tests pass. The change is on branch fix/checkout-flake.";
/** The thread's working directory (absolute: Claude Code takes nothing else). */
const CWD = process.env.STAGE_CODE_CWD;

const textOf = (m) =>
  !m
    ? ""
    : typeof m.content === "string"
      ? m.content
      : m.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");

/** Code Buddy's next message, or undefined when the conversation is not the CAST one. */
function scripted(context) {
  const messages = context.messages;
  const at = messages.findLastIndex((m) => m.role === "user");
  const said = textOf(messages[at]);
  const toolResults = messages.slice(at + 1).filter((m) => m.role === "toolResult").length;
  // Step 4: the hand-off's finish arrived ("Reply from Claude Code").
  if (said.includes("Reply from Claude Code")) return msg(text(CLOSING));
  if (!said.includes(ASK)) return undefined;
  // Step 2: hand the task to Claude Code.
  if (toolResults === 0) {
    const start = msg(call("code_start", { harness: "claude-code", task: ASK, cwd: CWD }));
    return { ...start, stopReason: "toolUse" };
  }
  // The card says it started: CAST has no line from the bot here.
  return msg([]);
}

export function fauxProvider(options = {}) {
  const handle = faux.fauxProvider(options);
  if (options.provider !== "faux") return handle;
  const setResponses = handle.setResponses.bind(handle);
  handle.setResponses = (steps) =>
    setResponses(
      steps.map(
        (step) =>
          (context, ...rest) =>
            scripted(context) ?? (typeof step === "function" ? step(context, ...rest) : step),
      ),
    );
  return handle;
}
