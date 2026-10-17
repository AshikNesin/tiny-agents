import { describe, it, expect } from "vite-plus/test";
import {
  addBreadcrumb,
  getBreadcrumbs,
  clearBreadcrumbs,
  runWithLoggerContext,
} from "@groot/core/logger";

/**
 * Breadcrumb trail — attached to request contexts and surfaced verbatim in
 * `buildErrorContext` when a request fails. Child projects instrument
 * ingestion pipelines (webhooks, sync jobs) with these; the contract that
 * matters is: dropped outside a context, capped at 50, cleared on demand.
 */
describe("breadcrumbs", () => {
  it("records breadcrumbs inside a logger context", () => {
    return runWithLoggerContext(() => {
      addBreadcrumb("http", "Received webhook");
      addBreadcrumb("db", "Queued job", "debug", { jobId: 42 });

      const crumbs = getBreadcrumbs();
      expect(crumbs).toHaveLength(2);
      expect(crumbs[0]).toMatchObject({
        category: "http",
        message: "Received webhook",
        level: "info",
      });
      expect(crumbs[1]).toMatchObject({
        category: "db",
        message: "Queued job",
        level: "debug",
        data: { jobId: 42 },
      });
    });
  });

  it("drops breadcrumbs outside a logger context (no throw)", () => {
    expect(() => addBreadcrumb("job", "orphan")).not.toThrow();
    expect(getBreadcrumbs()).toEqual([]);
  });

  it("caps the trail at the most recent 50", () => {
    return runWithLoggerContext(() => {
      for (let i = 0; i < 60; i++) addBreadcrumb("db", `step ${i}`);
      const crumbs = getBreadcrumbs();
      expect(crumbs).toHaveLength(50);
      expect(crumbs[0]?.message).toBe("step 10");
      expect(crumbs[49]?.message).toBe("step 59");
    });
  });

  it("clearBreadcrumbs empties the active trail", () => {
    return runWithLoggerContext(() => {
      addBreadcrumb("http", "one");
      clearBreadcrumbs();
      expect(getBreadcrumbs()).toEqual([]);
    });
  });

  it("isolates trails between separate contexts", () => {
    return runWithLoggerContext(() => {
      addBreadcrumb("http", "first request");
      return runWithLoggerContext(() => {
        expect(getBreadcrumbs()).toEqual([]);
      });
    });
  });
});
