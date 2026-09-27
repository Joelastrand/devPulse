// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextArea } from "./TextArea";

describe("TextArea", () => {
  afterEach(cleanup);

  it("renders a real, associated label for the native textarea", () => {
    render(<TextArea id="body" label="Innhold" value="" onChange={() => {}} />);

    const textarea = screen.getByLabelText("Innhold");
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("passes native textarea props straight through unchanged", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TextArea id="body" label="Innhold" rows={6} placeholder="Skriv her" value="" onChange={onChange} />,
    );

    const textarea = screen.getByLabelText("Innhold") as HTMLTextAreaElement;
    expect(textarea.rows).toBe(6);
    expect(textarea.placeholder).toBe("Skriv her");

    await user.type(textarea, "a");
    expect(onChange).toHaveBeenCalled();
  });

  it("associates a description and an error together via aria-describedby, and sets aria-invalid", () => {
    render(
      <TextArea
        id="body"
        label="Innhold"
        description="Maks 2000 tegn."
        error="For kort."
        value=""
        onChange={() => {}}
      />,
    );

    const textarea = screen.getByLabelText("Innhold");
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(textarea.getAttribute("aria-describedby")).toBe("body-description body-error");
    expect(screen.getByText("Maks 2000 tegn.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("For kort.");
  });

  it("has neither aria-invalid nor aria-describedby when no description/error is supplied", () => {
    render(<TextArea id="body" label="Innhold" value="" onChange={() => {}} />);

    const textarea = screen.getByLabelText("Innhold");
    expect(textarea.getAttribute("aria-invalid")).toBeNull();
    expect(textarea.getAttribute("aria-describedby")).toBeNull();
  });
});
