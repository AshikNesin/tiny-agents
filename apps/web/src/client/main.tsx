import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setDefaultTheme, initTheme } from "@groot/shell/lib/theme";
import App from "./App";
import { installFeedbackDismiss } from "./lib/feedback";
// Inter loads from JS, not from the shell CSS: an @import there is inlined by
// Tailwind before Vite sees it, so the fonts' relative url()s were never
// emitted and production served index.html in their place (issue #82).
import "@fontsource-variable/inter";
import "@groot/shell/index.css";
import "streamdown/styles.css";
import "./app.css";

// tiny-agents stays dark unless the user picks otherwise (PRD §6.1).
setDefaultTheme("dark");
// Apply before first render — no theme flash.
initTheme();
// The FeedbackBee panel closes on an outside click, like the app's modals.
installFeedbackDismiss();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
    },
    mutations: {
      retry: 1,
    },
  },
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
