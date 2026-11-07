export function pauseMessage(detail: string): string {
  return `${detail} The turn was not sent. Set CLAUDE_CODE_ENGINE_FALLBACK=gateway to send it through Cloudflare AI Gateway instead.`;
}
