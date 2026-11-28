import { createWebApp } from "../apps/web/src/server/app";
import { isAccessGuard } from "../apps/web/src/server/api/routes";

const rows = createWebApp()
  .routes.flatMap((route) =>
    isAccessGuard(route.handler) ? [[route.handler.access, route.method, route.path] as const] : [],
  )
  .toSorted((a, b) => a[2].localeCompare(b[2]) || a[1].localeCompare(b[1]));

for (const [access, method, path] of rows) {
  console.log(`${access.padEnd(14)}${method.padEnd(7)}${path}`);
}
