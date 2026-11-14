/**
 * ComputerPanel (issue #108): the bot's computer, live, beside the chat. The
 * shared live-view panel (`live/LivePanel.tsx`) on the computer's surface
 * (`live/surfaces.tsx`).
 */
import { LivePanel, type LivePanelProps } from "./live/LivePanel";
import { computerSurface } from "./live/surfaces";

export function ComputerPanel(props: LivePanelProps) {
  return <LivePanel surface={computerSurface} {...props} />;
}
