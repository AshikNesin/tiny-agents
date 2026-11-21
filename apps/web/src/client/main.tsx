import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setDefaultTheme, initTheme } from "@groot/shell/lib/theme";
import { ShellQueryProvider, createShellQueryClient } from "@groot/shell/lib/query-client";
import App from "./App";
import "@fontsource-variable/inter";
import "@groot/shell/index.css";
import "streamdown/styles.css";
import "./app.css";

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
window.setTimeout(() => {
  try {
    sessionStorage.removeItem("chunk-reload");
  } catch {}
}, 10_000);

setDefaultTheme("dark");
initTheme();

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
