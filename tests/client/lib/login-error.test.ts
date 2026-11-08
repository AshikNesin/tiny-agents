import { describe, expect, it } from "vite-plus/test";
import { ApiError } from "@groot/shell/lib/api";
import { loginErrorDescription } from "@groot/shell/pages/auth/Login";

// A refusal worded by the server's error envelope, as the API client builds it.
const apiError = (status: number, message: string) =>
  new ApiError({
    status,
    code: `HTTP_${status}`,
    message,
    url: "/api/v1/auth/login",
    fromServer: true,
  });

describe("loginErrorDescription", () => {
  it("names a wrong password on 401", () => {
    expect(loginErrorDescription(apiError(401, "Invalid email or password"), "x")).toBe(
      "Invalid email or password.",
    );
  });

  it("shows the server's message for other HTTP errors", () => {
    expect(loginErrorDescription(apiError(429, "Too many attempts"), "x")).toBe(
      "Too many attempts",
    );
  });

  it("falls back when the message is only a status line, not the server's words", () => {
    const statusLine = new ApiError({
      status: 502,
      code: "HTTP_502",
      message: "Bad Gateway",
      url: "/api/v1/auth/login",
    });
    expect(loginErrorDescription(statusLine, "Sign-in failed")).toBe("Sign-in failed");
  });

  it("says the server is unreachable when fetch itself fails", () => {
    expect(loginErrorDescription(new TypeError("Failed to fetch"), "x")).toBe(
      "Could not reach the server. Check your connection and try again.",
    );
  });

  it("falls back for anything else", () => {
    expect(loginErrorDescription("boom", "Invalid credentials")).toBe("Invalid credentials");
  });
});
