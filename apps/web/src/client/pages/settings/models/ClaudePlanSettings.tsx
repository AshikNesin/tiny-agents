/** A Claude plan account's own settings: its fallback model and max turns. */
import { useState } from "react";
import { Checkbox } from "@groot/ui/checkbox";
import { Field } from "@groot/ui/form";
import { Input } from "@groot/ui/input";
import { Label } from "@groot/ui/label";
import type { Account } from "../../../../shared/api/models";
import { ModelPicker, type ModelPickerOption } from "../../../components/ModelPicker";

export function ClaudePlanFallback({
  account,
  options,
  onSet,
}: {
  account: Account;
  options: ModelPickerOption[];
  onSet: (modelId: string | null) => void;
}) {
  const current =
    typeof account.settings.fallbackModelId === "string"
      ? account.settings.fallbackModelId
      : "none";
  return (
    <Field
      label="Fallback model"
      hint="Where a turn goes when the plan is off or the sandbox is unreachable. None: the turn pauses."
    >
      <ModelPicker
        value={current}
        options={[{ id: "none", label: "None: pause the turn" }, ...options]}
        onChange={(value) => onSet(value === "none" ? null : value)}
        label="Fallback model"
      />
    </Field>
  );
}

/** The worker's default `maxTurns` when the account sets none. */
const DEFAULT_MAX_TURNS = 100;

/**
 * How many steps (each tool call is one) Claude Code may take in one reply
 * before it stops with "Reached maximum number of turns". Saved on blur or
 * Enter; blank goes back to the default. "No limit" is opt-in: a reply then
 * runs until it finishes or is stopped.
 */
export function ClaudePlanMaxTurns({
  account,
  onSet,
}: {
  account: Account;
  onSet: (maxTurns: number | "unlimited" | null) => void;
}) {
  const stored = account.settings.maxTurns;
  const unlimited = stored === "unlimited";
  const saved = typeof stored === "number" ? stored : null;
  const [value, setValue] = useState(saved === null ? "" : String(saved));
  const trimmed = value.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 1_000);
  const save = () => {
    if (!unlimited && valid && parsed !== saved) onSet(parsed);
  };
  const inputId = `max-turns-${account.id}`;
  const unlimitedId = `max-turns-unlimited-${account.id}`;
  return (
    <Field
      label="Max turns"
      htmlFor={inputId}
      hint={
        unlimited ? (
          "No limit: a reply runs until it finishes or you stop it, and holds the one Claude reply that can run at a time."
        ) : valid ? (
          `Steps Claude may take in one reply; each tool call is one. Blank: ${DEFAULT_MAX_TURNS}. Up to 1,000.`
        ) : (
          <span className="text-destructive">A whole number from 1 to 1,000.</span>
        )
      }
    >
      <div className="flex items-center gap-4">
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={1}
          max={1_000}
          placeholder={String(DEFAULT_MAX_TURNS)}
          className="w-32"
          disabled={unlimited}
          value={unlimited ? "" : value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id={unlimitedId}
            checked={unlimited}
            onCheckedChange={(checked) =>
              onSet(checked === true ? "unlimited" : valid ? parsed : null)
            }
          />
          <Label htmlFor={unlimitedId} className="font-normal">
            No limit
          </Label>
        </div>
      </div>
    </Field>
  );
}
