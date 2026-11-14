import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setDefaultTheme, initTheme } from "@groot/shell/lib/theme";
import { ShellQueryProvider, createShellQueryClient } from "@groot/shell/lib/query-client";
import App from "./App";
import { installFeedbackDismiss, installFeedbackLabels } from "./lib/feedback";
// Inter loads from JS, not from the shell CSS: an @import there is inlined by
// Tailwind before Vite sees it, so the fonts' relative url()s were never
// emitted and production served index.html in their place (issue #82).
import "@fontsource-variable/inter";
import "@groot/shell/index.css";
import "streamdown/styles.css";
import "./app.css";

// After a deploy, a tab still running the old bundle asks for chunks that no
// longer exist. Reload once to pick up the new build instead of breaking.
window.addEventListener("vite:preloadError", (event) => {
  try {
    if (sessionStorage.getItem("chunk-reload") === "1") return;
    sessionStorage.setItem("chunk-reload", "1");
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});
// Re-arm only once this build has run for a while, so a chunk that fails
// right after boot cannot reload in a loop.
window.setTimeout(() => {
  try {
    sessionStorage.removeItem("chunk-reload");
  } catch {
    // Storage blocked: nothing to clear.
  }
}, 10_000);

// tiny-agents stays dark unless the user picks otherwise (PRD §6.1).
setDefaultTheme("dark");
// Apply before first render — no theme flash.
initTheme();
// The FeedbackBee panel closes on an outside click, like the app's modals.
installFeedbackDismiss();
installFeedbackLabels();

// The shell owns the query defaults and resets the cache on every sign-in and
// sign-out; tiny-agents keeps one mutation retry on top of them.
const queryClient = createShellQueryClient({ mutations: { retry: 1 } });

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ShellQueryProvider client={queryClient}>
      <App />
    </ShellQueryProvider>
  </StrictMode>,
);
