import type { ToolChoice } from "@tiny-agents/code/contracts";
import type {
  Bot,
  BotListEntry,
  CapabilityList,
  PastChatList,
} from "../../../apps/web/src/shared/api/bots";
import type { ComputerStatus } from "../../../apps/web/src/shared/api/live";
import type { Skill } from "../../../apps/web/src/shared/api/skills";
import { fakeApi } from "../fakes/api";

export function chatBackend(bot: Bot) {
  const api = fakeApi();
  api.get("/bots", (): BotListEntry[] => []);
  api.get("/capabilities", (): CapabilityList => ({ capabilities: [] }));
  api.get("/bots/:id/chats", (): PastChatList => ({ chats: [] }));
  api.get("/bots/:id/tools", (): ToolChoice[] => []);
  api.get("/skills", (): Skill[] => []);
  api.get("/bots/:id/computer", (): ComputerStatus => ({
    configured: false,
    setupHint: null,
    active: false,
    profile: "shared",
    driver: null,
    width: null,
    height: null,
    takeover: null,
    starting: false,
    phase: null,
    error: null,
  }));
  api.post("/bots/:id/messages", () => ({ submitted: true }));
  api.delete("/bots/:id/messages/:requestId", () => "withdrawn");
  api.post("/bots/:id/abort", () => ({ aborted: true }));
  api.post("/bots/:id/read", () => bot);
  return api;
}
