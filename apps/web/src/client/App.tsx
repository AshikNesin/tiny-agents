import {
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  createBrowserRouter,
  type RouteObject,
} from "react-router-dom";
import { useEffect, useMemo } from "react";
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
import { TraceDetailPage, TracesPage } from "./pages/traces";
import { ConnectionsPage } from "./pages/connections/Connections";
import { VaultPage } from "./pages/vault/Vault";
import { TerminalPage } from "./pages/terminal";
import { ComputerPage } from "./pages/computer";
import { BrowserPage } from "./pages/browser";
import { CodeWorkspace, LegacyThreadRedirect, OpenReviewLink } from "./pages/code";
import { AppShell } from "./components/shell/AppShell";
import { BrandMark } from "./components/shell/BrandMark";
import { APP_NAV, guestNav } from "./components/shell/nav";
import { isGuestPage } from "../shared/guest-access";
import { useUiStore } from "./store/ui";
import { useViewerRole } from "./store/people";

const SHELL_CONFIG: ShellConfig = {
  brand: { label: "tiny-agents", icon: BrandMark, to: "/chats" },
  openNav: () => useUiStore.getState().setMobileOpen(true),
  nav: [
    ...APP_NAV,
    {
      label: "Settings",
      icon: SettingsIcon,
      to: "/settings",
      fullPage: true,
      shortcut: "mod+,",
    },
  ],
  login: {
    tagline: "Your team of always-on agents.",
    description:
      "Every contact is an AI bot you chat with. Durable conversations that survive refreshes, crashes and redeploys.",
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

const TOASTER = { position: "top-center" } as const;

function Root() {
  const restricted = useViewerRole() !== "owner";
  const config = useMemo<ShellConfig>(
    () =>
      restricted
        ? {
            ...SHELL_CONFIG,
            nav: [
              ...guestNav(APP_NAV),
              {
                label: "Settings",
                icon: SettingsIcon,
                to: "/settings",
                fullPage: true,
                shortcut: "mod+,",
              },
            ],
          }
        : SHELL_CONFIG,
    [restricted],
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

function GuestGate() {
  const role = useViewerRole();
  const { pathname } = useLocation();
  if (role === "owner" || isGuestPage(pathname)) return <Outlet />;
  if (role === "guest") return <Navigate to="/chats" replace />;
  return null;
}

export const appRoutes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      { path: "/login", element: <Login /> },
      { path: "/setup", element: <Setup /> },
      {
        element: (
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        ),
        children: [
          {
            id: "guest-gate",
            element: <GuestGate />,
            children: [
              { path: "/", element: <Navigate to="/chats" replace /> },
              { path: "/chats", element: <ChatWorkspace /> },
              { path: "/chats/:botId", element: <ChatWorkspace /> },
              { path: "/chats/:botId/history/:chatId", element: <ChatWorkspace /> },
              { path: "/tasks", element: <Tasks /> },
              { path: "/terminal", element: <TerminalPage /> },
              { path: "/computer", element: <ComputerPage /> },
              { path: "/browser", element: <BrowserPage /> },
              { path: "/code", element: <CodeWorkspace /> },
              { path: "/code/new", element: <CodeWorkspace /> },
              { path: "/code/t/:threadId", element: <CodeWorkspace /> },
              { path: "/code/reviews", element: <CodeWorkspace /> },
              { path: "/code/reviews/:reviewId", element: <CodeWorkspace /> },
              { path: "/code/review", element: <OpenReviewLink /> },
              { path: "/code/review/:owner/:repo/:number", element: <OpenReviewLink /> },
              { path: "/code/review/:owner/:repo/pull/:number/*", element: <OpenReviewLink /> },
              { path: "/code/settings", element: <CodeWorkspace /> },
              { path: "/code/settings/:section", element: <CodeWorkspace /> },
              { path: "/code/settings/projects/:projectId", element: <CodeWorkspace /> },
              { path: "/code/:conversationId", element: <LegacyThreadRedirect /> },
              { path: "/code/:conversationId/changes", element: <LegacyThreadRedirect /> },
              { path: "/code/:conversationId/pr", element: <LegacyThreadRedirect /> },
              { path: "/code/:conversationId/review", element: <LegacyThreadRedirect /> },
              { path: "/routines", element: <Routines /> },
              { path: "/skills", element: <SkillsPage /> },
              { path: "/skills/:id", element: <SkillsPage /> },
              { path: "/memory", element: <MemoryPage /> },
              { path: "/traces", element: <TracesPage /> },
              { path: "/traces/:id", element: <TraceDetailPage /> },
              { path: "/connections", element: <ConnectionsPage /> },
              { path: "/connections/:id", element: <ConnectionsPage /> },
              { path: "/connections/:id/tools/:tool", element: <ConnectionsPage /> },
              { path: "/vault", element: <VaultPage /> },
              { path: "/vault/new/:kind", element: <VaultPage /> },
              { path: "/vault/items/:handle", element: <VaultPage /> },
              { path: "/vault/requests/:taskId", element: <VaultPage /> },
              { path: "/storage", element: <Storage /> },
              { path: "/jobs", element: <Jobs /> },
              { path: "/jobs/:jobId", element: <JobDetail /> },
              { path: "/jobs/:queueName/:jobId", element: <JobDetail /> },
              { path: "/settings/*", element: <SettingsPage /> },
            ],
          },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];

const router = createBrowserRouter(appRoutes);

function App() {
  const checkAuth = useAuthStore((state) => state.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return <RouterProvider router={router} />;
}

export default App;
