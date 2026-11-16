import { afterEach, describe, expect, it } from "vite-plus/test";
import { openFeedback } from "@/lib/feedback";

describe("openFeedback", () => {
  afterEach(() => {
    delete window.FeedbackBee;
  });

  it("opens the headless embed's panel through its API, with no launcher on the page", () => {
    const opened: unknown[] = [];
    // The embed is third-party: fake its API the way it exposes it once loaded.
    window.FeedbackBee = {
      version: "2.0.0",
      open: (options) => {
        opened.push(options);
        return Promise.resolve({ status: "dismissed" });
      },
    };
    expect(document.querySelector(".fbx-launch")).toBeNull();
    openFeedback();
    expect(opened).toEqual([undefined]);
  });
});
