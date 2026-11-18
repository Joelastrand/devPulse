// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { systemsCopy } from "../copy";
import { SystemForm } from "./SystemForm";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderForm(onSubmit: Parameters<typeof SystemForm>[0]["onSubmit"]) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(<SystemForm system={null} members={[]} membersStatus="ok" onSubmit={onSubmit} onDone={onDone} onCancel={onCancel} />);
  return { onDone, onCancel };
}

describe("SystemForm save state", () => {
  afterEach(cleanup);

  it("shows a pending label and sends only one write when the form is submitted again while saving", async () => {
    const pending = deferred<{ ok: true; systemId: string }>();
    const onSubmit = vi.fn(() => pending.promise);
    renderForm(onSubmit);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(systemsCopy.form.name), "Testsystem");

    const form = screen.getByLabelText(systemsCopy.form.name).closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const busy = screen.getByRole("button", { name: systemsCopy.saving });
    expect(busy.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      pending.resolve({ ok: true, systemId: "s1" });
    });
  });

  it("closes only after the server confirms the save", async () => {
    const pending = deferred<{ ok: true; systemId: string }>();
    const { onDone } = renderForm(() => pending.promise);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(systemsCopy.form.name), "Testsystem");
    await user.click(screen.getByRole("button", { name: systemsCopy.form.save }));

    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve({ ok: true, systemId: "s1" });
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("keeps the typed name after a refused save and restores the save button", async () => {
    const onSubmit = vi.fn(async () => ({ ok: false as const, error: "forbidden" as const }));
    const { onDone } = renderForm(onSubmit);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(systemsCopy.form.name), "Behold navnet");
    await user.click(screen.getByRole("button", { name: systemsCopy.form.save }));

    await waitFor(() => expect(screen.getByRole("button", { name: systemsCopy.form.save }).hasAttribute("disabled")).toBe(false));
    expect((screen.getByLabelText(systemsCopy.form.name) as HTMLInputElement).value).toBe("Behold navnet");
    expect(onDone).not.toHaveBeenCalled();
  });
});
