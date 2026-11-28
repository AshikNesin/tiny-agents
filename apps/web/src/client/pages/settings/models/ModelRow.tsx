import { Trash2 } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Checkbox } from "@groot/ui/checkbox";
import { monoClass, Text } from "@groot/ui/typography";
import type { AccountModel } from "../../../../shared/api/models";
import { formatTokens } from "../../../lib/format";

export function ModelRow({
  model,
  warning,
  onChange,
  onTest,
  onDelete,
}: {
  model: AccountModel;
  warning?: string | undefined;
  onChange: (input: { enabled: boolean }) => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  const chips = [
    model.type === "classifier" ? "classifier" : `${formatTokens(model.contextWindow)} context`,
    model.imageInput ? "images" : undefined,
    model.reasoning ? "reasoning" : undefined,
    model.missing ? "no longer listed" : undefined,
    model.usedBy
      ? `${model.usedBy} bot${model.usedBy === 1 ? "" : "s"} use${model.usedBy === 1 ? "s" : ""} this`
      : undefined,
  ].filter(Boolean);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <Checkbox
        aria-label={`Offer ${model.name} in the picker`}
        checked={model.enabled}
        onCheckedChange={(checked) => onChange({ enabled: checked === true })}
      />
      <div className="min-w-0 flex-1">
        <Text variant="body" className="block truncate">
          {model.name}
        </Text>
        <Text variant="meta" className="block truncate">
          <span className={monoClass}>{model.upstreamId}</span>
          {chips.length > 0 ? ` · ${chips.join(" · ")}` : ""}
        </Text>
        {warning && (
          <Text variant="meta" className="text-destructive block">
            {warning}
          </Text>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onTest}>
        Test
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${model.name}`} onClick={onDelete}>
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}
