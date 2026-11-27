import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Search, Sparkles } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Card } from "@groot/ui/card";
import { EmptyState } from "@groot/ui/empty-state";
import { listRowClass } from "@groot/ui/list-row";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import type { Skill } from "../../../shared/api/skills";
import { useSkills } from "../../queries/skills";
import { ResourceView } from "../../components/ResourceView";
import { CreateSkillDialog } from "../../components/skills/CreateSkillDialog";
import { ImportSkillDialog } from "../../components/skills/ImportSkillDialog";
import { SkillDetail } from "./SkillDetail";

export function SkillsPage() {
  const { id } = useParams();
  return id ? <SkillDetail id={id} /> : <SkillsList />;
}

function SkillsList() {
  const navigate = useNavigate();
  const resource = useSkills();
  const skills =
    resource.status === "ready"
      ? resource.data
      : resource.status === "failed"
        ? (resource.last ?? null)
        : null;
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const matching = (all: Skill[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q),
    );
  };

  const onCreated = (skill: Skill) => {
    setCreateOpen(false);
    setImportOpen(false);
    navigate(`/skills/${skill.id}`);
  };

  return (
    <PageLayout
      title="Skills"
      description="Reusable instructions your bots load when a task needs them."
      maxWidth="4xl"
      actions={
        <>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            Import
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New skill
          </Button>
        </>
      }
    >
      {skills !== null && skills.length > 0 && (
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills"
          aria-label="Search skills"
          maxLength={200}
        />
      )}

      <ResourceView resource={resource} failedTitle="Couldn't load skills">
        {(all) => {
          const filtered = matching(all);
          return filtered.length === 0 ? (
            all.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="No skills yet"
                description="Write a skill from scratch, or paste a SKILL.md to import one."
              />
            ) : (
              <EmptyState
                icon={Search}
                title="No matching skills"
                description={`Nothing matches "${query.trim()}". Try a different search.`}
              />
            )
          ) : (
            <Card className="divide-y overflow-hidden p-0">
              <ul role="list">
                {filtered.map((skill) => (
                  <li key={skill.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/skills/${skill.id}`)}
                      className={cn(listRowClass, "w-full text-left")}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{skill.name}</p>
                        <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
                          {skill.description}
                        </p>
                        <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 text-xs">
                          <span>{skill.source === "url" ? "imported" : "manual"}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            used by {skill.botIds.length}{" "}
                            {skill.botIds.length === 1 ? "bot" : "bots"}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>updated {formatRelativeTime(skill.updatedAt)}</span>
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          );
        }}
      </ResourceView>

      <CreateSkillDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} />
      <ImportSkillDialog open={importOpen} onOpenChange={setImportOpen} onInstalled={onCreated} />
    </PageLayout>
  );
}
