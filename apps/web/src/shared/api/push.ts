/** The phone push API's wire types (`server/api/notifications/push.routes.ts`, issue #306). */
import type { Jsonified } from "../json";
import type { PushSubscriptionStatus } from "../machines/push-subscription";

/** `GET /notifications/vapid-key`: what a device registers its push subscription with. */
export interface VapidKey {
  publicKey: string;
}

type PushDistributor = "fcm" | "unifiedpush" | "browser";

/** `POST /notifications/devices`: register (or refresh) a device by its endpoint. */
export interface PushDeviceBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  distributor: PushDistributor;
  label?: string;
  appVersion?: string;
}

/** `POST /notifications/devices`. */
export interface PushDeviceRegistered {
  id: string;
}

/** A device as the list returns it: never its keys or endpoint path. */
export interface PushDeviceData {
  id: string;
  label: string;
  distributor: PushDistributor;
  /** The push service's host, e.g. fcm.googleapis.com or ntfy.example.com. */
  host: string;
  appVersion: string | null;
  status: PushSubscriptionStatus;
  lastError: string | null;
  lastSuccessAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export type PushDevice = Jsonified<PushDeviceData>;

/** `GET /notifications/devices`. */
export interface PushDeviceListData {
  devices: PushDeviceData[];
}

export type PushDeviceList = Jsonified<PushDeviceListData>;

/** `DELETE /notifications/devices/:id`. */
export interface PushDeviceRemoved {
  removed: true;
}

/** `POST /notifications/devices/:id/test`. */
export type PushDeviceTest = { ok: true } | { ok: false; reason: string };
