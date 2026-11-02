import { AppSettings } from "@groot/shell/components/AppSettings";
import { NotificationSettings } from "@groot/shell/components/NotificationSettings";
import { PasskeyManager } from "@groot/shell/components/PasskeyManager";
import { ThemeSettings } from "@groot/shell/components/ThemeSettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@groot/ui/tabs";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { Bell, Settings as SettingsIcon, ShieldCheck, Sparkles } from "lucide-react";
import { ClaudePlanStatusCard } from "../../components/ClaudePlanStatus";

/** App settings, plus the Claude plan status card. No credential fields. */
export function SettingsPage() {
  return (
    <PageLayout
      title="Settings"
      description="Manage your application preferences, configuration, and security."
      maxWidth="5xl"
    >
      {/* At ~390px the four line tabs don't fit. max-w-full + overflow-x-auto
          scrolls them; justify-start because the strip's justify-center would
          center the overflow (first tab bleeds left, unreachable). */}
      <Tabs defaultValue="general">
        <TabsList variant="line" className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="general">
            <SettingsIcon className="size-4" />
            General
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="size-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="security">
            <ShieldCheck className="size-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="claude">
            <Sparkles className="size-4" />
            Claude plan
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6">
          <div className="space-y-6">
            <ThemeSettings />
            <AppSettings />
          </div>
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <NotificationSettings />
        </TabsContent>

        <TabsContent value="security" className="mt-6">
          <PasskeyManager />
        </TabsContent>

        <TabsContent value="claude" className="mt-6">
          <ClaudePlanStatusCard />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
