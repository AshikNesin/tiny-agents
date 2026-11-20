import * as faux from "@earendil-works/pi-ai/providers/faux";

export * from "@earendil-works/pi-ai/providers/faux";

const { fauxAssistantMessage: msg, fauxText: text, fauxToolCall: call } = faux;

const ASK = "The checkout test is flaky. Fix it and run the suite.";
const CLOSING = "Fixed. All 48 tests pass. The change is on branch fix/checkout-flake.";
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

function scripted(context) {
  const messages = context.messages;
  const at = messages.findLastIndex((m) => m.role === "user");
  const said = textOf(messages[at]);
  const toolResults = messages.slice(at + 1).filter((m) => m.role === "toolResult").length;
  if (said.includes("Reply from Claude Code")) return msg(text(CLOSING));
  if (!said.includes(ASK)) return undefined;
  if (toolResults === 0) {
    const start = msg(call("code_start", { harness: "claude-code", task: ASK, cwd: CWD }));
    return { ...start, stopReason: "toolUse" };
  }
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
