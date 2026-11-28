import { asc, eq } from "drizzle-orm";
import { parseStringParam } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import { db, bots } from "../../db";
import { ownBrowserProfile, SHARED_BROWSER_PROFILE } from "../bots/browser.targets";

export interface ProfileEntry {
  profile: string;
  label: string;
  bots: { id: string; name: string }[];
}

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
        profile: ownBrowserProfile(row.id),
        label: row.name,
        bots: [{ id: row.id, name: row.name }],
      })),
  ];
}

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
