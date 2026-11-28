import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@groot/ui";
import { ignoreClipboardRefusal } from "../../lib/clipboard";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "../../components/ui/code-block";
import { codeApi, type AssetRef } from "../../lib/code/api";

function sayCopyRefused(error: unknown): void {
  ignoreClipboardRefusal(error);
  toast.error("Could not copy");
}

export function copy(text: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Copied"))
    .catch(sayCopyRefused);
}

export function Output({
  title,
  value,
  destructive,
}: {
  title: string;
  value: string;
  destructive?: boolean;
}) {
  const lines = value.replace(/\n$/, "").split("\n");
  return (
    <CodeBlock size="sm" variant={destructive ? "destructive" : "default"}>
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          onClick={() => copy(value)}
          aria-label={`Copy ${title.toLowerCase()}`}
        >
          <Copy />
        </Button>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-80 overflow-y-auto overscroll-contain">
        {lines.map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

export function Images({ assets, instanceId }: { assets: AssetRef[]; instanceId: string }) {
  if (assets.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {assets.map((asset) => {
        const src = codeApi.assetUrl(instanceId, asset.ref);
        return (
          <a key={asset.ref} href={src} target="_blank" rel="noreferrer" className="block">
            <img
              src={src}
              alt={asset.name || "Tool output"}
              loading="lazy"
              className="border-border max-h-64 max-w-full rounded-lg border object-contain"
            />
          </a>
        );
      })}
    </div>
  );
}
