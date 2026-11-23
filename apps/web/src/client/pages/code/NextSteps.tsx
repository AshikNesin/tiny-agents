import { Archive, Eye, GitMerge, GitPullRequest, Upload } from "lucide-react";
import { Button } from "@groot/ui";
import { Kbd } from "../../components/keys";
import { nextSteps, pullStage, type NextStepId } from "../../lib/code/pull-stage";
import { useThreadPulls } from "../../lib/code/use-thread-pulls";

const ICON: Record<NextStepId, typeof Archive> = {
  "create-pr": Upload,
  push: Upload,
  merge: GitMerge,
  review: Eye,
  "open-pr": GitPullRequest,
  archive: Archive,
};

const KEY: Partial<Record<NextStepId, string>> = { "create-pr": "P", push: "P", merge: "M" };

export function NextSteps({
  threadId,
  refreshKey,
  onStep,
}: {
  threadId: string;
  refreshKey: unknown;
  onStep(step: NextStepId): void;
}) {
  const { view } = useThreadPulls(threadId, { refreshKey, fresh: false });
  const steps = view ? nextSteps(pullStage(view)) : [];
  if (steps.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1" data-testid="code-next-steps">
      {steps.map((step) => {
        const Icon = ICON[step.id];
        const key = KEY[step.id];
        return (
          <Button
            key={step.id}
            size="sm"
            variant={step.primary ? "default" : "outline"}
            onClick={() => onStep(step.id)}
          >
            <Icon />
            {step.label}
            {key && <Kbd keys={key} className="ml-0.5" />}
          </Button>
        );
      })}
    </div>
  );
}
