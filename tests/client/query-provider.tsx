import React, { useState, type ReactNode } from "react";
import { createShellQueryClient, ShellQueryProvider } from "@groot/shell/lib/query-client";

export function AppQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => createShellQueryClient({ mutations: { retry: 1 } }));
  return <ShellQueryProvider client={client}>{children}</ShellQueryProvider>;
}
