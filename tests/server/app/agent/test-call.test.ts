/**
 * The Test button on a classifier row (Jev, Clef): one real classify call,
 * not a chat completion, so a classifier tests green when it can answer.
 */
import type { ClassifierApi, ClassifierModel } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vite-plus/test";
import { testClassifierCall } from "../../../../packages/agent/src/providers/test-call";

const jev = { id: "typesafe/jev" } as ClassifierModel<ClassifierApi>;

type Classify = Parameters<typeof testClassifierCall>[0]["classify"];
const classifyReturning = (result: unknown) =>
  vi.fn(async () => result) as unknown as Classify & ReturnType<typeof vi.fn>;

describe("testClassifierCall", () => {
  it("asks the classifier one yes/no question and passes on its answer", async () => {
    const classify = classifyReturning({
      stopReason: "stop",
      answers: { ok: { type: "bool", probability: 0.9 } },
    });
    const result = await testClassifierCall({ classify }, jev);
    expect(result.ok).toBe(true);
    const [model, context] = classify.mock.calls[0]!;
    expect(model).toBe(jev);
    expect(context.questions.ok).toMatchObject({ type: "bool" });
  });

  it("fails with the provider's error", async () => {
    const classify = classifyReturning({
      stopReason: "error",
      errorMessage: "402 no credits",
      answers: {},
    });
    expect(await testClassifierCall({ classify }, jev)).toMatchObject({
      ok: false,
      error: "402 no credits",
    });
  });

  it("fails when the classifier gives no answer", async () => {
    const classify = classifyReturning({ stopReason: "stop", answers: {} });
    expect(await testClassifierCall({ classify }, jev)).toMatchObject({
      ok: false,
      error: "The classifier gave no answer.",
    });
  });

  it("fails when the call throws", async () => {
    const classify = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as Classify;
    expect(await testClassifierCall({ classify }, jev)).toMatchObject({
      ok: false,
      error: "network down",
    });
  });
});
