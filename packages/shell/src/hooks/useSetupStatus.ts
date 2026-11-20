import { useEffect, useState } from "react";
import { apiClient } from "@groot/shell/lib/api";
import type { SetupStatus } from "@groot/core/auth/auth.schema";

export function useSetupStatus(): boolean | undefined {
  const [needsSetup, setNeedsSetup] = useState<boolean>();

  useEffect(() => {
    let live = true;
    apiClient.get<SetupStatus>("/auth/setup").then(
      (status) => live && setNeedsSetup(status.needsSetup),
      () => live && setNeedsSetup(false),
    );
    return () => {
      live = false;
    };
  }, []);

  return needsSetup;
}
