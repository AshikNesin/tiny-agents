/**
 * A credential request's link (issue #56), `/vault/requests/<task>`, as push
 * notifications write it: the form lives on the asking bot's chat card, so
 * the link opens that chat scrolled to it. A request with no bot keeps the
 * form here.
 */
import { Navigate, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@groot/ui/card";
import { EmptyState } from "@groot/ui/empty-state";
import { monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { useCredentialRequest } from "../../queries/vault";
import { CredentialRequestForm } from "../../components/vault/CredentialRequestForm";

export function CredentialRequestSheet({ taskId }: { taskId: number }) {
  const navigate = useNavigate();
  const { data: request, loadError } = useCredentialRequest(taskId);
  const done = () => void navigate("/chats");

  if (loadError || !request) {
    return (
      <PageLayout title="Credential request" maxWidth="4xl" backTo="/chats">
        {loadError ? (
          <EmptyState icon={Lock} title="Nothing to fill" description={loadError} />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        )}
      </PageLayout>
    );
  }

  if (request.bot) {
    const focus = new URLSearchParams({ focus: `credentials:${taskId}` });
    return <Navigate replace to={`/chats/${encodeURIComponent(request.bot.id)}?${focus}`} />;
  }
  const botName = "A bot";

  return (
    <PageLayout title={request.title} maxWidth="4xl" backTo="/chats">
      <Card className="mx-auto w-full max-w-md">
        <CardContent className="space-y-5">
          <div className="space-y-1 text-center">
            <p className="text-xs text-muted-foreground">Only filled on</p>
            <p className={cn(monoClass, "text-base font-semibold break-all text-foreground")}>
              {request.origin}
            </p>
            {request.frameOrigin && (
              <p className="text-xs text-muted-foreground">
                in its sign-in frame from {request.frameOrigin}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {botName} asked: “{request.purpose}”
            </p>
          </div>

          <CredentialRequestForm taskId={taskId} request={request} onSettled={done} />
        </CardContent>
      </Card>
    </PageLayout>
  );
}
