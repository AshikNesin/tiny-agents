import type { ArtifactKind } from "../../shared/api/artifacts";
import type { ChatMessage } from "./chat-types";

const EXTENSION: Record<ArtifactKind, string> = {
  markdown: "md",
  code: "txt",
  html: "html",
  svg: "svg",
  mermaid: "mmd",
};

const MIME: Record<ArtifactKind, string> = {
  markdown: "text/markdown",
  code: "text/plain",
  html: "text/html",
  svg: "image/svg+xml",
  mermaid: "text/plain",
};

const CODE_EXTENSION: Record<string, string> = {
  typescript: "ts",
  tsx: "tsx",
  javascript: "js",
  jsx: "jsx",
  python: "py",
  rust: "rs",
  go: "go",
  ruby: "rb",
  java: "java",
  kotlin: "kt",
  swift: "swift",
  shell: "sh",
  bash: "sh",
  sql: "sql",
  json: "json",
  yaml: "yaml",
  css: "css",
  html: "html",
};

export function artifactFile(
  slug: string,
  kind: ArtifactKind,
  language: string | null,
): { name: string; mime: string } {
  const ext =
    kind === "code" && language
      ? (CODE_EXTENSION[language.toLowerCase()] ?? "txt")
      : EXTENSION[kind];
  return { name: `${slug}.${ext}`, mime: MIME[kind] };
}

export function sourceLanguage(kind: ArtifactKind, language: string | null): string {
  if (kind === "code") return language ?? "text";
  if (kind === "markdown") return "markdown";
  if (kind === "html") return "html";
  if (kind === "svg") return "xml";
  return "text";
}

export function fenced(language: string, content: string): string {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${content}\n${fence}`;
}

export function runsInFrame(kind: ArtifactKind): boolean {
  return kind === "html" || kind === "svg";
}

export function latestArtifactCall(messages: readonly ChatMessage[]) {
  for (let m = messages.length - 1; m >= 0; m--) {
    const calls = messages[m]!.toolCalls ?? [];
    for (let c = calls.length - 1; c >= 0; c--) {
      const artifact = calls[c]!.artifact;
      if (artifact) return artifact;
    }
  }
  return undefined;
}
