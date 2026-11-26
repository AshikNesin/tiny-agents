import { describe, expect, it } from "vite-plus/test";
import { fallbackRatchetProblems } from "../../../scripts/check-fallback-ratchet";

describe("silent fallback ratchet", () => {
  it("passes a baseline that kept, cut or moved its sites", () => {
    expect(
      fallbackRatchetProblems(
        { "b.ts": { ".catch(() => null)": 1 } },
        { "a.ts": { ".catch(() => null)": 2 }, "c.ts": { "catch {}": 1 } },
      ),
    ).toEqual([]);
  });

  it("fails a site swapped for another under the same count, as f5e6e03 did", () => {
    expect(
      fallbackRatchetProblems(
        { "code.pulls.ts": { '.catch(() => "tiny-agents")': 1 } },
        { "code.pulls.ts": { ".catch(() => null)": 1 } },
      ),
    ).toEqual([
      '`.catch(() => "tiny-agents")`: scripts/lint/silent-fallback-baseline.json allows 1, up from 0. It only shrinks; a site that moves keeps its entry, and a changed one is new.',
    ]);
  });

  it("fails a site whose count grew", () => {
    expect(
      fallbackRatchetProblems({ "a.ts": { "catch {}": 3 } }, { "a.ts": { "catch {}": 2 } }),
    ).toHaveLength(1);
  });
});
