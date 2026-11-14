/**
 * Browser page (issue #160): the bots' browsers on the sandbox VM. The shared
 * live-view page (`components/live/LivePage.tsx`) on the browser's surface
 * (`components/live/surfaces.tsx`). `?profile=bot-<id>` opens a given
 * browser (the chat panel links here).
 */
import { LivePage } from "../../components/live/LivePage";
import { browserSurface } from "../../components/live/surfaces";

export function BrowserPage() {
  return <LivePage surface={browserSurface} />;
}
