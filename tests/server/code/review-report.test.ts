import { describe, expect, it } from "vite-plus/test";
import { parseReviewReport } from "../../../apps/web/src/shared/review-report";

const fenced = (json: string) => `Looks mostly fine.\n\n\`\`\`review-report\n${json}\n\`\`\`\n`;

describe("the agent's review report", () => {
  it("reads the brief and each finding from the fenced block", () => {
    const report = parseReviewReport(
      fenced(
        JSON.stringify({
          brief: "Adds a limiter. Tests: 13 passed.",
          findings: [
            {
              severity: "bug",
              title: "The window never restarts",
              body: "Reset start as well.",
              path: "./src/limiter.ts",
              line: 11,
            },
          ],
        }),
      ),
    );
    expect(report).toEqual({
      brief: "Adds a limiter. Tests: 13 passed.",
      findings: [
        {
          severity: "bug",
          title: "The window never restarts",
          body: "Reset start as well.",
          path: "src/limiter.ts",
          line: 11,
        },
      ],
    });
  });

  it("keeps what it can: an unknown severity is a question, a bad line is line 1, a finding without a file is dropped", () => {
    const report = parseReviewReport(
      fenced(
        JSON.stringify({
          brief: "ok",
          findings: [
            { severity: "blocker", title: "Odd", body: "x", path: "a.ts", line: "seven" },
            { severity: "nit", title: "No file", body: "x" },
            "nonsense",
          ],
        }),
      ),
    );
    expect(report?.findings).toEqual([
      { severity: "question", title: "Odd", body: "x", path: "a.ts", line: 1 },
    ]);
  });

  it("is nothing for an answer without the block, or with broken JSON in it", () => {
    expect(parseReviewReport("All good, nothing to report.")).toBeUndefined();
    expect(parseReviewReport(fenced("{not json"))).toBeUndefined();
  });

  it("takes the last block when the agent quoted the format first", () => {
    const answer = `${fenced('{"brief":"example","findings":[]}')}\n${fenced('{"brief":"real","findings":[]}')}`;
    expect(parseReviewReport(answer)?.brief).toBe("real");
  });
});
