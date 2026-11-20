import type { ReactNode } from "react";
import type { ToasterProps } from "sonner";
import { ConfirmProvider } from "./primitives/confirm";
import { Toaster } from "./sonner";

export function GrootUIProvider({
  children,
  toaster,
}: {
  children: ReactNode;
  toaster?: ToasterProps;
}) {
  return (
    <ConfirmProvider>
      {children}
      <Toaster {...toaster} />
    </ConfirmProvider>
  );
}
