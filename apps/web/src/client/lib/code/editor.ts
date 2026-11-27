import type { EditorSshTarget } from "../../../shared/api/code";
import { readStored, writeStored } from "../browser-storage";

export type EditorId = "cursor" | "zed";

export const EDITORS: Array<{ id: EditorId; label: string }> = [
  { id: "cursor", label: "Cursor" },
  { id: "zed", label: "Zed" },
];

const SANDBOX_ALIAS = "tiny-agents-sandbox";
const EDITOR_KEY = "tiny-agents:code-editor";
const HOST_KEY = "tiny-agents:code-editor-host:";

function needsAlias(target: EditorSshTarget): boolean {
  return target.port !== null || target.keyFile !== null;
}

function sshHost(target: EditorSshTarget, appHost: string): string {
  if (target.host) return target.host;
  return /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[?::1\]?)$/i.test(appHost) ? "127.0.0.1" : appHost;
}

export function suggestedHost(target: EditorSshTarget, appHost: string): string {
  if (needsAlias(target)) return SANDBOX_ALIAS;
  const host = sshHost(target, appHost);
  return target.user ? `${target.user}@${host}` : host;
}

export function sshConfig(target: EditorSshTarget, appHost: string): string | null {
  if (!needsAlias(target)) return null;
  return [
    `Host ${SANDBOX_ALIAS}`,
    `  HostName ${sshHost(target, appHost)}`,
    target.port !== null && `  Port ${target.port}`,
    target.user && `  User ${target.user}`,
    target.keyFile && `  IdentityFile ${target.keyFile}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function editorUrl(editor: EditorId, host: string, path: string): string {
  const authority = host
    .trim()
    .replace(/^ssh:\/\//, "")
    .replace(/\/+$/, "");
  const folder = encodeURI(path.startsWith("/") ? path : `/${path}`);
  return editor === "zed"
    ? `zed://ssh/${authority}${folder}`
    : `cursor://vscode-remote/ssh-remote+${authority}${folder}?windowId=_blank`;
}

export function lastEditor(): EditorId {
  return readStored(EDITOR_KEY) === "zed" ? "zed" : "cursor";
}

export function lastHost(instanceId: string): string | null {
  return readStored(HOST_KEY + instanceId);
}

export function rememberEditor(editor: EditorId, instanceId: string, host: string): void {
  writeStored(EDITOR_KEY, editor);
  writeStored(HOST_KEY + instanceId, host.trim());
}
