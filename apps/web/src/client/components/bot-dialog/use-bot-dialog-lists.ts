import { useEffect, useMemo, useState } from "react";
import type { CapabilityInfo } from "../../../shared/api/bots";
import type { ConnectionSummary } from "../../../shared/api/connections";
import type { Guest } from "../../../shared/api/people";
import type { SkillSummary } from "../../../shared/api/skills";
import { botsApi } from "../../lib/bots-api";
import { connectionsApi } from "../../lib/connections-api";
import { peopleApi } from "../../lib/people-api";
import { skillsApi } from "../../lib/skills-api";

/**
 * What the bot dialog offers, read each time it opens: the toolkits, the
 * connections, the skill library and the guests. A failed read leaves its
 * list as it was.
 */
export function useBotDialogLists(open: boolean) {
  const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([]);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);

  useEffect(() => {
    if (!open) return;
    void botsApi
      .capabilities()
      .then(setCapabilities)
      .catch(() => undefined);
    void skillsApi
      .list()
      .then((all) => setSkills(all.map(({ id, name, description }) => ({ id, name, description }))))
      .catch(() => undefined);
    void peopleApi
      .list()
      .then(({ guests: all }) => setGuests(all))
      .catch(() => undefined);
    void connectionsApi
      .list()
      .then((all) =>
        setConnections(
          all.map(({ id, name, status, tools }) => ({
            id,
            name,
            status,
            toolCount: tools.filter((tool) => tool.enabled).length,
          })),
        ),
      )
      .catch(() => undefined);
  }, [open]);

  // Every bot has every toolkit; the app switches the automatic ones (vision,
  // tool search, today's date) on its own, so they are not shown.
  const toolkitsList = useMemo(
    () =>
      capabilities.filter(
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
