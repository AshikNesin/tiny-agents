import type {
  BrowserStatus,
  ComputerStatus,
  DriverBody,
  LiveStarting,
  ResizeBody,
  VncTicket,
} from "../../../apps/web/src/shared/api/live";
import { fakeApi } from "../fakes/api";

type Held<Status> = Status | Promise<Status>;

function liveBackend<Status extends BrowserStatus | ComputerStatus>(
  surface: "browser" | "computer",
  initial: Held<Status>,
  scale: number,
  afterDriver: (status: Status, driver: DriverBody["driver"]) => Status,
) {
  const api = fakeApi();
  const base = `/bots/b1/${surface}`;
  let current = initial;
  api.get(base, () => current);
  api.post<DriverBody>(`${base}/driver`, async (request) => {
    const { driver } = request.body;
    current = afterDriver(await current, driver);
    return { driver };
  });
  api.post(`${base}/start`, (): LiveStarting => ({ starting: true }));
  api.post(`${base}/vnc-ticket`, (): VncTicket => ({
    path: `/api/v1${base}/vnc?ticket=t1`,
    scale,
  }));
  api.post(`${base}/resize`, (request) => request.body);
  api.delete(`${base}/profile`, () => undefined);
  return {
    api,
    base,
    set: (next: Status) => {
      current = next;
    },
    statuses: () => api.sent("GET", base),
    drivers: () =>
      api.sent<DriverBody>("POST", `${base}/driver`).map((request) => request.body.driver),
    starts: () => api.sent("POST", `${base}/start`),
    tickets: () => api.sent("POST", `${base}/vnc-ticket`),
    resizes: () => api.sent<ResizeBody>("POST", `${base}/resize`).map((request) => request.body),
    resets: () => api.sent("DELETE", `${base}/profile`),
  };
}

export const browserBackend = (initial: Held<BrowserStatus>) =>
  liveBackend("browser", initial, 2, (status, driver) => ({ ...status, driver }));

export const computerBackend = (initial: Held<ComputerStatus>) =>
  liveBackend("computer", initial, 1, (status, driver) => ({
    ...status,
    driver,
    ...(driver === "agent" ? { takeover: null } : {}),
  }));
