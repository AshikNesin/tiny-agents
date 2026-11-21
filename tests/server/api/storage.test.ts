import { beforeEach, describe, expect, it } from "vite-plus/test";
import { storage } from "@groot/core/storage";
import { copyFile, deleteFolder } from "@groot/core/storage/storage.service";
import { api, createTestApp, signIn } from "../helpers";
import { useFreshTestDatabase } from "../fixtures/test-db";

const app = createTestApp();

interface FileInfo {
  key: string;
  name: string;
  isDirectory: boolean;
  size: number;
}

interface UploadResult {
  uploadedFiles: string[];
  failedFiles: Array<{ filePath: string; error: string }>;
}

function uploadForm(files: File[], folder?: string): FormData {
  const form = new FormData();
  for (const file of files) form.append("file", file);
  if (folder !== undefined) form.append("folder", folder);
  return form;
}

beforeEach(useFreshTestDatabase);
describe("storage API", () => {
  it("uploads, lists, downloads, renames and deletes files", async () => {
    const { token } = await signIn(app);

    const upload = await api<UploadResult>(app, "/api/v1/storage/files/upload", {
      method: "POST",
      body: uploadForm([new File(["hello groot"], "hello.txt", { type: "text/plain" })], "docs/"),
      token,
    });
    expect(upload.status).toBe(200);
    expect(upload.body.data).toEqual({ uploadedFiles: ["docs/hello.txt"], failedFiles: [] });

    const root = await api<FileInfo[]>(app, "/api/v1/storage/files", { token });
    expect(root.body.data).toEqual([
      expect.objectContaining({ key: "docs/", name: "docs", isDirectory: true }),
    ]);

    const docs = await api<FileInfo[]>(app, "/api/v1/storage/files?folder=docs", { token });
    expect(docs.body.data).toEqual([
      expect.objectContaining({ key: "docs/hello.txt", name: "hello.txt", size: 11 }),
    ]);

    const download = await app.request("/api/v1/storage/files/download?filePath=docs/hello.txt", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain("text/plain");
    expect(download.headers.get("content-type")).toMatch(/charset=utf-8/i);
    expect(download.headers.get("content-disposition")).toContain('filename="hello.txt"');
    expect(await download.text()).toBe("hello groot");

    const renamed = await api(app, "/api/v1/storage/files/rename", {
      method: "PUT",
      json: { oldPath: "docs/hello.txt", newPath: "docs/hi.txt" },
      token,
    });
    expect(renamed.body.data).toEqual({ newPath: "docs/hi.txt" });

    const deleted = await api(app, "/api/v1/storage/files", {
      method: "DELETE",
      json: { filePaths: ["docs/hi.txt", "docs/never-existed.txt"] },
      token,
    });
    expect(deleted.status).toBe(204);
    expect(
      (await api(app, "/api/v1/storage/files/download?filePath=docs/hi.txt", { token })).status,
    ).toBe(404);
  });

  it("renaming a file onto its own path keeps it", async () => {
    const { token } = await signIn(app);
    await storage.put("same/keep.txt", "keep me");
    const renamed = await api(app, "/api/v1/storage/files/rename", {
      method: "PUT",
      json: { oldPath: "same/keep.txt", newPath: "same/keep.txt" },
      token,
    });
    expect(renamed.status).toBe(200);
    expect(await storage.head("same/keep.txt")).not.toBeNull();
    const missing = await api(app, "/api/v1/storage/files/rename", {
      method: "PUT",
      json: { oldPath: "same/none.txt", newPath: "same/none.txt" },
      token,
    });
    expect(missing.status).toBe(404);
  });

  it("serves active content as an attachment with nosniff", async () => {
    const { token } = await signIn(app);
    await storage.put("active/x.svg", "<svg onload=alert(1)/>", { contentType: "image/svg+xml" });
    const svg = await app.request("/api/v1/storage/files/download?filePath=active/x.svg", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(svg.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(svg.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rejects an uploaded file name containing a slash", async () => {
    const { token } = await signIn(app);
    const response = await api(app, "/api/v1/storage/files/upload", {
      method: "POST",
      body: uploadForm([new File(["x"], "sub/x.txt")]),
      token,
    });
    expect(response.status).toBe(400);
  });

  it("uploads several files into the given folder in one request", async () => {
    const { token } = await signIn(app);
    const response = await api<UploadResult>(app, "/api/v1/storage/files/upload", {
      method: "POST",
      body: uploadForm(
        [
          new File(["a"], "a.txt", { type: "text/plain" }),
          new File(["bb"], "b.txt", { type: "text/plain" }),
        ],
        "/bulk/inner",
      ),
      token,
    });
    expect(response.status).toBe(200);
    expect(response.body.data?.uploadedFiles.sort()).toEqual([
      "bulk/inner/a.txt",
      "bulk/inner/b.txt",
    ]);
    expect((await storage.head("bulk/inner/b.txt"))?.size).toBe(2);

    const root = await api<UploadResult>(app, "/api/v1/storage/files/upload", {
      method: "POST",
      body: uploadForm([new File(["r"], "root.txt")]),
      token,
    });
    expect(root.body.data?.uploadedFiles).toEqual(["root.txt"]);
  });

  it("rejects uploads without a file or with a bad folder or name", async () => {
    const { token } = await signIn(app);
    const upload = (body: FormData) =>
      api(app, "/api/v1/storage/files/upload", { method: "POST", body, token });

    expect((await upload(uploadForm([], "docs/"))).status).toBe(400);
    expect((await upload(uploadForm([new File(["x"], "x.txt")], "../escape"))).status).toBe(400);
    expect((await upload(uploadForm([new File(["x"], "x.txt")], "a//b"))).status).toBe(400);
    expect((await upload(uploadForm([new File(["x"], "..")], "docs"))).status).toBe(400);
  });

  it("rejects malformed paths", async () => {
    const { token } = await signIn(app);
    expect(
      (await api(app, "/api/v1/storage/files/download?filePath=../secret", { token })).status,
    ).toBe(400);
    expect((await api(app, "/api/v1/storage/files?folder=a/../b", { token })).status).toBe(400);
    expect(
      (
        await api(app, "/api/v1/storage/files/rename", {
          method: "PUT",
          json: { oldPath: "a.txt", newPath: "/b.txt" },
          token,
        })
      ).status,
    ).toBe(400);
  });

  it("creates and deletes folders", async () => {
    const { token } = await signIn(app);
    const created = await api(app, "/api/v1/storage/folders", {
      method: "POST",
      json: { folderPath: "archive/2025" },
      token,
    });
    expect(created.status).toBe(200);
    expect(created.body.data).toEqual({ folderPath: "archive/2025/" });
    expect(await storage.head("archive/2025/.keep")).not.toBeNull();
    expect(
      (
        await api(app, "/api/v1/storage/folders", {
          method: "POST",
          json: { folderPath: "/" },
          token,
        })
      ).status,
    ).toBe(400);
    await storage.put("archive/2025/report.txt", "r");
    await storage.put("archive/2025-old/kept.txt", "k");

    const deleted = await api<{ deletedCount: number }>(
      app,
      "/api/v1/storage/folders/archive%2F2025",
      {
        method: "DELETE",
        token,
      },
    );
    expect(deleted.body.data?.deletedCount).toBe(2);
    expect(await storage.head("archive/2025/report.txt")).toBeNull();
    expect(await storage.head("archive/2025-old/kept.txt")).not.toBeNull();
  });
});

describe("storage service", () => {
  it("copies files and reports missing sources", async () => {
    await storage.put("copy/src.txt", "hello copy");
    expect(await copyFile({ oldPath: "copy/src.txt", newPath: "copy/dst.txt" })).toEqual({
      newPath: "copy/dst.txt",
    });
    expect(new TextDecoder().decode((await storage.get("copy/dst.txt"))!.bytes)).toBe("hello copy");
    await expect(copyFile({ oldPath: "missing.txt", newPath: "x.txt" })).rejects.toThrow(
      /Source file not found/,
    );
  });

  it("deletes every object under a folder prefix", async () => {
    await storage.put("tree/a.txt", "a");
    await storage.put("tree/sub/b.txt", "b");
    expect(await deleteFolder({ folderPath: "tree/" })).toEqual({ deletedCount: 2 });
    expect((await storage.list({ prefix: "tree/" })).objects).toEqual([]);
  });
});
