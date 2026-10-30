import { describe, expect, it } from "vite-plus/test";
import { errorMessage, OFFLINE_MESSAGE, TIMEOUT_MESSAGE } from "@/lib/errors";

/** The shape axios rejects with when the server answered. */
function axiosFailure(status: number, data: unknown) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

describe("errorMessage", () => {
  it("prefers the first field-level validation message", () => {
    const error = axiosFailure(400, {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: { systemPrompt: ["System prompt is too long (max ~24 KB)"] },
      },
    });
    expect(errorMessage(error, "Failed to save bot")).toBe(
      "System prompt is too long (max ~24 KB)",
    );
  });

  it("falls back to the server's message", () => {
    const error = axiosFailure(409, { error: { code: "CONFLICT", message: "Skill exists" } });
    expect(errorMessage(error, "Failed")).toBe("Skill exists");
  });

  it("never shows axios's status-line text", () => {
    expect(errorMessage(axiosFailure(500, "<html>"), "Failed to save")).toBe("Failed to save");
  });

  it("explains a request that never got an answer", () => {
    const offline = Object.assign(new Error("Network Error"), {
      isAxiosError: true,
      code: "ERR_NETWORK",
    });
    const timeout = Object.assign(new Error("timeout of 0ms exceeded"), {
      isAxiosError: true,
      code: "ECONNABORTED",
    });
    expect(errorMessage(offline, "Failed")).toBe(OFFLINE_MESSAGE);
    expect(errorMessage(timeout, "Failed")).toBe(TIMEOUT_MESSAGE);
  });

  it("keeps plain errors and uses the fallback for anything else", () => {
    expect(errorMessage(new Error("No data returned"), "Failed")).toBe("No data returned");
    expect(errorMessage("weird", "Failed")).toBe("Failed");
  });
});
