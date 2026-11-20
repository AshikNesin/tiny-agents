import { LivePanel, type LivePanelProps } from "./live/LivePanel";
import { browserSurface } from "./live/surfaces";

export function BrowserPanel(props: LivePanelProps) {
  return <LivePanel surface={browserSurface} {...props} />;
}
