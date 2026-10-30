import { describe, expect, it } from "vite-plus/test";
import { storage } from "@groot/core/storage";
import { copyFile, deleteFolder } from "@groot/core/storage/storage.service";
import { api, createTestApp, signIn } from "../helpers";

const app = createTestApp();

interface FileInfo {
  key: string;
  name: string;
  isDirectory: boolean;
  size: number;
}

describe("storage API", () => {
  it("uploads, lists, downloads, renames and deletes files", async () => {
    const { token } = await signIn(app);

    const form = new FormData();
    form.append("file", new File(["hello groot"], "hello.txt", { type: "text/plain" }));
    form.append("filePath", "docs/hello.txt");
    const upload = await api<{ filePath: string }>(app, "/api/v1/storage/files/upload", {
      method: "POST",
      body: form,
      token,
    });
    expect(upload.status).toBe(200);
    expect(upload.body.data).toEqual({ filePath: "docs/hello.txt" });

    const root = await api<FileInfo[]>(app, "/api/v1/storage/files", { token });
    expect(root.body.data).toEqual([
      expect.objectContaining({ key: "docs/", name: "docs", isDirectory: true }),
    ]);

    const docs = await api<FileInfo[]>(app, "/api/v1/storage/files?prefix=docs/", { token });
    expect(docs.body.data).toEqual([
      expect.objectContaining({ key: "docs/hello.txt", name: "hello.txt", size: 11 }),
    ]);

    const download = await app.request("/api/v1/storage/files/download?filePath=docs/hello.txt", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain("text/plain");
    expect(download.headers.get("content-disposition")).toContain('filename="hello.txt"');
    expect(await download.text()).toBe("hello groot");

    const metadata = await api(app, "/api/v1/storage/files/metadata?filePath=docs/hello.txt", {
      token,
    });
    expect(metadata.body.data).toMatchObject({ exists: true, size: 11, fileName: "hello.txt" });
    expect(
      (await api(app, "/api/v1/storage/files/metadata?filePath=docs/nope.txt", { token })).body
        .data,
    ).toMatchObject({
      exists: false,
    });

    const renamed = await api(app, "/api/v1/storage/files/rename", {
      method: "PUT",
      json: { oldPath: "docs/hello.txt", newPath: "docs/hi.txt" },
      token,
    });
    expect(renamed.body.data).toEqual({ newPath: "docs/hi.txt" });

    const deleted = await api(app, "/api/v1/storage/files", {
      method: "DELETE",
      json: { filePaths: ["docs/hi.txt"] },
      token,
    });
    expect(deleted.body.data).toEqual({ deletedCount: 1 });
    expect(
      (await api(app, "/api/v1/storage/files/download?filePath=docs/hi.txt", { token })).status,
    ).toBe(404);
  });

  it("rejects uploads without a file and bulk uploads several", async () => {
    const { token } = await signIn(app);
    const empty = new FormData();
    empty.append("filePath", "x.txt");
    expect(
      (await api(app, "/api/v1/storage/files/upload", { method: "POST", body: empty, token }))
        .status,
    ).toBe(400);

    const bulk = new FormData();
    bulk.append("files", new File(["a"], "bulk/a.txt", { type: "text/plain" }));
    bulk.append("files", new File(["bb"], "bulk/b.txt", { type: "text/plain" }));
    const response = await api<{ uploadedFiles: string[] }>(
      app,
      "/api/v1/storage/files/bulk-upload",
      {
        method: "POST",
        body: bulk,
        token,
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.data?.uploadedFiles.sort()).toEqual(["bulk/a.txt", "bulk/b.txt"]);
  });

  it("creates and deletes folders", async () => {
    const { token } = await signIn(app);
    const created = await api(app, "/api/v1/storage/folders", {
      method: "POST",
      json: { folderPath: "archive/2025/" },
      token,
    });
    expect(created.status).toBe(200);
    expect(
      (
        await api(app, "/api/v1/storage/folders", {
          method: "POST",
          json: { folderPath: "no-slash" },
          token,
        })
      ).status,
    ).toBe(400);
    await storage.put("archive/2025/report.txt", "r");

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
    await expect(deleteFolder({ folderPath: "no-slash" })).rejects.toThrow(/must end with \//);
  });
});
