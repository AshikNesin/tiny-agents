import { afterAll, describe, expect, it } from "vite-plus/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { files } from "@groot/core/storage";
import { copyFile, createFolder, deleteFolder } from "@groot/core/storage/storage.service";

/**
 * copyFile — duplicates a stored object (workflow templates, derived files).
 * 404s when the source is missing; the copy is byte-identical and independent.
 */
const SRC = "test-copyfile-src.txt";
const DST = "test-copyfile-dst.txt";

afterAll(async () => {
  await files.delete([SRC, DST]).catch(() => {});
});

describe("copyFile", () => {
  it("duplicates an existing object and reports the new path", async () => {
    await files.upload(SRC, "hello copy");
    const result = await copyFile({ oldPath: SRC, newPath: DST });
    expect(result).toEqual({ newPath: DST });
    const stored = await files.download(DST);
    expect(await stored.text()).toBe("hello copy");
  });

  it("throws 404 when the source path does not exist", async () => {
    await expect(copyFile({ oldPath: "missing-src.txt", newPath: "whatever.txt" })).rejects.toThrow(
      /Source file not found/,
    );
  });

  it("the copy is independent of the source (later edits do not propagate)", async () => {
    await files.upload(SRC, "v2");
    const stored = await files.download(DST);
    expect(await stored.text()).toBe("hello copy");
  });
});

describe("deleteFolder", () => {
  const FOLDER = "test-delete-folder/nested";

  afterAll(async () => {
    await deleteFolder({ folderPath: `${FOLDER}/` }).catch(() => {});
  });

  it("deletes the folder's files and prunes the emptied directories (local driver)", async () => {
    const dir = path.resolve("local/uploads", FOLDER);

    await createFolder({ folderPath: `${FOLDER}/` });
    await files.upload(`${FOLDER}/file.txt`, "content");
    expect(existsSync(dir)).toBe(true);

    const result = await deleteFolder({ folderPath: `${FOLDER}/` });
    expect(result.deletedCount).toBeGreaterThan(0);

    // Marker + files are gone, and the emptied directories are pruned
    // bottom-up (both "nested" and "test-delete-folder")
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(path.dirname(dir))).toBe(false);
  });

  it("rejects a folder path without a trailing slash", async () => {
    await expect(deleteFolder({ folderPath: "no-slash" })).rejects.toThrow(/must end with \//);
  });
});
