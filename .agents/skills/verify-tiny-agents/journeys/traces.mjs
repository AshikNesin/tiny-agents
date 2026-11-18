// Feature: traces (features/traces.md). A chat turn shows up in /traces with
// its model and tokens; the session page shows the whole interaction (prompt,
// thoughts, replies, a tool's input and output) with a filter by type.
import { journey, expect } from "../scripts/lib.mjs";

await journey("traces", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Trace Bot ${stamp}`;
  const composer = page.getByPlaceholder(new RegExp(`(?:ask|message) ${name}`, "i"));
  let botId;

  await step("setup: create a faux bot through the API", async () => {
    const bot = await api.post("/bots", { name, modelId: "test-model" });
    botId = bot.id;
    cleanup(async () => {
      await api.delete(`/bots/${botId}`);
      expect((await api.get("/bots")).some((b) => b.id === botId)).toBe(false);
    });
  });

  await step("send a message that thinks and runs a tool", async () => {
    await page.goto(`/chats/${botId}`);
    await composer.fill(`/trace me ${stamp}`);
    await composer.press("Enter");
    await expect(page.getByText("Here is where things stand").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  await step("open Traces from the account menu", async () => {
    await page.getByRole("button", { name: "Account and navigation" }).click();
    await page.getByRole("menuitem", { name: "Traces" }).click();
    await expect(page).toHaveURL(/\/traces$/);
    await expect(page.getByRole("heading", { name: "Traces", level: 1 })).toBeVisible();
  });

  const row = page.getByTestId("trace-session").filter({ hasText: name });
  await step("the chat is listed with its model", async () => {
    await expect(row).toBeVisible();
    await expect(row).toContainText("Current chat");
    await expect(row).toContainText("test-model");
    await expect(page.getByTestId("traces-summary")).toContainText("Last 7 days");
  });
  await proof("list");

  await step("the session page shows the prompt, thoughts, replies and tool call", async () => {
    await row.click();
    await expect(page).toHaveURL(/\/traces\/\d+$/);
    const turn = page.getByTestId("trace-turn").first();
    await expect(turn.getByTestId("trace-prompt")).toContainText(`/trace me ${stamp}`);
    await expect(turn.getByTestId("trace-thinking")).toHaveCount(2);
    await expect(turn.getByTestId("trace-response").first()).toContainText(
      "Let me look at your open tasks first.",
    );
    await expect(turn).toContainText("test-model");
    await expect(page.getByRole("link", { name: "Open chat" })).toHaveAttribute(
      "href",
      `/chats/${botId}`,
    );
  });
  await proof("session");

  await step("a tool call opens to its input and output", async () => {
    const tool = page.getByTestId("trace-tool").first();
    await tool.getByRole("button").click();
    await expect(tool.getByText('"status": "todo"')).toBeVisible();
    await expect(tool.getByText("Output")).toBeVisible();
    await page.getByTestId("trace-thinking").first().getByRole("button").click();
    await expect(page.getByText("The owner wants a status check.", { exact: false })).toBeVisible();
  });
  await proof("tool-open");

  await step("filter to tool calls only", async () => {
    const filters = page.getByRole("group", { name: "Filter the transcript" }).last();
    await expect(filters.locator("label").filter({ hasText: "Thinking" })).toContainText("2");
    await filters.getByText("Tool calls").click();
    await expect(page.getByTestId("trace-tool")).toHaveCount(1);
    await expect(page.getByTestId("trace-prompt")).toHaveCount(0);
    await expect(page.getByTestId("trace-response")).toHaveCount(0);
  });
  await proof("filtered");

  await step("phone width: the filter folds above the transcript", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByTestId("trace-prompt")).toBeVisible();
    await page.getByText("Filter", { exact: true }).click();
    await expect(page.getByRole("group", { name: "Filter the transcript" }).first()).toBeVisible();
  });
  await proof("phone-session");

  await step("Side-calls filter (faux mode makes none)", async () => {
    await page.goto("/traces");
    await page.getByRole("button", { name: "Side-calls" }).click();
    await expect(page.getByText("No side-calls yet")).toBeVisible();
  });

  await step("phone width", async () => {
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(row).toBeVisible();
  });
  await proof("phone-list");
});
