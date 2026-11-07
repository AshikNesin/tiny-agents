export function pauseMessage(detail: string): string {
  return `${detail} The turn was not sent. Choose a fallback model for the Claude plan in Settings → Models to send it there instead.`;
}
