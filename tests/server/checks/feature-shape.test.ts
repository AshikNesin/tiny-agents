import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const API = "apps/web/src/server/api";
const FEATURES_FILE = `${API}/features.ts`;

interface Layout {
  folders: Record<string, string[]>;
  features: string;
}

interface Mount {
  feature: string;
  folder: string;
  file: string;
}

function prefixOf(file: string): string {
  return path.basename(file).split(".")[0]!;
}

function mounts(features: string): Mount[] {
  const sources = new Map<string, { folder: string; file: string }>();
  for (const match of features.matchAll(/import\s+([^;]+?)\s+from\s+"\.\/([\w-]+)\/([\w.-]+)";/g)) {
    const [, bindings, folder, file] = match;
    for (const binding of bindings!.replace(/[{}]/g, ",").split(",")) {
      const name = binding
        .trim()
        .split(/\s+as\s+/)
        .pop()!;
      if (name) sources.set(name, { folder: folder!, file: `${file}.ts` });
    }
  }
  const list = features.slice(features.indexOf("export const FEATURES"));
  const found: Mount[] = [];
  for (const entry of list.split(/\{\s*name:\s*"/).slice(1)) {
    const feature = entry.slice(0, entry.indexOf('"'));
    for (const word of entry.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      const source = sources.get(word);
      if (source) found.push({ feature, ...source });
    }
  }
  return found;
}

function shapeProblems({ folders, features }: Layout): string[] {
  const problems: string[] = [];
  const mounted = mounts(features);
  const owners = new Map(Object.keys(folders).map((folder) => [folder, folder]));

  for (const [folder, files] of Object.entries(folders)) {
    const routeFiles = files.filter((file) => file.endsWith(".routes.ts"));
    const prefixes = [...new Set(routeFiles.map(prefixOf))];
    if (prefixes.length > 1) {
      const strays = prefixes.filter((prefix) => prefix !== folder).join(", ");
      problems.push(
        `${API}/${folder}/ holds the routes of ${prefixes.length} features (${prefixes.join(", ")}). A folder is one feature: git mv the ${strays} files into their own folder under ${API}/.`,
      );
    }
    for (const file of routeFiles) {
      const prefix = prefixOf(file);
      const mount = mounted.find((entry) => entry.folder === folder && entry.file === file);
      if (!mount) {
        problems.push(
          `${API}/${folder}/${file} is not mounted. Import it in ${FEATURES_FILE} and add its entry to FEATURES.`,
        );
        continue;
      }
      if (prefix === folder || prefix === mount.feature) {
        owners.set(prefix, folder);
        continue;
      }
      problems.push(
        `${API}/${folder}/${file} is named for "${prefix}", but its folder is "${folder}" and its FEATURES entry is "${mount.feature}". Rename the feature's files ${folder}.<role>.ts.`,
      );
    }
  }

  for (const [folder, files] of Object.entries(folders)) {
    for (const file of files) {
      const owner = owners.get(prefixOf(file));
      if (owner && owner !== folder) {
        problems.push(
          `${API}/${folder}/${file} carries the "${prefixOf(file)}" prefix, which belongs to ${API}/${owner}/. git mv it there, or rename it if it is part of ${folder}.`,
        );
      }
    }
  }
  return problems;
}

function readLayout(): Layout {
  const folders: Record<string, string[]> = {};
  for (const entry of readdirSync(API, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    folders[entry.name] = readdirSync(path.join(API, entry.name), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".ts"))
      .sort();
  }
  return { folders, features: readFileSync(FEATURES_FILE, "utf8") };
}

const sample = [
  'import botsRoutes from "./bots/bots.routes";',
  'import memoriesRoutes from "./memories/memories.routes";',
  'import pushRoutes from "./notifications/push.routes";',
  "export const FEATURES = [",
  '  { name: "bots", routes: botsRoutes },',
  '  { name: "memories", routes: memoriesRoutes },',
  '  { name: "push", routes: pushRoutes },',
  "];",
].join("\n");

const sampleFolders = {
  bots: ["bot-reach.ts", "bots.routes.ts", "bots.service.ts", "chats.service.ts"],
  memories: ["memories.routes.ts", "memories.store.ts"],
  notifications: ["notifications.wiring.ts", "push.routes.ts", "push.store.ts"],
};

describe("feature folders", () => {
  it("each hold one feature, mounted in FEATURES", () => {
    const layout = readLayout();
    expect(Object.keys(layout.folders).length).toBeGreaterThan(15);
    expect(mounts(layout.features).length).toBeGreaterThan(15);
    expect(shapeProblems(layout)).toEqual([]);
  });

  it("accept helper files and a routes file named for its FEATURES entry", () => {
    expect(shapeProblems({ folders: sampleFolders, features: sample })).toEqual([]);
  });

  it("name the folder a stray file from another feature belongs in", () => {
    const folders = { ...sampleFolders, bots: [...sampleFolders.bots, "memories.tidy.ts"] };
    expect(shapeProblems({ folders, features: sample })).toEqual([
      `${API}/bots/memories.tidy.ts carries the "memories" prefix, which belongs to ${API}/memories/. git mv it there, or rename it if it is part of bots.`,
    ]);
    const push = { ...sampleFolders, bots: [...sampleFolders.bots, "push.channel.ts"] };
    expect(shapeProblems({ folders: push, features: sample })).toEqual([
      `${API}/bots/push.channel.ts carries the "push" prefix, which belongs to ${API}/notifications/. git mv it there, or rename it if it is part of bots.`,
    ]);
  });

  it("refuse a second feature's routes in one folder", () => {
    const folders = {
      bots: [...sampleFolders.bots, "memories.routes.ts"],
      notifications: sampleFolders.notifications,
    };
    const features = sample.replace("./memories/memories.routes", "./bots/memories.routes");
    expect(shapeProblems({ folders, features })).toEqual([
      `${API}/bots/ holds the routes of 2 features (bots, memories). A folder is one feature: git mv the memories files into their own folder under ${API}/.`,
    ]);
  });

  it("refuse a routes file named for neither its folder nor its FEATURES entry", () => {
    const folders = { tasks: ["task.routes.ts"] };
    const features = [
      'import tasksRoutes from "./tasks/task.routes";',
      'export const FEATURES = [{ name: "tasks", routes: tasksRoutes }];',
    ].join("\n");
    expect(shapeProblems({ folders, features })).toEqual([
      `${API}/tasks/task.routes.ts is named for "task", but its folder is "tasks" and its FEATURES entry is "tasks". Rename the feature's files tasks.<role>.ts.`,
    ]);
  });

  it("refuse a routes file FEATURES does not mount", () => {
    const folders = { ...sampleFolders, skills: ["skills.routes.ts"] };
    expect(shapeProblems({ folders, features: sample })).toEqual([
      `${API}/skills/skills.routes.ts is not mounted. Import it in ${FEATURES_FILE} and add its entry to FEATURES.`,
    ]);
  });
});
