/**
 * Computer page: the bots' desktops on the sandbox VM. The shared live-view
 * page (`components/live/LivePage.tsx`) on the computer's surface
 * (`components/live/surfaces.tsx`), with its Apps and Keys menus.
 */
import { LivePage } from "../../components/live/LivePage";
import { computerSurface } from "../../components/live/surfaces";

export function ComputerPage() {
  return <LivePage surface={computerSurface} />;
}
