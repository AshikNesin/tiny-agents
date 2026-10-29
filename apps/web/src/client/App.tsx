import {
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
} from "react-router-dom";
import { useEffect } from "react";
import { NuqsAdapter } from "nuqs/adapters/react-router";
import { useAuthStore } from "@groot/shell/store/auth";
import { ProtectedRoute } from "@groot/shell/components/ProtectedRoute";
import { Tasks } from "./pages/tasks/Tasks";
import { Routines } from "./pages/routines/Routines";
import { ChatWorkspace } from "./pages/chats/ChatsLayout";
import { Storage } from "@groot/shell/pages/storage/Storage";
import { Jobs, JobDetail } from "@groot/jobs/client";
import { Settings } from "@groot/shell/pages/settings/Settings";
import { Login } from "@groot/shell/pages/auth/Login";
import { GrootUIProvider } from "@groot/ui";
import { ShellProvider, type ShellConfig } from "@groot/shell/lib/shell-config";
import { BotMessageSquare, History, Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import { SkillsPage } from "./pages/skills/Skills";
import { MemoryPage } from "./pages/memory";
import { ConnectionsPage } from "./pages/connections/Connections";
import { VaultPage } from "./pages/vault/Vault";
import { TerminalPage } from "./pages/terminal";
import { AppShell } from "./components/shell/AppShell";
import { BrandMark } from "./components/shell/BrandMark";
import { APP_NAV } from "./components/shell/nav";
import { useUiStore } from "./store/ui";

/** Brand + login copy + profile-menu nav, in one place (ShellProvider). */
const SHELL_CONFIG: ShellConfig = {
  brand: { label: "tiny-agents", icon: BrandMark, to: "/chats" },
  // Desktop navigation lives in the sidebar, which phones open as a drawer.
  pageChrome: "sidebar",
  // Phones open the same sidebar as a drawer from every page's menu button.
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

/** Providers that need the router (nuqs reads and writes the URL). */
function Root() {
  return (
    <NuqsAdapter>
      <GrootUIProvider>
        <ShellProvider config={SHELL_CONFIG}>
          <Outlet />
        </ShellProvider>
      </GrootUIProvider>
    </NuqsAdapter>
  );
}

// A data router, so pages can hold navigation while they have unsaved edits
// (useBlocker).
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Root />}>
      <Route path="/login" element={<Login />} />
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
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/terminal" element={<TerminalPage />} />
        <Route path="/routines" element={<Routines />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/skills/:id" element={<SkillsPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/connections/:id" element={<ConnectionsPage />} />
        <Route path="/connections/:id/tools/:tool" element={<ConnectionsPage />} />
        <Route path="/vault" element={<VaultPage />} />
        <Route path="/vault/new/:kind" element={<VaultPage />} />
        <Route path="/vault/items/:handle" element={<VaultPage />} />
        <Route path="/vault/requests/:taskId" element={<VaultPage />} />
        <Route path="/storage" element={<Storage />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/:queueName/:jobId" element={<JobDetail />} />
        <Route path="/settings" element={<Settings />} />
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
