import { describe, expect, it } from "vite-plus/test";
import { api, createTestApp, signIn } from "../helpers";

const app = createTestApp();

interface Todo {
  id: number;
  title: string;
  completed: boolean;
  createdAt: string;
}

describe("todos API", () => {
  it("supports the CRUD cycle", async () => {
    const { token } = await signIn(app);

    const created = await api<Todo>(app, "/api/v1/todos", {
      method: "POST",
      json: { title: "Write tests" },
      token,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ title: "Write tests", completed: false });
    const id = created.body.data!.id;

    const list = await api<Todo[]>(app, "/api/v1/todos", { token });
    expect(list.body.data?.map((t) => t.id)).toContain(id);

    const updated = await api<Todo>(app, `/api/v1/todos/${id}`, {
      method: "PUT",
      json: { completed: true },
      token,
    });
    expect(updated.body.data).toMatchObject({ id, title: "Write tests", completed: true });

    expect((await api(app, `/api/v1/todos/${id}`, { token })).body.data).toMatchObject({
      id,
      completed: true,
    });

    expect((await api(app, `/api/v1/todos/${id}`, { method: "DELETE", token })).status).toBe(204);
    expect((await api(app, `/api/v1/todos/${id}`, { token })).status).toBe(404);
  });

  it("validates ids and payloads", async () => {
    const { token } = await signIn(app);
    expect((await api(app, "/api/v1/todos/abc", { token })).status).toBe(400);
    expect((await api(app, "/api/v1/todos/0", { token })).status).toBe(400);
    const invalid = await api(app, "/api/v1/todos", { method: "POST", json: { title: "" }, token });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error?.details).toMatchObject({ title: [expect.any(String)] });
  });
});
