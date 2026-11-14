/**
 * React Query for a test that renders a page or dialog on its own, as
 * `main.tsx` mounts it for the app: the shell's client with the app's one
 * mutation retry, so a resource's own options are what the test exercises.
 * Each mount gets a fresh cache.
 */
import React, { useState, type ReactNode } from "react";
import { createShellQueryClient, ShellQueryProvider } from "@groot/shell/lib/query-client";

export function AppQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => createShellQueryClient({ mutations: { retry: 1 } }));
  return <ShellQueryProvider client={client}>{children}</ShellQueryProvider>;
}
