import type { Jsonified } from "../json";
import type { PushSubscriptionStatus } from "../machines/push-subscription";

export interface VapidKey {
  publicKey: string;
}

type PushDistributor = "fcm" | "unifiedpush" | "browser";

export interface PushDeviceBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  distributor: PushDistributor;
  label?: string;
  appVersion?: string;
}

export interface PushDeviceRegistered {
  id: string;
}

export interface PushDeviceData {
  id: string;
  label: string;
  distributor: PushDistributor;
  host: string;
  appVersion: string | null;
  status: PushSubscriptionStatus;
  lastError: string | null;
  lastSuccessAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export type PushDevice = Jsonified<PushDeviceData>;

export interface PushDeviceListData {
  devices: PushDeviceData[];
}

export type PushDeviceList = Jsonified<PushDeviceListData>;

export interface PushDeviceRemoved {
  removed: true;
}

export type PushDeviceTest = { ok: true } | { ok: false; reason: string };
