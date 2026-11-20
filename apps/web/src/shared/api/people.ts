import type { Jsonified } from "../json";

export interface PeopleMe {
  guest: boolean;
}

export interface GuestData {
  id: number;
  email: string;
  name: string | null;
  createdAt: Date;
  botIds: string[];
}

export type Guest = Jsonified<GuestData>;

export interface GuestListData {
  guests: GuestData[];
}

export type GuestList = Jsonified<GuestListData>;

export interface GuestCreateBody {
  email: string;
  password: string;
  name?: string;
}

export interface GuestRemoved {
  removed: true;
}
