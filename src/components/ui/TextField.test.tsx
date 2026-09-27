// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextField } from "./TextField";

describe("TextField", () => {
  afterEach(cleanup);

  it("renders a real, associated label for the native input", () => {
    render(<TextField id="email" label="E-post" value="" onChange={() => {}} />);

    const input = screen.getByLabelText("E-post");
    expect(input.tagName).toBe("INPUT");
  });

  it("passes native input props straight through unchanged", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TextField
        id="email"
        label="E-post"
        type="email"
        autoComplete="email"
        required
        placeholder="deg@eksempel.no"
        value=""
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText("E-post") as HTMLInputElement;
    expect(input.type).toBe("email");
    expect(input.autocomplete).toBe("email");
    expect(input.required).toBe(true);
    expect(input.placeholder).toBe("deg@eksempel.no");

    await user.type(input, "a");
    expect(onChange).toHaveBeenCalled();
  });

  it("has neither aria-invalid nor aria-describedby when no description/error is supplied", () => {
    render(<TextField id="email" label="E-post" value="" onChange={() => {}} />);

    const input = screen.getByLabelText("E-post");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });

  it("associates a description via aria-describedby", () => {
    render(
      <TextField
        id="name"
        label="Navn"
        description="Vises for andre medlemmer."
        value=""
        onChange={() => {}}
      />,
    );

    const input = screen.getByLabelText("Navn");
    const description = screen.getByText("Vises for andre medlemmer.");
    expect(description.id).toBe("name-description");
    expect(input.getAttribute("aria-describedby")).toBe("name-description");
  });

  it("sets aria-invalid and associates the error via aria-describedby, rendered as an alert", () => {
    render(
      <TextField id="email" label="E-post" error="Ugyldig e-postadresse." value="" onChange={() => {}} />,
    );

    const input = screen.getByLabelText("E-post");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Ugyldig e-postadresse.");
    expect(alert.id).toBe("email-error");
    expect(input.getAttribute("aria-describedby")).toBe("email-error");
  });

  it("associates both a description and an error together, in one aria-describedby", () => {
    render(
      <TextField
        id="name"
        label="Navn"
        description="Vises for andre medlemmer."
        error="Påkrevd."
        value=""
        onChange={() => {}}
      />,
    );

    const input = screen.getByLabelText("Navn");
    expect(input.getAttribute("aria-describedby")).toBe("name-description name-error");
    expect(screen.getByText("Vises for andre medlemmer.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Påkrevd.");
  });

  it("forwards a caller className alongside the shared field treatment", () => {
    render(<TextField id="email" label="E-post" className="extra-class" value="" onChange={() => {}} />);

    expect(screen.getByLabelText("E-post").className).toMatch(/extra-class/);
  });
});
