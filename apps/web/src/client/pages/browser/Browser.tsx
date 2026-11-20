import { LivePage } from "../../components/live/LivePage";
import { browserSurface } from "../../components/live/surfaces";

export function BrowserPage() {
  return <LivePage surface={browserSurface} />;
}
