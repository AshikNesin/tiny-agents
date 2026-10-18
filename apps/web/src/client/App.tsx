import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { NuqsAdapter } from "nuqs/adapters/react-router";
import { useAuthStore } from "@groot/shell/store/auth";
import { ProtectedRoute } from "@groot/shell/components/ProtectedRoute";
import { Layout } from "@groot/shell/components/Layout";
import type { NavItem } from "@groot/shell/components/Layout";
import type { CommandGroupEntry } from "@groot/shell/components/CommandPalette";
import { Tasks } from "./pages/tasks/Tasks";
import { ChatWorkspace } from "./pages/chats/ChatsLayout";
import { Storage } from "@groot/shell/pages/storage/Storage";
import { Jobs, JobDetail } from "@groot/jobs/client";
import { Settings } from "@groot/shell/pages/settings/Settings";
import { Login } from "@groot/shell/pages/auth/Login";
import { GrootUIProvider } from "@groot/ui";
import { ShellProvider, type ShellConfig } from "@groot/shell/lib/shell-config";
import {
  Bot,
  BotMessageSquare,
  History,
  ListTodo,
  MessageSquare,
  Plug,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { SkillsPage } from "./pages/skills/Skills";
import { ConnectionsPage } from "./pages/connections/Connections";

/** Shell instance for the chat workspace (unpadded, full-height main). */
function ChatsShell() {
  return (
    <Layout
      navItems={NAV_ITEMS}
      commandGroups={COMMAND_GROUPS}
      padded={false}
      mainClassName="h-[calc(100dvh-3.5rem)] lg:h-dvh overflow-hidden"
    />
  );
}

/** tiny-agents replaces groot's demo Todos nav with Chats (PRD §6.2). */
const NAV_ITEMS: NavItem[] = [
  { name: "Chats", href: "/chats", icon: MessageSquare },
  { name: "Tasks", href: "/tasks", icon: ListTodo },
  { name: "Skills", href: "/skills", icon: Sparkles },
  { name: "Connections", href: "/connections", icon: Plug },
];

/**
 * ⌘K palette entries for this app. Without these the shell falls back to
 * groot's demo groups (Dashboard/Todos/Storage/…) — routes tiny-agents
 * doesn't have, so every palette action dead-ended. The palette wants
 * LucideIcon components (not NavItem's string icon names), so mirror
 * NAV_ITEMS explicitly. `navigate` isn't reachable outside a component,
 * so entries assign `window.location`.
 */
const COMMAND_GROUPS: CommandGroupEntry[] = [
  {
    heading: "Navigation",
    items: [
      { label: "Chats", icon: MessageSquare, onSelect: () => window.location.assign("/chats") },
      { label: "Tasks", icon: ListTodo, onSelect: () => window.location.assign("/tasks") },
      { label: "Skills", icon: Sparkles, onSelect: () => window.location.assign("/skills") },
      { label: "Connections", icon: Plug, onSelect: () => window.location.assign("/connections") },
    ],
  },
];

/** Brand + login copy for the whole app, in one place (ShellProvider). */
const SHELL_CONFIG: ShellConfig = {
  brand: { label: "tiny-agents", icon: Bot, to: "/chats" },
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

function App() {
  const checkAuth = useAuthStore((state) => state.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <BrowserRouter>
      <NuqsAdapter>
        <GrootUIProvider>
          <ShellProvider config={SHELL_CONFIG}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout navItems={NAV_ITEMS} />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/chats" replace />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="skills" element={<SkillsPage />} />
                <Route path="skills/:id" element={<SkillsPage />} />
                <Route path="connections" element={<ConnectionsPage />} />
                <Route path="connections/:id" element={<ConnectionsPage />} />
                <Route path="storage" element={<Storage />} />
                <Route path="jobs" element={<Jobs />} />
                <Route path="jobs/:queueName/:jobId" element={<JobDetail />} />
                <Route path="settings" element={<Settings />} />
              </Route>
              {/* Chats get their own shell instance (not nested under the
                default Layout, which would stack two sidebars): unpadded,
                viewport-height main so the list and chat columns scroll
                independently (PRD §6.2). */}
              <Route
                path="/chats"
                element={
                  <ProtectedRoute>
                    <ChatsShell />
                  </ProtectedRoute>
                }
              >
                <Route index element={<ChatWorkspace />} />
                <Route path=":botId" element={<ChatWorkspace />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ShellProvider>
        </GrootUIProvider>
      </NuqsAdapter>
    </BrowserRouter>
  );
}

export default App;
