import { useState, type ReactNode } from "react";
import { Input, monoClass, metaLabelClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Switch } from "@groot/ui/switch";

export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <div className="space-y-0.5 px-1">
        <h2 className={metaLabelClass}>{title}</h2>
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      <div className="border-border divide-border divide-y rounded-xl border">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  stack = false,
}: {
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  stack?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-x-6 gap-y-2 px-4 py-3",
        stack ? "flex-col" : "flex-col sm:flex-row sm:items-center",
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium">{label}</p>
        )}
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      <div className={cn("min-w-0", stack ? "w-full" : "shrink-0 sm:max-w-72")}>{children}</div>
    </div>
  );
}

export function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <SettingsRow label={label} description={description}>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </SettingsRow>
  );
}

interface TextFieldProps {
  id: string;
  value: string;
  onSave(next: string): false | void;
  placeholder?: string;
  mono?: boolean;
  required?: boolean;
  inputMode?: "numeric";
  className?: string;
}

export function TextField(props: TextFieldProps) {
  return <DraftField key={props.value} {...props} />;
}

function DraftField({
  id,
  value,
  onSave,
  placeholder,
  mono,
  required,
  inputMode,
  className,
}: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (next === value) return;
    if ((required && !next) || onSave(next) === false) setDraft(value);
  };
  return (
    <Input
      id={id}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value);
      }}
      placeholder={placeholder}
      inputMode={inputMode}
      autoComplete="off"
      className={cn("w-full sm:w-72", mono && monoClass, className)}
    />
  );
}

export const list = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
