import { describe, expect, it } from "vite-plus/test";
import { labelFeedbackControls } from "@/lib/feedback";

describe("labelFeedbackControls", () => {
  it("names the embed's icon-only feedback-type radios", () => {
    document.body.innerHTML = `<div class="fbx-kinds" role="radiogroup">
      <button id="fbx-kind-issue" role="radio"></button>
      <button id="fbx-kind-feature_request" role="radio"></button>
      <button id="fbx-kind-other" role="radio" aria-label="Kept"></button></div>`;
    labelFeedbackControls();
    expect(document.getElementById("fbx-kind-issue")?.getAttribute("aria-label")).toBe(
      "Report an issue",
    );
    expect(document.getElementById("fbx-kind-feature_request")?.getAttribute("aria-label")).toBe(
      "Request a feature",
    );
    expect(document.getElementById("fbx-kind-other")?.getAttribute("aria-label")).toBe("Kept");
  });
});
