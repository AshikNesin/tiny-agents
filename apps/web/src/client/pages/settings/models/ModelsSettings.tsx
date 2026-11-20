import { useMemo, useState } from "react";
import { Bot, Plus } from "lucide-react";
import { Button } from "@groot/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@groot/ui/card";
import { EmptyState } from "@groot/ui/empty-state";
import { StepUpProvider } from "../../../components/vault/StepUp";
import type { Account, ProviderTemplate } from "../../../../shared/api/models";
import { useModelSettings } from "../../../queries/models";
import { useBotsStore } from "../../../store/bots";
import { AccountCard } from "./AccountCard";
import { AddModelsDialog } from "./AddModelsDialog";
import { DefaultModels } from "./DefaultModels";
import { EditConnectionDialog } from "./EditConnectionDialog";

function ModelsSettingsBody() {
  const loadModels = useBotsStore((s) => s.loadModels);
  const { data, refresh: reload } = useModelSettings(loadModels);
  const accounts = data?.accounts ?? null;
  const templates = useMemo(() => data?.templates ?? [], [data]);
  const roles = data?.roles ?? null;
  const [adding, setAdding] = useState<{ template?: ProviderTemplate } | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);

  const real = useMemo(() => (accounts ?? []).filter((a) => a.kind !== "faux"), [accounts]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Model providers</CardTitle>
          <CardDescription>
            Accounts your bots reach models through. Keys are kept in the vault, used by the app
            only.
          </CardDescription>
          <CardAction>
            <Button onClick={() => setAdding({})}>
              <Plus className="size-4" />
              Add models
            </Button>
          </CardAction>
        </CardHeader>
        {accounts !== null && real.length === 0 && (
          <CardContent>
            <EmptyState
              icon={Bot}
              title="No model is set up"
              description="Connect a provider to give your bots a model."
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {templates.map((template) => (
                <Button
                  key={template.id}
                  variant="outline"
                  className="justify-start"
                  onClick={() => setAdding({ template })}
                >
                  {template.label}
                </Button>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {(accounts ?? []).map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          accounts={accounts ?? []}
          onChanged={() => void reload()}
          onEdit={() => setEditing(account)}
        />
      ))}

      {accounts !== null && accounts.length > 0 && (
        <DefaultModels accounts={accounts} roles={roles} onChanged={() => void reload()} />
      )}

      <AddModelsDialog
        open={adding !== null}
        onOpenChange={(open) => !open && setAdding(null)}
        templates={templates}
        {...(adding?.template ? { template: adding.template } : {})}
        onAdded={() => void reload()}
      />
      {editing && (
        <EditConnectionDialog
          key={editing.id}
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
        />
      )}
    </div>
  );
}

export function ModelsSettings() {
  return (
    <StepUpProvider>
      <ModelsSettingsBody />
    </StepUpProvider>
  );
}
