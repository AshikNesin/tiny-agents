import type { ReactNode } from "react";
import { Button } from "@groot/ui/button";
import { ErrorState } from "@groot/ui/empty-state";
import type { Resource } from "../queries/resource";

interface ResourceViewProps<T> {
  resource: Resource<T>;
  failedTitle: string;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}

export function ResourceView<T>({
  resource,
  failedTitle,
  loading,
  children,
}: ResourceViewProps<T>) {
  if (resource.status === "failed") {
    return (
      <ErrorState
        title={failedTitle}
        description={resource.loadError}
        action={
          <Button variant="outline" onClick={() => void resource.refresh()}>
            Retry
          </Button>
        }
      />
    );
  }
  if (resource.status === "loading") {
    return loading ?? <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>;
  }
  return children(resource.data);
}
