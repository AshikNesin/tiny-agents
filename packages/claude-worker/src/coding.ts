import { CodingError } from "./coding-error";
import type { CodingCatalog, CodingSessionConfig } from "./coding-protocol";
import type { CodingQuery } from "./coding-sdk";
import { CodingSession, type CodingDeps, type CodingPartial } from "./coding-session";
import { warnedAs } from "./failures";

export class CodingBook {
  private readonly sessions = new Map<string, CodingSession>();
  catalog: CodingCatalog | undefined;
  onCatalog: ((catalog: CodingCatalog) => void) | undefined;
  onPartial: ((sessionId: string, partial: CodingPartial) => void) | undefined;
  private catalogLoading = false;

  constructor(readonly deps: CodingDeps) {}

  get(id: string): CodingSession | undefined {
    return this.sessions.get(id);
  }

  list(): CodingSession[] {
    return [...this.sessions.values()];
  }

  ensure(id: string, config: CodingSessionConfig): CodingSession {
    const existing = this.sessions.get(id);
    if (existing) {
      existing.configure(config);
      return existing;
    }
    const session = new CodingSession(id, config, this, this.deps);
    this.sessions.set(id, session);
    return session;
  }

  liveProcesses(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.live || session.starting) count += 1;
    }
    return count;
  }

  runningTurns(): number {
    let count = 0;
    for (const session of this.sessions.values()) if (session.running) count += 1;
    return count;
  }

  checkTurnSlot(session: CodingSession): void {
    const others = this.runningTurns() - (session.running ? 1 : 0);
    if (others >= this.deps.limits.maxRunningTurns) {
      throw new CodingError(
        "turn_busy",
        `${this.deps.limits.maxRunningTurns} Claude Code turns are already running. ` +
          "Wait for one to finish, or queue this message.",
      );
    }
  }

  reserveProcess(session: CodingSession): void {
    if (session.live || session.starting) return;
    if (this.liveProcesses() < this.deps.limits.maxLiveProcesses) return;
    const idle = [...this.sessions.values()]
      .filter((other) => other !== session && other.live && !other.busy)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const victim = idle[0];
    if (!victim) {
      throw new CodingError(
        "at_capacity",
        `${this.deps.limits.maxLiveProcesses} Claude Code sessions are busy. ` +
          "Stop one, or wait for one to finish.",
      );
    }
    victim.close();
  }

  sweep(now: number): void {
    for (const session of this.sessions.values()) {
      if (!session.live || session.busy) continue;
      if (now - session.lastUsed >= this.deps.limits.idleEvictMs) session.close();
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.close();
  }

  async fetchCatalog(query: CodingQuery): Promise<void> {
    if (this.catalogLoading) return;
    this.catalogLoading = true;
    try {
      const [commands, models] = await Promise.all([
        query.supportedCommands().catch(warnedAs("listing Claude Code's slash commands", [])),
        query.supportedModels
          ? query.supportedModels().catch(warnedAs("listing Claude Code's models", []))
          : Promise.resolve([]),
      ]);
      if (commands.length === 0 && models.length === 0) return;
      this.catalog = {
        commands: commands.map((command) => ({
          name: command.name,
          description: command.description,
          argumentHint: command.argumentHint,
        })),
        models: models.map((model) => ({
          value: model.value,
          displayName: model.displayName,
          description: model.description,
          ...(model.supportedEffortLevels
            ? { supportedEffortLevels: model.supportedEffortLevels }
            : {}),
        })),
      };
      this.onCatalog?.(this.catalog);
    } finally {
      this.catalogLoading = false;
    }
  }
}
