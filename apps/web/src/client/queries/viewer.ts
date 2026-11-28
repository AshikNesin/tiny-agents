import { peopleApi } from "../lib/people-api";
import { useResource, type Resource } from "./resource";

type ViewerRole = "owner" | "guest";

export type KnownViewer = ViewerRole | "loading" | "unknown";

export const useViewer = (): Resource<ViewerRole> =>
  useResource(
    ["people", "me"],
    async () => ((await peopleApi.me()).guest ? "guest" : "owner"),
    "Failed to load your account",
    { staleTime: Infinity },
  );

export function viewerRole(viewer: Resource<ViewerRole>): KnownViewer {
  if (viewer.status === "loading") return "loading";
  if (viewer.status === "ready") return viewer.data;
  return viewer.last ?? "unknown";
}
