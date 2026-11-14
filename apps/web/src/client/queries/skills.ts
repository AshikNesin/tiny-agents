/** The Skills pages' resources: the library, one skill, and their writes (`lib/skills-api.ts`). */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Skill,
  SkillCreateBody,
  SkillPreviewBody,
  SkillUpdateBody,
} from "../../shared/api/skills";
import { skillsApi } from "../lib/skills-api";
import { RESOURCE_MUTATION, useResource } from "./resource";

const SKILLS_KEY = ["skills", "list"] as const;
const skillKey = (id: string) => ["skills", "detail", id] as const;

export const useSkills = () =>
  useResource(SKILLS_KEY, () => skillsApi.list(), "Failed to load skills");

/** One skill; another id starts over from its loading state. */
export const useSkill = (id: string) =>
  useResource(skillKey(id), () => skillsApi.get(id), "Failed to load skill");

/** Show `update` on the skill's page at once, without a fetch: a write's answer, or an optimistic change. */
export function useSetSkill(id: string) {
  const client = useQueryClient();
  return (update: Skill | ((skill: Skill) => Skill)) =>
    client.setQueryData<Skill>(skillKey(id), (current) =>
      typeof update === "function" ? (current ? update(current) : current) : update,
    );
}

/**
 * The skill writes. None refetches: a create opens the new skill's page, and
 * its page shows what each write answers (`useSetSkill`). Each marks the
 * library out of date, without reading it again.
 */
export function useSkillMutations() {
  const client = useQueryClient();
  const libraryChanged = () =>
    client.invalidateQueries({ queryKey: SKILLS_KEY, refetchType: "none" });
  const create = useMutation({
    mutationFn: (input: SkillCreateBody) => skillsApi.create(input),
    onSuccess: libraryChanged,
    ...RESOURCE_MUTATION,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: SkillUpdateBody }) =>
      skillsApi.update(id, input),
    onSuccess: libraryChanged,
    ...RESOURCE_MUTATION,
  });
  const remove = useMutation({
    mutationFn: (id: string) => skillsApi.remove(id),
    onSuccess: libraryChanged,
    ...RESOURCE_MUTATION,
  });
  /** Parse a pasted SKILL.md or a GitHub folder; nothing is saved. */
  const preview = useMutation({
    mutationFn: (input: SkillPreviewBody) => skillsApi.preview(input),
    ...RESOURCE_MUTATION,
  });
  return { create, update, remove, preview };
}
