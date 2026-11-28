import { splitToolPicks } from "../../../shared/tool-picks";
import { sentToolName } from "../../lib/slash-menu";
import { useState } from "react";
import { GitBranch, GitPullRequest, MessageSquare, Wrench } from "lucide-react";
import { Button, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { USER_PILL } from "../../components/ui/transcript-parts";
import { codeApi, type AssetRef } from "../../lib/code/api";
import { parseReviewMessage, type SentComment } from "../../lib/code/comments";
import {
  parseAutofixRequest,
  splitProjectPreamble,
  splitReviewCard,
} from "../../../shared/code-messages";
import { Images } from "./ToolOutput";

export function Attachments({ assets, instanceId }: { assets: AssetRef[]; instanceId: string }) {
  if (assets.length === 0) return null;
  const images = assets.filter((a) => a.image);
  const files = assets.filter((a) => !a.image);
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-1">
      <Images assets={images} instanceId={instanceId} />
      {files.map((a) => (
        <a
          key={a.ref}
          href={codeApi.assetUrl(instanceId, a.ref)}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "text-muted-foreground hover:text-foreground truncate text-xs underline",
            monoClass,
          )}
        >
          {a.name}
        </a>
      ))}
    </div>
  );
}

export function UserText({ text: sent }: { text: string }) {
  const project = splitProjectPreamble(sent);
  const review = project ? null : splitReviewCard(sent);
  const full = project ? project.message : review ? review.message : sent;
  const skills = /^(?:\/[a-z0-9-]+ )+/.exec(full)?.[0] ?? "";
  const picks = splitToolPicks(full.slice(skills.length));
  const text = picks.tools.length > 0 ? `${skills}${picks.text}` : full;
  return (
    <>
      {review && (
        <p
          aria-label="Pull request"
          className={cn(
            "text-muted-foreground flex max-w-full items-center gap-1.5 text-xs",
            monoClass,
          )}
        >
          <GitPullRequest className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            Reviewing{" "}
            <span className="text-foreground">
              {review.repo}#{review.number}
            </span>
          </span>
        </p>
      )}
      {project && (
        <p
          aria-label="Branch"
          className={cn(
            "text-muted-foreground flex max-w-full items-center gap-1.5 text-xs",
            monoClass,
          )}
        >
          <GitBranch className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            <span className="text-foreground">{project.branch}</span> from {project.base}
          </span>
          {project.setupFailed && (
            <span className="text-warning shrink-0">· setup script failed</span>
          )}
        </p>
      )}
      {picks.tools.length > 0 && (
        <ul aria-label="Tools asked for" className="flex max-w-full flex-wrap justify-end gap-1">
          {picks.tools.map((name) => (
            <li
              key={name}
              className="bg-muted text-muted-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            >
              <Wrench className="size-3" aria-hidden />
              {sentToolName(name)}
            </li>
          ))}
        </ul>
      )}
      <MessageText text={text} />
    </>
  );
}

function MessageText({ text }: { text: string }) {
  if (!text) return null;
  const autofix = parseAutofixRequest(text);
  if (autofix) return <AutofixCard kind={autofix.kind} items={autofix.items} text={text} />;
  const review = parseReviewMessage(text);
  if (!review) {
    return (
      <div
        className={cn(
          USER_PILL,
          "max-w-[85%] rounded-xl text-sm leading-[22px] whitespace-pre-wrap",
        )}
      >
        {text}
      </div>
    );
  }
  return (
    <>
      <div className="flex w-full max-w-[85%] flex-col gap-1.5">
        {review.comments.map((comment) => (
          <SentCommentCard
            key={`${comment.path}:${comment.lines}:${comment.body}`}
            comment={comment}
          />
        ))}
      </div>
      {review.message && (
        <div
          className={cn(
            USER_PILL,
            "max-w-[85%] rounded-xl text-sm leading-[22px] whitespace-pre-wrap",
          )}
        >
          {review.message}
        </div>
      )}
    </>
  );
}

function AutofixCard({
  kind,
  items,
  text,
}: {
  kind: "pass" | "final";
  items: Array<{ id: string; title: string }>;
  text: string;
}) {
  const [open, setOpen] = useState(false);
  const title = kind === "final" ? "Auto-fix final check" : "Auto-fix pass";
  return (
    <article
      aria-label={title}
      className="ring-foreground/10 bg-card w-full max-w-[85%] overflow-hidden rounded-xl text-sm ring-1"
    >
      <header className="flex items-center gap-1.5 px-3 pt-2 text-xs">
        <Wrench className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <span className="font-medium">{title}</span>
        <span className="flex-1" />
        <Button
          size="xs"
          variant="ghost"
          className="text-muted-foreground -mr-1.5"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? "Hide the full request" : "Show the full request"}
        </Button>
      </header>
      {items.length > 0 ? (
        <ul className="space-y-0.5 px-3 pt-1 pb-2">
          {items.map((item) => (
            <li key={item.id} className="truncate" title={item.title}>
              {item.title}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground px-3 pt-1 pb-2">
          {kind === "final"
            ? "A last review of the whole change, now that the checks are green."
            : "Fix what the checks and reviewers report."}
        </p>
      )}
      {open && (
        <pre
          className={cn(
            "text-muted-foreground border-border max-h-96 overflow-y-auto border-t px-3 py-2 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]",
            monoClass,
          )}
        >
          {text}
        </pre>
      )}
    </article>
  );
}

function SentCommentCard({ comment }: { comment: SentComment }) {
  return (
    <article className="ring-foreground/10 bg-card overflow-hidden rounded-xl text-sm ring-1">
      <header className="text-muted-foreground flex items-center gap-1.5 px-3 pt-2 text-xs">
        <MessageSquare className="size-3.5 shrink-0" aria-hidden />
        <span className={cn("min-w-0 truncate", monoClass)}>
          {comment.path}:{comment.lines}
          {comment.old && " (removed)"}
        </span>
      </header>
      {comment.quote && (
        <pre
          className={cn(
            "text-muted-foreground border-border mx-3 mt-1.5 line-clamp-4 border-l-2 pl-2 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]",
            monoClass,
          )}
        >
          {comment.quote}
        </pre>
      )}
      <p className="px-3 pt-1.5 pb-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {comment.body}
      </p>
    </article>
  );
}
