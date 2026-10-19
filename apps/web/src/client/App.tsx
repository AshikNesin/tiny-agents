import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { NuqsAdapter } from "nuqs/adapters/react-router";
import { useAuthStore } from "@groot/shell/store/auth";
import { ProtectedRoute } from "@groot/shell/components/ProtectedRoute";
import { Layout } from "@groot/shell/components/Layout";
import type { CommandGroupEntry } from "@groot/shell/components/CommandPalette";
import { Tasks } from "./pages/tasks/Tasks";
import { Routines } from "./pages/routines/Routines";
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
  CalendarClock,
  History,
  ListTodo,
  MessageSquare,
  Plus,
  Plug,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { SkillsPage } from "./pages/skills/Skills";
import { ConnectionsPage } from "./pages/connections/Connections";
import { useBotsStore } from "./store/bots";

/** Bare shell for every authenticated page: no sidebar, no mobile bar —
 *  secondary pages render AppTopBar (circular back + title + profile) at
 *  the top of their content, matching the chats workspace chrome. */
function BareShell() {
  const commandGroups = useCommandGroups();

  return <Layout header={<span />} commandGroups={commandGroups} mainClassName="min-h-dvh" />;
}

/** Shell instance for the chat workspace: no sidebar, no mobile top bar —
 *  the workspace owns the whole viewport (Grok-style, PRD §6.2). A non-null
 *  `header` disables the default sidebar + mobile bar in Layout. */
function ChatsShell() {
  const commandGroups = useCommandGroups();

  return (
    <Layout
      header={<span />}
      commandGroups={commandGroups}
      padded={false}
      mainClassName="h-dvh overflow-hidden"
    />
  );
}

const NAVIGATION_COMMAND_GROUP: CommandGroupEntry = {
  heading: "Navigation",
  items: [
    { label: "Chats", icon: MessageSquare, onSelect: () => window.location.assign("/chats") },
    { label: "Tasks", icon: ListTodo, onSelect: () => window.location.assign("/tasks") },
    { label: "Routines", icon: CalendarClock, onSelect: () => window.location.assign("/routines") },
    { label: "Skills", icon: Sparkles, onSelect: () => window.location.assign("/skills") },
    { label: "Connections", icon: Plug, onSelect: () => window.location.assign("/connections") },
  ],
};

function useCommandGroups(): CommandGroupEntry[] {
  const bots = useBotsStore((state) => state.bots);

  return useMemo(() => {
    const botGroups: CommandGroupEntry[] =
      bots.length === 0
        ? []
        : [
            {
              heading: "Bots",
              items: bots.map((bot) => ({
                id: bot.id,
                label: bot.name,
                icon: Bot,
                onSelect: () => window.location.assign(`/chats/${bot.id}`),
              })),
            },
          ];

    return [
      {
        heading: "Actions",
        items: [
          {
            label: "New bot",
            icon: Plus,
            onSelect: () => window.location.assign("/chats?new=1"),
          },
        ],
      },
      ...botGroups,
      NAVIGATION_COMMAND_GROUP,
    ];
  }, [bots]);
}

/** Brand + login copy + profile-menu nav, in one place (ShellProvider). */
const SHELL_CONFIG: ShellConfig = {
  brand: { label: "tiny-agents", icon: Bot, to: "/chats" },
  nav: [
    { label: "Tasks", icon: ListTodo, to: "/tasks" },
    { label: "Routines", icon: CalendarClock, to: "/routines" },
    { label: "Skills", icon: Sparkles, to: "/skills" },
    { label: "Connections", icon: Plug, to: "/connections" },
    { label: "Settings", icon: SettingsIcon, to: "/settings" },
  ],
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
                    <BareShell />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/chats" replace />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="routines" element={<Routines />} />
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
