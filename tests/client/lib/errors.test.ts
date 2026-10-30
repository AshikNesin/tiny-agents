import { describe, expect, it } from "vite-plus/test";
import { ApiError } from "@groot/shell/lib/api";
import { errorMessage, OFFLINE_MESSAGE, TIMEOUT_MESSAGE } from "@/lib/errors";

/** What `apiClient` throws when the server answered with its error envelope. */
function apiFailure(
  status: number,
  error: { code: string; message: string; details?: unknown },
): ApiError {
  return new ApiError({ status, ...error, url: "/bots", fromServer: true });
}

describe("errorMessage", () => {
  it("prefers the first field-level validation message", () => {
    const error = apiFailure(400, {
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: { systemPrompt: ["System prompt is too long (max ~24 KB)"] },
    });
    expect(errorMessage(error, "Failed to save bot")).toBe(
      "System prompt is too long (max ~24 KB)",
    );
  });

  it("falls back to the server's message", () => {
    const error = apiFailure(409, { code: "CONFLICT", message: "Skill exists" });
    expect(errorMessage(error, "Failed")).toBe("Skill exists");
  });

  it("shows an envelope message that came without a code", () => {
    const error = new ApiError({
      status: 503,
      code: "HTTP_503",
      message: "Cannot reach the sandbox (ETIMEDOUT).",
      url: "/terminal/sessions",
      fromServer: true,
    });
    expect(errorMessage(error, "Couldn't load")).toBe("Cannot reach the sandbox (ETIMEDOUT).");
  });

  it("never shows the status-line text of a response without an envelope", () => {
    // A proxy's HTML page: ApiError falls back to the status text and an HTTP_<status> code.
    const error = new ApiError({
      status: 500,
      code: "HTTP_500",
      message: "Internal Server Error",
      url: "/bots",
    });
    expect(errorMessage(error, "Failed to save")).toBe("Failed to save");
  });

  it("explains a request that never got an answer", () => {
    const offline = new TypeError("Failed to fetch");
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    expect(errorMessage(offline, "Failed")).toBe(OFFLINE_MESSAGE);
    expect(
      errorMessage(new TypeError("NetworkError when attempting to fetch resource."), "x"),
    ).toBe(OFFLINE_MESSAGE);
    expect(errorMessage(timeout, "Failed")).toBe(TIMEOUT_MESSAGE);
  });

  it("keeps plain errors and uses the fallback for anything else", () => {
    expect(errorMessage(new Error("No data returned"), "Failed")).toBe("No data returned");
    expect(
      errorMessage(
        new ApiError({ status: 200, code: "NO_DATA", message: "No data returned", url: "/x" }),
        "Failed",
      ),
    ).toBe("No data returned");
    expect(errorMessage("weird", "Failed")).toBe("Failed");
  });
});
