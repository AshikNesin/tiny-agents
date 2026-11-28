import { useMemo } from "react";
import type { ConnectionSummary } from "../../../shared/api/connections";
import type { SkillSummary } from "../../../shared/api/skills";
import { useCapabilities } from "../../queries/bots";
import { useConnections } from "../../queries/connections";
import { useGuests } from "../../queries/people";
import type { Resource } from "../../queries/resource";
import { useSkills } from "../../queries/skills";

function listed<T>(resource: Resource<T[]>): T[] | undefined {
  if (resource.status === "ready") return resource.data;
  if (resource.status === "failed") return resource.last;
  return undefined;
}

export function useBotDialogLists(open: boolean) {
  const capabilities = listed(useCapabilities({ enabled: open }));
  const allConnections = listed(useConnections({ enabled: open }));
  const allSkills = listed(useSkills({ enabled: open }));
  const allGuests = listed(useGuests({ enabled: open }));

  const guests = useMemo(() => allGuests ?? [], [allGuests]);
  const skills = useMemo<SkillSummary[]>(
    () => (allSkills ?? []).map(({ id, name, description }) => ({ id, name, description })),
    [allSkills],
  );
  const connections = useMemo<ConnectionSummary[]>(
    () =>
      (allConnections ?? []).map(({ id, name, status, tools }) => ({
        id,
        name,
        status,
        toolCount: tools.filter((tool) => tool.enabled).length,
      })),
    [allConnections],
  );
  const toolkitsList = useMemo(
    () =>
      (capabilities ?? []).filter(
        (capability) =>
          capability.kind === "toolkit" &&
          !capability.auto &&
          (capability.tools.length > 0 || capability.setupHint),
      ),
    [capabilities],
  );
  const allTools = useMemo(
    () => toolkitsList.flatMap((toolkit) => (toolkit.setupHint ? [] : toolkit.tools)),
    [toolkitsList],
  );

  return { toolkitsList, allTools, connections, skills, guests };
}
