/** The People API's wire types (`server/api/people`, issue #145); naming in `./common.ts`. */
import type { Jsonified } from "../json";

/** `GET /people/me`: whether the signed-in account is a guest. */
export interface PeopleMe {
  guest: boolean;
}

/** A guest as the routes return it (`people.service.ts`). */
export interface GuestData {
  id: number;
  email: string;
  name: string | null;
  createdAt: Date;
  /** Bots shared with this guest. */
  botIds: string[];
}

export type Guest = Jsonified<GuestData>;

/** `GET /people`. */
export interface GuestListData {
  guests: GuestData[];
}

export type GuestList = Jsonified<GuestListData>;

/** `POST /people` (core's `createUserSchema`). */
export interface GuestCreateBody {
  email: string;
  password: string;
  name?: string;
}

/** `DELETE /people/:userId`. */
export interface GuestRemoved {
  removed: true;
}
