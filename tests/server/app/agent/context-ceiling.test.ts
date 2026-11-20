import { describe, it } from "vite-plus/test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { until } from "../../fixtures/until";
import { finishedReplyTo } from "../../../../packages/agent/src/replies";
import { AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  fauxAssistantMessage,
  fauxModelConfig,
  fauxModelRow,
  fauxText,
} from "../../../../packages/agent/src/testing";

const BIG = "big-window";

async function openBigWindowRuntime() {
  const models = createModels();
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: BIG, name: "Big window", contextWindow: 1_000_000 }],
  });
  faux.setResponses(Array.from({ length: 50 }, () => fauxAssistantMessage(fauxText("ok"))));
  models.setProvider(faux.provider);
  return AgentRuntime.open({
    storePath: ":memory:",
    models,
    modelConfig: fauxModelConfig([fauxModelRow(BIG, "Big window")]),
    settings: { retry: { enabled: false } },
  });
}

describe("context ceiling", () => {
  it("summarizes a 180k-token chat on a 1M-window model", async () => {
    const runtime = await openBigWindowRuntime();
    try {
      const ref = await runtime.createConversation({ modelId: BIG, systemPrompt: "" });
      const long = (tag: string) => `${tag} ${"lorem ipsum ".repeat(30_000)}`;
      for (const [id, text] of [
        ["one", long("first")],
        ["two", long("second")],
        ["three", "and now?"],
      ]) {
        await runtime.submit(ref, { requestId: id, text });
        await until(
          async () => finishedReplyTo(await runtime.readChat(ref), id).status === "answered",
          `the reply to ${id}`,
        );
      }
      await until(
        async () => (await runtime.readChat(ref)).messages.some((m) => m.marker === "compaction"),
        "a compaction summary",
        5_000,
      );
    } finally {
      await runtime.close();
    }
  });
});
