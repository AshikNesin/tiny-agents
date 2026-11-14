/**
 * BrowserPanel (issue #24): the bot's browser, live, beside the chat. The
 * shared live-view panel (`live/LivePanel.tsx`) on the browser's surface
 * (`live/surfaces.tsx`).
 */
import { LivePanel, type LivePanelProps } from "./live/LivePanel";
import { browserSurface } from "./live/surfaces";

export function BrowserPanel(props: LivePanelProps) {
  return <LivePanel surface={browserSurface} {...props} />;
}
