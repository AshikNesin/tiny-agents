import * as React from "react";
import {
  Controller,
  FormProvider,
  useForm,
  useFormContext,
  type DefaultValues,
  type FieldValues,
  type FieldPath,
  type SubmitHandler,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import { cn } from "./lib/utils";
import { Label } from "./label";

interface FormProps<TValues extends FieldValues> extends Omit<
  React.ComponentProps<"form">,
  "onSubmit"
> {
  schema: z.ZodType<TValues, TValues>;
  defaultValues: TValues;
  onSubmit: (values: TValues) => void | Promise<void>;
}

function FormRoot<TValues extends FieldValues>({
  schema,
  defaultValues,
  onSubmit,
  className,
  ...props
}: FormProps<TValues>) {
  const form = useForm<TValues>({
    resolver: zodResolver<TValues, unknown, TValues>(schema),
    defaultValues: defaultValues as DefaultValues<TValues>,
  });
  return (
    <FormProvider {...form}>
      <form
        {...props}
        className={className}
        onSubmit={form.handleSubmit(onSubmit as SubmitHandler<TValues>)}
      />
    </FormProvider>
  );
}

interface FormFieldProps<TValues extends FieldValues> {
  name: FieldPath<TValues>;
  label?: string;
  description?: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactElement<BoundInputProps>;
}

interface BoundInputProps {
  id?: string;
  name?: string;
  value?: unknown;
  disabled?: boolean;
  onChange?: (...event: never[]) => void;
  onBlur?: (...event: never[]) => void;
  ref?: React.Ref<never>;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
}

function FormField<TValues extends FieldValues = FieldValues>({
  name,
  label,
  description,
  hint,
  className,
  children,
}: FormFieldProps<TValues>) {
  const { control } = useFormContext<TValues>();
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <div className={cn("space-y-1.5", className)}>
          {label && (
            <Label htmlFor={name} className="text-sm font-medium">
              {label}
            </Label>
          )}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {React.cloneElement(children, {
            ...field,
            id: name,
            "aria-invalid": fieldState.invalid,
          })}
          {fieldState.error ? (
            <p className="text-xs text-destructive">{fieldState.error.message}</p>
          ) : (
            hint && <p className="text-xs text-muted-foreground">{hint}</p>
          )}
        </div>
      )}
    />
  );
}

export { FormRoot as Form, FormField };

interface FieldProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

function Field({ label, description, hint, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
      )}
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export { Field };
