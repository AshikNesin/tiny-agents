/** Guests and sharing (issue #145): who is signed in, and the owner's guest list. */
import { apiClient } from "@groot/shell/lib/api";

export interface Guest {
  id: number;
  email: string;
  name: string | null;
  createdAt: string;
  /** Bots shared with this guest. */
  botIds: string[];
}

export interface NewGuest {
  name: string;
  email: string;
  password: string;
}

export const peopleApi = {
  me: () => apiClient.get<{ guest: boolean }>("/people/me"),
  list: () => apiClient.get<{ guests: Guest[] }>("/people"),
  add: (input: NewGuest) => apiClient.post<Guest>("/people", input),
  remove: (id: number) => apiClient.delete<{ removed: true }>(`/people/${id}`),
};
