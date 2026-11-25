import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createShellQueryClient, ShellQueryProvider } from "@groot/shell/lib/query-client";
import { MemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui/provider";
import { JobsTable } from "@groot/jobs/client/components/JobsTable";
import { JOBS_PAGE_SIZE } from "@groot/jobs/client/constants";
import type { Job, JobState } from "@groot/jobs/client/types";

type Call = { method: string; url: string; body?: unknown };

function stubJobsFetch() {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push(body === undefined ? { method, url } : { method, url, body });
    if (method === "POST" && url === "/api/v1/jobs/bulk-rerun") {
      const jobIds = (body as { jobIds: string[] }).jobIds;
      return new Response(
        JSON.stringify({
          success: true,
          data: jobIds.map((jobId) => ({ jobId, success: true, newJobId: "new-job" })),
        }),
        { status: 200 },
      );
    }
    if (method === "DELETE" && url.startsWith("/api/v1/jobs/")) {
      return new Response(null, { status: 204 });
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "NOT_FOUND", message: `Unexpected ${method} ${url}` },
      }),
      { status: 404 },
    );
  });
  return calls;
}

function job(id: string, state: JobState = "completed"): Job {
  const now = new Date().toISOString();
  return {
    id,
    name: "report",
    data: null,
    state,
    priority: 0,
    retryLimit: 0,
    retryCount: 0,
    retryDelay: 0,
    runAt: now,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    output: null,
    error: null,
    singletonKey: null,
  };
}

const JOBS = [job("aaaaaaaa-1"), job("bbbbbbbb-2", "failed"), job("cccccccc-3", "active")];

function renderTable(
  jobs: Job[] = JOBS,
  {
    total = jobs.length,
    page = 0,
    onPage = () => {},
  }: Partial<{ total: number; page: number; onPage: (page: number) => void }> = {},
) {
  return render(
    <ShellQueryProvider client={createShellQueryClient({ queries: { retry: false } })}>
      <GrootUIProvider>
        <MemoryRouter>
          <JobsTable
            jobs={jobs}
            total={total}
            loading={false}
            state="all"
            page={page}
            onPage={onPage}
          />
        </MemoryRouter>
      </GrootUIProvider>
    </ShellQueryProvider>,
  );
}

const row = (shortId: string) => screen.getByRole("row", { name: `Job report (${shortId})` });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JobsTable", () => {
  it("renders one named row per job", () => {
    renderTable();
    expect(screen.getAllByRole("row", { name: /^Job report/ })).toHaveLength(3);
    expect(within(row("aaaaaa")).getByRole("link")).toHaveAttribute("href", "/jobs/aaaaaaaa-1");
  });

  it("selects rows by id and re-runs the finished ones after confirming", async () => {
    const calls = stubJobsFetch();
    const user = userEvent.setup();
    renderTable();

    await user.click(within(row("aaaaaa")).getByRole("checkbox"));
    await user.click(within(row("cccccc")).getByRole("checkbox"));

    const rerun = screen.getByRole("button", { name: "Rerun 1" });
    expect(rerun).toHaveAttribute("title", "Only completed and failed jobs can be re-run");
    await user.click(rerun);
    const dialog = await screen.findByRole("alertdialog");
    expect(calls).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Re-run" }));

    expect(calls).toEqual([
      { method: "POST", url: "/api/v1/jobs/bulk-rerun", body: { jobIds: ["aaaaaaaa-1"] } },
    ]);
    expect(
      await screen.findByText("Successfully triggered re-run for 1 of 1 jobs."),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Rerun/ })).toBeNull());
  });

  it("disables bulk re-run when no selected job can be re-run", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(within(row("cccccc")).getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Rerun 0" })).toBeDisabled();
  });

  it("selects and clears every row with select all", async () => {
    const user = userEvent.setup();
    renderTable();
    const selectAll = screen.getByRole("checkbox", { name: "Select all" });

    await user.click(selectAll);
    expect(screen.getByRole("button", { name: "Rerun 2" })).toBeInTheDocument();
    expect(within(row("bbbbbb")).getByRole("checkbox")).toBeChecked();

    await user.click(selectAll);
    expect(screen.queryByRole("button", { name: /^Rerun/ })).toBeNull();
  });

  it("offers the actions the job's state allows and confirms delete", async () => {
    const calls = stubJobsFetch();
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("button", { name: "Actions for job report (bbbbbb)" }));
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["Retry", "Re-run", "Delete"]);

    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(calls).toEqual([]);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(calls).toEqual([{ method: "DELETE", url: "/api/v1/jobs/bbbbbbbb-2" }]);
    expect(await screen.findByText("Job has been deleted")).toBeInTheDocument();
  });

  it("pages through the server's total", async () => {
    const onPage = vi.fn();
    const user = userEvent.setup();
    renderTable(JOBS, { total: 2 * JOBS_PAGE_SIZE + 1, page: 1, onPage });

    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenLastCalledWith(2);
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPage).toHaveBeenLastCalledWith(0);
  });
});
