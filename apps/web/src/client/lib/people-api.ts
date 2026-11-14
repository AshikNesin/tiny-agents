/** Guests and sharing (issue #145): who is signed in, and the owner's guest list. */
import { apiClient } from "@groot/shell/lib/api";
import type {
  Guest,
  GuestCreateBody,
  GuestList,
  GuestRemoved,
  PeopleMe,
} from "../../shared/api/people";

export const peopleApi = {
  me: () => apiClient.get<PeopleMe>("/people/me"),
  list: () => apiClient.get<GuestList>("/people"),
  add: (input: GuestCreateBody) => apiClient.post<Guest>("/people", input),
  remove: (id: number) => apiClient.delete<GuestRemoved>(`/people/${id}`),
};
