import {
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
} from "react-router-dom";
import { useEffect, useMemo, type ReactNode } from "react";
import { NuqsAdapter } from "nuqs/adapters/react-router";
import { useAuthStore } from "@groot/shell/store/auth";
import { ProtectedRoute } from "@groot/shell/components/ProtectedRoute";
import { Tasks } from "./pages/tasks/Tasks";
import { Routines } from "./pages/routines/Routines";
import { ChatWorkspace } from "./pages/chats/ChatsLayout";
import { Storage } from "@groot/shell/pages/storage/Storage";
import { Jobs, JobDetail } from "@groot/jobs/client";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { Login } from "@groot/shell/pages/auth/Login";
import { Setup } from "@groot/shell/pages/auth/Setup";
import { GrootUIProvider } from "@groot/ui";
import { ShellProvider, type ShellConfig } from "@groot/shell/lib/shell-config";
import { BotMessageSquare, History, Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import { SkillsPage } from "./pages/skills/Skills";
import { MemoryPage } from "./pages/memory";
import { ConnectionsPage } from "./pages/connections/Connections";
import { VaultPage } from "./pages/vault/Vault";
import { TerminalPage } from "./pages/terminal";
import { ComputerPage } from "./pages/computer";
import { CodePage } from "./pages/code";
import { AppShell } from "./components/shell/AppShell";
import { BrandMark } from "./components/shell/BrandMark";
import { APP_NAV, GUEST_PAGES, guestNav } from "./components/shell/nav";
import { useUiStore } from "./store/ui";
import { usePeopleStore, useIsGuest } from "./store/people";

/** Brand + login copy + profile-menu nav, in one place (ShellProvider). */
const SHELL_CONFIG: ShellConfig = {
  brand: { label: "tiny-agents", icon: BrandMark, to: "/chats" },
  // Phones open the app's sidebar as a drawer from every page's menu button.
  openNav: () => useUiStore.getState().setMobileOpen(true),
  nav: [...APP_NAV, { label: "Settings", icon: SettingsIcon, to: "/settings" }],
  login: {
    tagline: "Your team of always-on agents.",
    description:
      "Every contact is an AI bot you chat with — durable conversations that survive refreshes, crashes and redeploys.",
    features: [
      {
        icon: BotMessageSquare,
        title: "Bots that remember",
        desc: "One continuous conversation per bot, kept forever.",
      },
      {
        icon: History,
        title: "Durable by default",
        desc: "Replies resume mid-stream after restarts.",
      },
      {
        icon: ShieldCheck,
        title: "Yours alone",
        desc: "Single-owner app with passkey or password login.",
      },
    ],
  },
};

/**
 * Toasts sit at the top: bottom-right put them over the chat composer's
 * Send/Stop button, swallowing clicks for the few seconds they show.
 */
const TOASTER = { position: "top-center" } as const;

/** Providers that need the router (nuqs reads and writes the URL). */
function Root() {
  // A guest's profile menu lists only what they may open (issue #145).
  const guest = useIsGuest();
  const config = useMemo<ShellConfig>(
    () =>
      guest
        ? {
            ...SHELL_CONFIG,
            nav: [...guestNav(APP_NAV), { label: "Settings", icon: SettingsIcon, to: "/settings" }],
          }
        : SHELL_CONFIG,
    [guest],
  );
  return (
    <NuqsAdapter>
      <GrootUIProvider toaster={TOASTER}>
        <ShellProvider config={config}>
          <Outlet />
        </ShellProvider>
      </GrootUIProvider>
    </NuqsAdapter>
  );
}

/**
 * The owner's pages: a guest (issue #145) is sent to their chats instead.
 * The server refuses a guest everything here anyway; this keeps the shell
 * from showing a page full of errors.
 */
function OwnerOnly({ children }: { children: ReactNode }) {
  const guest = usePeopleStore((s) => s.guest);
  if (guest === true) return <Navigate to="/chats" replace />;
  return children;
}

/** Wrap a page element as owner-only unless guests may open it. */
function page(path: string, element: ReactNode) {
  const open = GUEST_PAGES.some((to) => path === to || path.startsWith(`${to}/`));
  return (
    <Route key={path} path={path} element={open ? element : <OwnerOnly>{element}</OwnerOnly>} />
  );
}

// A data router, so pages can hold navigation while they have unsaved edits
// (useBlocker).
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Root />}>
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<Setup />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/chats" replace />} />
        <Route path="/chats" element={<ChatWorkspace />} />
        <Route path="/chats/:botId" element={<ChatWorkspace />} />
        <Route path="/chats/:botId/history/:chatId" element={<ChatWorkspace />} />
        {page("/tasks", <Tasks />)}
        {page("/terminal", <TerminalPage />)}
        {page("/computer", <ComputerPage />)}
        {page("/code", <CodePage />)}
        {page("/code/new", <CodePage />)}
        {page("/code/s/:slug", <CodePage />)}
        {page("/code/:conversationId", <CodePage />)}
        {page("/code/:conversationId/changes", <CodePage />)}
        {page("/routines", <Routines />)}
        {page("/skills", <SkillsPage />)}
        {page("/skills/:id", <SkillsPage />)}
        {page("/memory", <MemoryPage />)}
        {page("/connections", <ConnectionsPage />)}
        {page("/connections/:id", <ConnectionsPage />)}
        {page("/connections/:id/tools/:tool", <ConnectionsPage />)}
        {page("/vault", <VaultPage />)}
        {page("/vault/new/:kind", <VaultPage />)}
        {page("/vault/items/:handle", <VaultPage />)}
        {page("/vault/requests/:taskId", <VaultPage />)}
        {page("/storage", <Storage />)}
        {page("/jobs", <Jobs />)}
        {page("/jobs/:queueName/:jobId", <JobDetail />)}
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>,
  ),
);

function App() {
  const checkAuth = useAuthStore((state) => state.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return <RouterProvider router={router} />;
}

export default App;
