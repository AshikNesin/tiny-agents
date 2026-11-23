import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@groot/core/types";
import { Boom } from "@groot/core/errors";
import {
  BOT_PATH,
  GUEST_ACCESS,
  UPLOAD_PATH,
  type UploadReach,
} from "../../../shared/guest-access";
import { canOpenBot, canReachUpload, resolveViewer, type Viewer } from "./access";

declare module "hono" {
  interface ContextVariableMap {
    viewer: Viewer;
  }
}

const GUEST_API = Object.values(GUEST_ACCESS).flatMap((feature) => feature.api);

interface GuestRoute {
  botId?: string;
  upload?: { id: string; reach: UploadReach };
}

function decodeId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

export function matchGuestRoute(method: string, path: string): GuestRoute | undefined {
  const bot = BOT_PATH.exec(path);
  const botId = bot ? decodeId(bot[1]) : undefined;
  const upload = UPLOAD_PATH.exec(path);
  const uploadId = upload ? decodeId(upload[1]) : undefined;
  for (const rule of GUEST_API) {
    if (rule.methods !== "*" && !rule.methods.includes(method)) continue;
    if ("bot" in rule) {
      if (bot && botId !== undefined && rule.bot.test(bot[2] ?? "")) return { botId };
    } else if ("upload" in rule) {
      if (upload && uploadId !== undefined && rule.upload.test(upload[2] ?? "")) {
        return { upload: { id: uploadId, reach: rule.reach } };
      }
    } else if (!bot && !upload && rule.path.test(path)) {
      return {};
    }
  }
  return undefined;
}

export function guestGuard(prefix = "/api/v1"): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) throw Boom.unauthorized("Authentication required");
    const viewer = await resolveViewer(user.userId);
    c.set("viewer", viewer);
    if (viewer.kind === "owner") return next();
    const path = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : c.req.path;
    const allowed = matchGuestRoute(c.req.method, path);
    if (!allowed) throw Boom.forbidden("Only the owner can do that");
    if (allowed.botId !== undefined && !(await canOpenBot(viewer, allowed.botId))) {
      throw Boom.notFound("Bot not found");
    }
    const { upload } = allowed;
    if (upload && !(await canReachUpload(viewer, upload.id, upload.reach))) {
      throw Boom.notFound("Unknown upload");
    }
    return next();
  };
}
