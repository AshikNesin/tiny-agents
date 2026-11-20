import { lookup } from "node:dns/promises";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import type {
  PushOutcome,
  PushSubscriptionStore,
  StoredPushTarget,
} from "@groot/core/notification/webpush";
import { checkPublicUrl, isPrivateAddress } from "@tiny-agents/sandbox";
import { db, pushSubscriptions } from "../../db";
import { app } from "../../app-root";
import { pushSubscriptionMachine } from "../../../shared/machines/push-subscription";
import type { PushDeviceBody, PushDeviceData } from "../../../shared/api/push";

const MAX_DEVICES = 10;
const FAILING_AFTER = 5;

const ERROR_MAX = 200;

async function checkEndpoint(endpoint: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw Boom.badRequest("The push endpoint is not a URL");
  }
  if (url.protocol !== "https:") throw Boom.badRequest("The push endpoint must use https");
  if (url.username || url.password)
    throw Boom.badRequest("The push endpoint can't hold credentials");
  try {
    checkPublicUrl(endpoint);
  } catch {
    throw Boom.badRequest("The push endpoint is on a private address");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw Boom.badRequest("The push endpoint's host doesn't resolve");
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw Boom.badRequest("The push endpoint resolves to a private address");
  }
  return url;
}

export async function refreshActiveDevices(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(pushSubscriptions)
    .where(ne(pushSubscriptions.status, "revoked"));
  app().webPush.activeDevices = row?.n ?? 0;
  return app().webPush.activeDevices;
}

export async function registerDevice(userId: number, body: PushDeviceBody): Promise<string> {
  await checkEndpoint(body.endpoint);
  const now = new Date();
  const fields = {
    userId,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    distributor: body.distributor,
    label: body.label ?? "",
    appVersion: body.appVersion ?? null,
    lastSeenAt: now,
  };
  const existing = await db.query.pushSubscriptions.findFirst({
    where: eq(pushSubscriptions.endpoint, body.endpoint),
    columns: { id: true },
  });
  let id: string;
  if (existing) {
    id = existing.id;
    await db
      .update(pushSubscriptions)
      .set({ ...fields, failureCount: 0, lastError: null })
      .where(eq(pushSubscriptions.id, id));
    await db
      .update(pushSubscriptions)
      .set({ status: "active" })
      .where(
        and(
          eq(pushSubscriptions.id, id),
          inArray(pushSubscriptions.status, pushSubscriptionMachine.sourcesOf("active")),
        ),
      );
  } else {
    const [row] = await db
      .select({ n: count() })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    if ((row?.n ?? 0) >= MAX_DEVICES) {
      throw Boom.conflict(
        `At most ${MAX_DEVICES} devices can receive notifications. Remove one first.`,
      );
    }
    const [created] = await db
      .insert(pushSubscriptions)
      .values({ ...fields, endpoint: body.endpoint, status: "active", createdAt: now })
      .returning({ id: pushSubscriptions.id });
    id = created!.id;
  }
  await refreshActiveDevices();
  return id;
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "";
  }
}

export async function listDevices(userId: number): Promise<PushDeviceData[]> {
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(desc(pushSubscriptions.lastSeenAt));
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    distributor: row.distributor,
    host: hostOf(row.endpoint),
    appVersion: row.appVersion,
    status: row.status,
    lastError: row.lastError,
    lastSuccessAt: row.lastSuccessAt,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  }));
}

export async function deviceTarget(userId: number, id: string): Promise<StoredPushTarget> {
  const row = await db.query.pushSubscriptions.findFirst({
    where: and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, userId)),
  });
  if (!row) throw Boom.notFound("Device not found");
  return { id: row.id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth };
}

export async function removeDevice(userId: number, id: string): Promise<void> {
  const deleted = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id });
  if (deleted.length === 0) throw Boom.notFound("Device not found");
  await refreshActiveDevices();
}

export async function revokeAllDevices(reason: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ status: "revoked", lastError: reason })
    .where(inArray(pushSubscriptions.status, pushSubscriptionMachine.sourcesOf("revoked")));
  await refreshActiveDevices();
}

export async function reportOutcome(id: string, outcome: PushOutcome): Promise<void> {
  const guarded = (to: "active" | "failing" | "revoked") =>
    and(
      eq(pushSubscriptions.id, id),
      inArray(pushSubscriptions.status, pushSubscriptionMachine.sourcesOf(to)),
    );
  if (outcome.kind === "sent") {
    await db
      .update(pushSubscriptions)
      .set({ failureCount: 0, lastError: null, lastSuccessAt: new Date() })
      .where(eq(pushSubscriptions.id, id));
    await db.update(pushSubscriptions).set({ status: "active" }).where(guarded("active"));
    return;
  }
  const lastError = outcome.detail.slice(0, ERROR_MAX);
  if (outcome.kind === "gone") {
    const moved = await db
      .update(pushSubscriptions)
      .set({ status: "revoked", lastError })
      .where(guarded("revoked"))
      .returning({ id: pushSubscriptions.id });
    if (moved.length > 0) await refreshActiveDevices();
    return;
  }
  await db
    .update(pushSubscriptions)
    .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1`, lastError })
    .where(eq(pushSubscriptions.id, id));
  await db
    .update(pushSubscriptions)
    .set({ status: "failing" })
    .where(and(guarded("failing"), sql`${pushSubscriptions.failureCount} >= ${FAILING_AFTER}`));
}

export const pushSubscriptionStore: PushSubscriptionStore = {
  hasActive: () => app().webPush.activeDevices > 0,
  async targets() {
    return db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(ne(pushSubscriptions.status, "revoked"));
  },
  report: reportOutcome,
};
