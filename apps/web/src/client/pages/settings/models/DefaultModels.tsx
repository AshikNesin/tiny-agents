import { useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@groot/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@groot/ui/card";
import { Text } from "@groot/ui/typography";
import { errorMessage } from "../../../lib/errors";
import type { Account, ModelRole, Roles } from "../../../../shared/api/models";
import { useModelMutations } from "../../../queries/models";
import { ModelPicker, type ModelPickerOption } from "../../../components/ModelPicker";
import { ROLE_LABEL, ROLES } from "./model-labels";
import { modelOptions } from "./model-options";

function fallbackLabel(options: ModelPickerOption[], modelId: string | null): string {
  const option = modelId ? options.find((o) => o.id === modelId) : undefined;
  if (!option) return modelId ? "Default (fallback)" : "None";
  return `${option.group ? `${option.group} / ` : ""}${option.label} (fallback)`;
}

export function DefaultModels({
  accounts,
  roles,
  onChanged,
}: {
  accounts: Account[];
  roles: Roles | null;
  onChanged: () => void;
}) {
  const chat = useMemo(() => modelOptions(accounts), [accounts]);
  const classifiers = useMemo(() => modelOptions(accounts, "classifier"), [accounts]);
  const { setRoles } = useModelMutations();
  const setRole = async (role: ModelRole, modelId: string | null) => {
    try {
      await setRoles.mutateAsync({ [role]: modelId });
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't set the model"));
    }
  };
  if (!roles) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Default models</CardTitle>
        <CardDescription>
          Which model each feature uses. Unset ones follow their fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {ROLES.map((role) => {
          const options = role === "classifier" ? classifiers : chat;
          const current = roles[role];
          const label = ROLE_LABEL[role];
          return (
            <div
              key={role}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center"
            >
              <div className="min-w-0">
                <Text variant="body" className="block font-medium">
                  {label.title}
                </Text>
                <Text variant="meta" className="block">
                  {label.description}
                </Text>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <ModelPicker
                  className="min-w-0 flex-1"
                  value={current.fallback ? "" : (current.modelId ?? "")}
                  options={options}
                  onChange={(value) => setRole(role, value)}
                  label={label.title}
                  placeholder={fallbackLabel(options, current.modelId)}
                />
                {!current.fallback && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setRole(role, null)}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
