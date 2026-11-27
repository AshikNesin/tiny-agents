import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { bots, codeProjects, db } from "../../../../apps/web/src/server/db";
import type { ProjectView } from "../../../../apps/web/src/shared/api/code";
import { api, createTestApp, type TestApp } from "../../helpers";
import { authToken, closeAppRuntime, openAppRuntime, resetAppTables } from "../../fixtures";
import { seedProject, type ProjectFixture } from "./project-fixture";

const token = await authToken("project-chat@example.com");

describe("a project's chat", () => {
  let app: TestApp;
  let fixture: ProjectFixture;

  beforeEach(async () => {
    await openAppRuntime();
    await resetAppTables();
    app = createTestApp();
    fixture = await seedProject("shelley");
  });

  afterEach(async () => {
    fixture.cleanup();
    await closeAppRuntime();
  });

  const open = () =>
    api<{ id: string; name: string; projectId: string | null }>(
      app,
      `/api/v1/code/projects/${fixture.project.id}/chat`,
      { method: "POST", token },
    );

  it("is one bot per project, made on first open and named for the project", async () => {
    await db.insert(bots).values({ name: "web", modelId: null, conversationId: "9001" });
    const first = await open();
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({
      name: "web project",
      projectId: fixture.project.id,
    });
    const again = await open();
    expect(again.body.data!.id).toBe(first.body.data!.id);
    expect(await db.select().from(bots).where(eq(bots.projectId, fixture.project.id))).toHaveLength(
      1,
    );
    const listed = await api<ProjectView[]>(app, "/api/v1/code/projects", { token });
    expect(listed.body.data![0]!.chatBotId).toBe(first.body.data!.id);
  });

  it("keeps the bot as a plain one when its project is removed", async () => {
    const chat = await open();
    await db.delete(codeProjects).where(eq(codeProjects.id, fixture.project.id));
    const [row] = await db.select().from(bots).where(eq(bots.id, chat.body.data!.id));
    expect(row?.projectId).toBeNull();
  });

  it("saves the project's instructions", async () => {
    const saved = await api<ProjectView>(app, `/api/v1/code/projects/${fixture.project.id}`, {
      method: "PATCH",
      token,
      json: { settings: { instructions: "  Use pnpm.  " } },
    });
    expect(saved.body.data!.settings.instructions).toBe("Use pnpm.");
  });
});
