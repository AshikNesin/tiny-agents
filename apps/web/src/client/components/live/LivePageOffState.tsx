import { Button, EmptyState, ErrorState, LoadingSpinner } from "@groot/ui";
import type { PageItem, PageOffCopy } from "./surface";

export function OffState({
  off,
  kind,
  item,
  onOpen,
}: {
  off: PageOffCopy;
  kind: string;
  item: PageItem;
  onOpen: () => void;
}) {
  if (item.starting) {
    return (
      <EmptyState
        icon={off.icon}
        title={item.phase === "installing" ? off.installing.title : off.starting}
        description={
          item.phase === "installing" ? off.installing.description : "This takes a few seconds."
        }
        action={<LoadingSpinner size="sm" />}
        className="h-full py-6"
      />
    );
  }
  if (item.error) {
    return (
      <ErrorState
        title={off.failed}
        description={
          <span className="mx-auto block max-w-sm break-words" data-testid={`${kind}-page-error`}>
            {item.error}
          </span>
        }
        action={
          <Button size="sm" onClick={onOpen}>
            Try again
          </Button>
        }
        className="h-full py-6"
      />
    );
  }
  return (
    <EmptyState
      icon={off.icon}
      title={off.closed.title}
      description={off.closed.description}
      action={
        <Button size="sm" onClick={onOpen} data-testid={`${kind}-page-open`}>
          {off.closed.open}
        </Button>
      }
      className="h-full py-6"
    />
  );
}
