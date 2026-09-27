// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./Select";

describe("Select", () => {
  afterEach(cleanup);

  it("renders a real, associated label for the native select, with caller-supplied options", () => {
    render(
      <Select id="role" label="Rolle" value="member" onChange={() => {}}>
        <option value="member">Medlem</option>
        <option value="admin">Admin</option>
      </Select>,
    );

    const select = screen.getByLabelText("Rolle") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Medlem" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Admin" })).toBeTruthy();
  });

  it("passes native select props straight through and reports the caller's onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select id="role" label="Rolle" value="member" onChange={onChange}>
        <option value="member">Medlem</option>
        <option value="admin">Admin</option>
      </Select>,
    );

    await user.selectOptions(screen.getByLabelText("Rolle"), "admin");
    expect(onChange).toHaveBeenCalled();
  });

  it("sets aria-invalid and associates the error via aria-describedby", () => {
    render(
      <Select id="role" label="Rolle" error="Velg en rolle." value="" onChange={() => {}}>
        <option value="">–</option>
      </Select>,
    );

    const select = screen.getByLabelText("Rolle");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Velg en rolle.");
    expect(select.getAttribute("aria-describedby")).toBe("role-error");
  });

  it("has neither aria-invalid nor aria-describedby when no description/error is supplied", () => {
    render(
      <Select id="role" label="Rolle" value="member" onChange={() => {}}>
        <option value="member">Medlem</option>
      </Select>,
    );

    const select = screen.getByLabelText("Rolle");
    expect(select.getAttribute("aria-invalid")).toBeNull();
    expect(select.getAttribute("aria-describedby")).toBeNull();
  });
});
