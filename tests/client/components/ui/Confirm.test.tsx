/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { ConfirmProvider, useConfirm } from "@groot/ui/primitives/confirm";

describe("ConfirmProvider", () => {
  it("resolves a pending confirmation as cancelled when it unmounts", async () => {
    const settled: Array<boolean | "unsettled"> = [];
    function Consumer() {
      const confirm = useConfirm();
      const ask = async () => {
        settled.push(await confirm({ title: "Delete everything?" }));
      };
      return (
        <button type="button" onClick={ask}>
          Ask
        </button>
      );
    }

    const user = userEvent.setup();
    const view = render(
      <ConfirmProvider>
        <Consumer />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByRole("alertdialog");
    expect(settled).toEqual([]);

    await act(async () => view.unmount());

    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).toEqual([false]);
  });

  it("still resolves true on confirm and false on cancel while mounted", async () => {
    const answers: boolean[] = [];
    let ask: (options: { title: string }) => Promise<boolean> = () => Promise.resolve(false);
    function Consumer() {
      const confirm = useConfirm();
      ask = confirm;
      return null;
    }
    render(
      <ConfirmProvider>
        <Consumer />
      </ConfirmProvider>,
    );
    const user = userEvent.setup();

    const confirmed = ask({ title: "Save?" });
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    answers.push(await confirmed);

    const cancelled = ask({ title: "Discard?" });
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    answers.push(await cancelled);

    expect(answers).toEqual([true, false]);
  });

  it("resolves a superseded confirmation as cancelled", async () => {
    const answers: Array<Promise<boolean>> = [];
    function Consumer() {
      const confirm = useConfirm();
      return (
        <button
          type="button"
          onClick={() => answers.push(confirm({ title: "One" }), confirm({ title: "Two" }))}
        >
          Ask twice
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <Consumer />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Ask twice" }));
    await waitFor(() => expect(screen.getByText("Two")).toBeInTheDocument());

    expect(await answers[0]).toBe(false);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await answers[1]).toBe(true);
  });
});
