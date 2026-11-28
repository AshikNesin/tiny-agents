import type { RouteAccess } from "./routes";

type KitAccess = Readonly<Record<string, RouteAccess>>;

export const AUTH_ACCESS: KitAccess = {
  "POST /login": "public",
  "POST /setup": "public",
  "POST /logout": "signedIn",
  "POST /users": "signedIn",
};

export const PASSKEY_ACCESS: KitAccess = {
  "POST /register/options": "signedIn",
  "POST /register/verify": "signedIn",
  "POST /login/options": "public",
  "POST /login/verify": "public",
  "DELETE /:id": "signedIn",
  "PATCH /:id": "signedIn",
};

export const JOBS_ACCESS: KitAccess = {
  "POST /": "signedIn",
  "POST /bulk-rerun": "signedIn",
  "POST /schedule": "signedIn",
  "DELETE /schedule/:jobName": "signedIn",
  "DELETE /state/:state": "signedIn",
  "DELETE /:jobId": "signedIn",
  "POST /:jobId/retry": "signedIn",
  "POST /:jobId/cancel": "signedIn",
  "POST /:jobId/resume": "signedIn",
  "POST /:jobId/rerun": "signedIn",
};

export const STORAGE_ACCESS: KitAccess = {
  "POST /files/upload": "signedIn",
  "DELETE /files": "signedIn",
  "PUT /files/rename": "signedIn",
  "POST /folders": "signedIn",
  "DELETE /folders/:folderPath{.+}": "signedIn",
};

export const SETTINGS_ACCESS: KitAccess = {
  "POST /": "signedIn",
  "PUT /:key": "signedIn",
  "DELETE /:key": "signedIn",
};

export const NOTIFICATIONS_ACCESS: KitAccess = {
  "PUT /settings": "signedIn",
  "POST /test": "signedIn",
  "POST /validate": "signedIn",
};
