// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Alert } from "./Alert";

describe("Alert", () => {
  afterEach(cleanup);

  it("uses role=alert for the error variant", () => {
    render(<Alert variant="error">Noe gikk galt.</Alert>);

    expect(screen.getByRole("alert").textContent).toBe("Noe gikk galt.");
  });

  it("uses role=status for the info variant", () => {
    render(<Alert variant="info">Vennligst vent.</Alert>);

    expect(screen.getByRole("status").textContent).toBe("Vennligst vent.");
  });

  it("uses role=status for the success variant", () => {
    render(<Alert variant="success">Lagret.</Alert>);

    expect(screen.getByRole("status").textContent).toBe("Lagret.");
  });

  it("defaults to the info variant", () => {
    render(<Alert>Standard.</Alert>);

    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders the message verbatim, never rewriting it", () => {
    render(<Alert variant="error">unmapped_internal_error_code</Alert>);

    expect(screen.getByText("unmapped_internal_error_code")).toBeTruthy();
  });
});
