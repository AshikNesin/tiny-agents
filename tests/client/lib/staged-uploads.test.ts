/**
 * Staged uploads (lib/staged-uploads.ts), shared by the bot chat's and the
 * Code page's composers: the cap, the size check before uploading, naming
 * pasted files, failures, and deleting an upload nothing will send.
 */
import { describe, expect, it, vi } from "vite-plus/test";
import {
  MAX_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
  readyRefs,
  stageUploads,
  unstageUpload,
  type Staging,
  type StagedUpload,
} from "@/lib/staged-uploads";

function file(name: string, size = 3, type = "text/plain"): File {
  const made = new File(["abc"], name, { type });
  if (size !== 3) Object.defineProperty(made, "size", { value: size });
  return made;
}

/** A composer stand-in: a list, a recorded upload API and recorded notices. */
function composer(
  upload: (file: File) => Promise<string> = async (f) => `ref:${f.name}`,
  options: { deletes?: boolean; staged?: StagedUpload<string>[] } = {},
) {
  let list = options.staged ?? [];
  const deleted: string[] = [];
  const notices: string[] = [];
  const released: string[] = [];
  const uploaded: File[] = [];
  const staging: Staging<string> = {
    upload: (f) => {
      uploaded.push(f);
      return upload(f);
    },
    deleteUpload:
      options.deletes === false
        ? undefined
        : async (ref) => {
            deleted.push(ref);
          },
    current: () => list,
    update: (change) => {
      list = change(list);
    },
    notify: (message) => notices.push(message),
    previewUrl: (f) => `blob:${f.name}`,
    releasePreview: (url) => released.push(url),
  };
  return { staging, list: () => list, deleted, notices, released, uploaded };
}

function deferred() {
  let resolve!: (ref: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("stageUploads", () => {
  it("stages each file as uploading, then done with its ref", async () => {
    const pending = deferred();
    const c = composer(() => pending.promise);
    const settled = stageUploads([file("notes.txt")], c.staging);
    expect(c.list()).toMatchObject([{ name: "notes.txt", status: "uploading" }]);
    pending.resolve("ref-1");
    await settled;
    expect(c.list()).toMatchObject([{ name: "notes.txt", status: "done", ref: "ref-1" }]);
    expect(readyRefs(c.list())).toEqual(["ref-1"]);
  });

  it("previews images only", async () => {
    const c = composer();
    await stageUploads([file("a.png", 3, "image/png"), file("b.txt")], c.staging);
    expect(c.list().map((item) => item.previewUrl)).toEqual(["blob:a.png", undefined]);
  });

  it(`stages up to ${MAX_ATTACHMENTS} attachments and refuses past the cap`, async () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({
      key: `k${i}`,
      name: `${i}`,
      status: "done" as const,
      ref: `r${i}`,
    }));
    const c = composer(undefined, { staged: nine });
    await stageUploads([file("x.txt"), file("y.txt"), file("z.txt")], c.staging);
    expect(c.list()).toHaveLength(MAX_ATTACHMENTS);
    expect(c.uploaded.map((f) => f.name)).toEqual(["x.txt"]);
    expect(c.notices).toEqual([]);

    await stageUploads([file("w.txt")], c.staging);
    expect(c.list()).toHaveLength(MAX_ATTACHMENTS);
    expect(c.uploaded).toHaveLength(1);
    expect(c.notices).toEqual([`Up to ${MAX_ATTACHMENTS} attachments per message`]);
  });

  it("stages a file over 25 MB as an error without uploading it", async () => {
    const c = composer();
    await stageUploads([file("huge.zip", MAX_UPLOAD_BYTES + 1), file("ok.txt")], c.staging);
    expect(c.uploaded.map((f) => f.name)).toEqual(["ok.txt"]);
    expect(c.list()).toMatchObject([
      {
        name: "huge.zip",
        status: "error",
        error: "huge.zip is 25.0 MB; files can be up to 25 MB.",
      },
      { name: "ok.txt", status: "done" },
    ]);
    expect(c.notices).toEqual(["huge.zip is 25.0 MB; files can be up to 25 MB."]);
  });

  it("names a pasted file that has no name, and uploads it under that name", async () => {
    const c = composer();
    await stageUploads([file("", 3, "image/png")], c.staging);
    const [item] = c.list();
    expect(item!.name).toMatch(/^pasted-image-\d+\.png$/);
    expect(c.uploaded[0]!.name).toBe(item!.name);
    expect(c.uploaded[0]!.type).toBe("image/png");
  });

  it("marks a failed upload with its reason and says it once", async () => {
    const c = composer(async () => {
      throw new Error("Disk full");
    });
    await stageUploads([file("a.txt")], c.staging);
    expect(c.list()).toMatchObject([{ name: "a.txt", status: "error", error: "Disk full" }]);
    expect(c.notices).toEqual(["a.txt: Disk full"]);
  });

  it("deletes an upload that lands after its item was removed", async () => {
    const pending = deferred();
    const c = composer(() => pending.promise);
    const settled = stageUploads([file("a.txt")], c.staging);
    unstageUpload(c.list()[0]!, c.staging);
    expect(c.deleted).toEqual([]); // nothing to delete yet
    pending.resolve("ref-late");
    await settled;
    expect(c.list()).toEqual([]);
    expect(c.deleted).toEqual(["ref-late"]);
  });

  it("drops a late upload quietly when the API has no delete", async () => {
    const pending = deferred();
    const c = composer(() => pending.promise, { deletes: false });
    const settled = stageUploads([file("a.txt")], c.staging);
    c.staging.update(() => []); // the draft moved on (a send, another thread)
    pending.resolve("ref-late");
    await settled;
    expect(c.list()).toEqual([]);
  });
});

describe("unstageUpload", () => {
  it("removes the item, releases its preview and deletes its upload", async () => {
    const c = composer();
    await stageUploads([file("a.png", 3, "image/png"), file("b.txt")], c.staging);
    unstageUpload(c.list()[0]!, c.staging);
    expect(c.list().map((item) => item.name)).toEqual(["b.txt"]);
    expect(c.released).toEqual(["blob:a.png"]);
    expect(c.deleted).toEqual(["ref:a.png"]);
  });

  it("ignores a failing delete", async () => {
    const c = composer();
    await stageUploads([file("a.txt")], c.staging);
    c.staging.deleteUpload = vi.fn(async () => {
      throw new Error("gone");
    });
    expect(() => unstageUpload(c.list()[0]!, c.staging)).not.toThrow();
    expect(c.list()).toEqual([]);
  });
});
