import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@groot/ui/button";
import { Card, CardContent } from "@groot/ui/card";
import { Field } from "@groot/ui/form";
import { Input } from "@groot/ui/input";
import { Textarea } from "@groot/ui/textarea";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { Section } from "@groot/shell/components/layout/Section";
import type { ValueField, VaultKind, VaultPolicy } from "../../../shared/api/vault";
import {
  apiError,
  FIELD_LABEL,
  FIELDS_BY_KIND,
  KIND_LABEL,
  SECRET_FIELDS,
} from "../../lib/vault-api";
import { useVaultMutations } from "../../queries/vault";
import { defaultPolicy, PolicyForm, suggestHandle } from "../../components/vault/PolicyForm";
import { SecretInput } from "../../components/vault/SecretInput";
import { KIND_DEFAULT_TOOLS } from "../../../shared/vault-kinds";

const AUTOCOMPLETE: Partial<Record<ValueField, string>> = {
  username: "username",
  card_number: "cc-number",
  card_expiry: "cc-exp",
  card_cvc: "cc-csc",
  card_holder: "cc-name",
  identity_name: "name",
  identity_email: "email",
  identity_phone: "tel",
};

const PLACEHOLDER: Partial<Record<ValueField, string>> = {
  totp: "otpauth://totp/… or the setup key",
  card_expiry: "MM/YYYY",
};

export function ValueFieldInput({
  field,
  value,
  onChange,
  idPrefix,
}: {
  field: ValueField;
  value: string;
  onChange: (value: string) => void;
  idPrefix: string;
}) {
  const id = `${idPrefix}-${field}`;
  if (SECRET_FIELDS.has(field)) {
    return (
      <SecretInput
        id={id}
        value={value}
        onChange={onChange}
        generate={field === "password"}
        autoComplete={field === "password" ? "new-password" : (AUTOCOMPLETE[field] ?? "off")}
        placeholder={PLACEHOLDER[field]}
      />
    );
  }
  if (field === "notes" || field.endsWith("address")) {
    return (
      <Textarea id={id} rows={2} value={value} onChange={(event) => onChange(event.target.value)} />
    );
  }
  return (
    <Input
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete={AUTOCOMPLETE[field] ?? "off"}
      placeholder={PLACEHOLDER[field]}
    />
  );
}

export function NewVaultItem({ kind }: { kind: VaultKind }) {
  const navigate = useNavigate();
  const { create } = useVaultMutations();
  const [title, setTitle] = useState("");
  const [website, setWebsite] = useState("");
  const [values, setValues] = useState<Partial<Record<ValueField, string>>>({});
  const [policy, setPolicy] = useState<VaultPolicy>(defaultPolicy(kind));
  const [handleTouched, setHandleTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const usesWebsite = kind === "login" || kind === "card";

  const save = async () => {
    setSaving(true);
    try {
      const urls = website
        .split(/\s+/)
        .map((url) => url.trim())
        .filter(Boolean)
        .map((url) => (/^https?:\/\//.test(url) ? url : `https://${url}`));
      const item = await create.mutateAsync({
        kind,
        title: title.trim(),
        urls,
        values: Object.fromEntries(Object.entries(values).filter(([, v]) => v)),
        policy,
      });
      toast.success("Saved");
      void navigate(`/vault/items/${item.handle}`, { replace: true });
    } catch (error) {
      toast.error(apiError(error, "Couldn't save the item"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageLayout title={`New ${KIND_LABEL[kind].toLowerCase()}`} maxWidth="4xl" backTo="/vault">
      <Section title="Details">
        <Card>
          <CardContent className="space-y-4">
            <Field label="Name" htmlFor="new-title">
              <Input
                id="new-title"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (!handleTouched)
                    setPolicy((prev) => ({ ...prev, handle: suggestHandle(event.target.value) }));
                }}
                placeholder={kind === "card" ? "Amex personal" : "GitHub"}
              />
            </Field>
            {usesWebsite && (
              <Field
                label="Website"
                htmlFor="new-website"
                hint="Its origin is where bots may fill this item."
              >
                <Input
                  id="new-website"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  placeholder={
                    kind === "card" ? "https://shop.example.com" : "https://github.com/login"
                  }
                />
              </Field>
            )}
            {FIELDS_BY_KIND[kind].map((field) => (
              <Field key={field} label={FIELD_LABEL[field]} htmlFor={`new-${field}`}>
                <ValueFieldInput
                  field={field}
                  value={values[field] ?? ""}
                  onChange={(value) => setValues((prev) => ({ ...prev, [field]: value }))}
                  idPrefix="new"
                />
              </Field>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section title="Who may use it">
        <Card>
          <CardContent>
            <PolicyForm
              kind={kind}
              value={policy}
              onChange={(next) => {
                if (next.handle !== policy.handle) setHandleTouched(true);
                setPolicy(next);
              }}
              defaultTools={KIND_DEFAULT_TOOLS[kind]}
              idPrefix="new-policy"
            />
          </CardContent>
        </Card>
      </Section>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => void navigate("/vault")} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={saving || !title.trim() || !policy.handle}>
          Save
        </Button>
      </div>
    </PageLayout>
  );
}
