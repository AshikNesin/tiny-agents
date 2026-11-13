/**
 * The bot dialog's form without React: a draft from a bot or from nothing,
 * what blocks saving, the payload it becomes, and selection toggles.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  canSaveDraft,
  draftFrom,
  draftPayload,
  draftProblem,
  fallbackModelId,
  toggleId,
} from "@/lib/bot-draft";
import type { Bot } from "@/lib/bots-api";

const bot = {
  id: "b1",
  name: "Ada",
  description: "Maths",
  systemPrompt: "Be brief.",
  modelId: "m-2",
  toolPermissions: { "tasks.add": "allow" },
  skillIds: ["s1"],
  connectionIds: ["c1"],
  browserProfile: "own",
  autoReview: true,
  yoloByDefault: true,
  guestIds: [7],
} as unknown as Bot;

describe("bot draft", () => {
  it("starts a new bot empty on the default model, else the catalog's first", () => {
    expect(fallbackModelId("m-default", [{ id: "m-1" }])).toBe("m-default");
    expect(fallbackModelId(undefined, [{ id: "m-1" }])).toBe("m-1");
    expect(fallbackModelId(undefined, [])).toBeUndefined();
    expect(draftFrom(null, "m-1")).toEqual({
      name: "",
      description: "",
      systemPrompt: "",
      modelId: "m-1",
      toolPermissions: {},
      skillIds: [],
      connectionIds: [],
      browserProfile: "shared",
      autoReview: false,
      yoloByDefault: false,
      guestIds: [],
    });
    expect(draftFrom(null, undefined).modelId).toBe("");
  });

  it("starts an edit from the bot's own fields, never the default model", () => {
    expect(draftFrom(bot, "m-default")).toEqual({
      name: "Ada",
      description: "Maths",
      systemPrompt: "Be brief.",
      modelId: "m-2",
      toolPermissions: { "tasks.add": "allow" },
      skillIds: ["s1"],
      connectionIds: ["c1"],
      browserProfile: "own",
      autoReview: true,
      yoloByDefault: true,
      guestIds: [7],
    });
  });

  it("needs a name and a model before it can be saved", () => {
    expect(draftProblem(draftFrom(null, "m-1"))).toBe("Name and model are required");
    expect(draftProblem({ ...draftFrom(null, "m-1"), name: "  " })).toBeDefined();
    expect(draftProblem({ ...draftFrom(null, undefined), name: "Ada" })).toBeDefined();
    expect(canSaveDraft({ ...draftFrom(null, "m-1"), name: "Ada" })).toBe(true);
  });

  it("trims the name and description in the payload and keeps the rest as edited", () => {
    const payload = draftPayload({
      ...draftFrom(bot, undefined),
      name: " Ada ",
      description: " x ",
    });
    expect(payload.name).toBe("Ada");
    expect(payload.description).toBe("x");
    expect(payload.toolPermissions).toEqual({ "tasks.add": "allow" });
  });

  it("toggles an id in and out of a selection without duplicates", () => {
    expect(toggleId(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "b", true)).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a", false)).toEqual(["b"]);
  });
});
