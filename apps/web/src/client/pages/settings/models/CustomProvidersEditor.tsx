/**
 * A gateway account's custom providers (issue #216): providers the owner
 * configured in Cloudflare AI Gateway itself (BYOK "custom providers", e.g.
 * Z.AI's coding plan). Each is its gateway slug and the path the gateway
 * appends; its models then sit beside the gateway's own, on the same token.
 */
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Label } from "@groot/ui/label";
import { Text } from "@groot/ui/typography";

export interface CustomProvider {
  slug: string;
  basePath?: string;
}

/** Rows with a slug, trimmed: what the API takes. */
export function cleanCustomProviders(rows: CustomProvider[]): CustomProvider[] {
  return rows.flatMap((row) => {
    const slug = row.slug.trim();
    const basePath = row.basePath?.trim().replace(/^\/+|\/+$/g, "");
    return slug ? [{ slug, ...(basePath ? { basePath } : {}) }] : [];
  });
}

export function CustomProvidersEditor({
  value,
  onChange,
}: {
  value: CustomProvider[];
  onChange: (next: CustomProvider[]) => void;
}) {
  const update = (index: number, patch: Partial<CustomProvider>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Custom providers</legend>
      <Text variant="meta" className="block">
        Providers you added in the gateway as custom providers, by slug (custom-zai-coding-plan) and
        the path after it (api/coding/paas/v4). Their models are listed with the gateway&apos;s.
      </Text>
      {value.map((row, index) => (
        <div key={index} className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor={`custom-slug-${index}`} className="sr-only">
              Custom provider slug
            </Label>
            <Input
              id={`custom-slug-${index}`}
              placeholder="custom-zai-coding-plan"
              value={row.slug}
              onChange={(e) => update(index, { slug: e.target.value })}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor={`custom-path-${index}`} className="sr-only">
              Custom provider base path
            </Label>
            <Input
              id={`custom-path-${index}`}
              placeholder="api/coding/paas/v4"
              value={row.basePath ?? ""}
              onChange={(e) => update(index, { basePath: e.target.value })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${row.slug || "custom provider"}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { slug: "", basePath: "" }])}
      >
        <Plus className="size-4" />
        Add a custom provider
      </Button>
    </fieldset>
  );
}
