import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { NuqsAdapter } from "nuqs/adapters/react-router";
import { useAuthStore } from "@groot/shell/store/auth";
import { ProtectedRoute } from "@groot/shell/components/ProtectedRoute";
import { Layout } from "@groot/shell/components/Layout";
import type { NavItem } from "@groot/shell/components/Layout";
import { Todos } from "./pages/todo/Todos";
import { ChatWorkspace } from "./pages/chats/ChatsLayout";
import { Storage } from "@groot/shell/pages/storage/Storage";
import { Jobs, JobDetail } from "@groot/jobs/client";
import { Settings } from "@groot/shell/pages/settings/Settings";
import { Login } from "@groot/shell/pages/auth/Login";
import { GrootUIProvider } from "@groot/ui";
import { MessageSquare, Bot } from "lucide-react";

/** Shell instance for the chat workspace (unpadded, full-height main). */
function ChatsShell() {
  return (
    <Layout
      navItems={NAV_ITEMS}
      brand={BRAND}
      padded={false}
      mainClassName="h-[calc(100dvh-3.5rem)] lg:h-dvh overflow-hidden"
    />
  );
}

/** tiny-agents replaces groot's demo Todos nav with Chats (PRD §6.2). */
const NAV_ITEMS: NavItem[] = [{ name: "Chats", href: "/chats", icon: MessageSquare }];
const BRAND = { label: "tiny-agents", icon: Bot, to: "/chats" };

function App() {
  const checkAuth = useAuthStore((state) => state.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <BrowserRouter>
      <NuqsAdapter>
        <GrootUIProvider>
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
              <Route path="todos" element={<Todos />} />
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
        </GrootUIProvider>
      </NuqsAdapter>
    </BrowserRouter>
  );
}

export default App;
