/**
 * Read-only bundled-file list (path + size) shared by the skill editor and the
 * import review step.
 */
import { Card } from "@groot/ui/card";
import { Text } from "@groot/ui/typography";
import type { SkillFile } from "../../lib/skills-api";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SkillFileList({ files }: { files: SkillFile[] }) {
  if (files.length === 0) {
    return <p className="text-muted-foreground py-4 text-center text-sm">No bundled files.</p>;
  }
  return (
    <Card className="divide-y p-0" size="sm">
      <ul role="list">
        {files.map((file) => (
          <li key={file.path} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <Text variant="code" className="truncate">
              {file.path}
            </Text>
            <Text variant="meta" className="shrink-0">
              {formatFileSize(file.content.length)}
            </Text>
          </li>
        ))}
      </ul>
    </Card>
  );
}
