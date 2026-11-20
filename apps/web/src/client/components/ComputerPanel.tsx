import { LivePanel, type LivePanelProps } from "./live/LivePanel";
import { computerSurface } from "./live/surfaces";

export function ComputerPanel(props: LivePanelProps) {
  return <LivePanel surface={computerSurface} {...props} />;
}
