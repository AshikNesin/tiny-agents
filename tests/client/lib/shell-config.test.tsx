/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { Box } from "lucide-react";
import { ShellProvider } from "@groot/shell/lib/shell-config";
import { Login } from "@groot/shell/pages/auth/Login";

describe("ShellProvider", () => {
  it("overrides Login brand and marketing copy", () => {
    render(
      <MemoryRouter>
        <ShellProvider
          config={{
            brand: { label: "Acme" },
            login: {
              tagline: "Ship smarter.",
              features: [{ icon: Box, title: "Custom feature", desc: "Custom description" }],
            },
          }}
        >
          <Login />
        </ShellProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Ship smarter.")).toBeInTheDocument();
    expect(screen.getByText("Custom feature")).toBeInTheDocument();
  });

  it("keeps the Groot Login defaults without a provider", () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    expect(screen.getByText("Groot")).toBeInTheDocument();
  });
});
