/**
 * The browser profiles the owner's pages act on by profile rather than by
 * bot (the Computer page, issue #108, and the Browser page, issue #160):
 * `shared` (every bot on the shared profile) and `bot-<id>` for each bot set
 * to a profile of its own. Only those are accepted, so neither page can
 * start a browser or desktop nobody owns.
 */
import { asc, eq } from "drizzle-orm";
import { parseStringParam } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import { db, bots } from "../../db";
import { SHARED_BROWSER_PROFILE } from "./browser.targets";

/** One profile a page lists: who uses it. */
export interface ProfileEntry {
  profile: string;
  /** "Shared", or the bot's name. */
  label: string;
  /** Bots that use this profile. */
  bots: { id: string; name: string }[];
}

/** Every profile a bot can have: the shared one, and one per own-profile bot. */
export async function listProfiles(): Promise<ProfileEntry[]> {
  const rows = await db
    .select({ id: bots.id, name: bots.name, browserProfile: bots.browserProfile })
    .from(bots)
    .orderBy(asc(bots.name));
  const shared = rows.filter((row) => row.browserProfile !== "own");
  return [
    {
      profile: SHARED_BROWSER_PROFILE,
      label: "Shared",
      bots: shared.map(({ id, name }) => ({ id, name })),
    },
    ...rows
      .filter((row) => row.browserProfile === "own")
      .map((row) => ({
        profile: `bot-${row.id}`,
        label: row.name,
        bots: [{ id: row.id, name: row.name }],
      })),
  ];
}

/** The profile in the path, if it names one a bot can have; else 404 with `notFound`. */
export async function knownProfile(raw: string | undefined, notFound: string): Promise<string> {
  const profile = parseStringParam(raw, "profile");
  if (profile === SHARED_BROWSER_PROFILE) return profile;
  const id = /^bot-(.+)$/.exec(profile)?.[1];
  if (id) {
    const [row] = await db
      .select({ browserProfile: bots.browserProfile })
      .from(bots)
      .where(eq(bots.id, id))
      .limit(1);
    if (row?.browserProfile === "own") return profile;
  }
  throw Boom.notFound(notFound);
}
