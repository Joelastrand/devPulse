// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordRow } from "./RecordRow";

afterEach(() => {
  cleanup();
});

function renderRow() {
  render(
    <ul>
      <RecordRow title="Driftsansvar" meta="Innenfor rollen · fra 2026-01-01" quickAction={<button type="button">Marker som fullført</button>}>
        <p>Synthetic description</p>
        <button type="button">Rediger</button>
      </RecordRow>
    </ul>,
  );
}

describe("RecordRow", () => {
  it("is collapsed by default: the title, meta line and quick action are visible, the details are not", () => {
    renderRow();

    expect(screen.getByRole("heading", { name: "Driftsansvar" })).toBeTruthy();
    expect(screen.getByText("Innenfor rollen · fra 2026-01-01")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Marker som fullført" })).toBeTruthy();
    expect(screen.queryByText("Synthetic description")).toBeNull();
    expect(screen.getByRole("button", { name: "Driftsansvar" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("expands from the title button, reveals the details and links the button to the panel", async () => {
    const user = userEvent.setup();
    renderRow();
    const toggle = screen.getByRole("button", { name: "Driftsansvar" });

    await user.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "missing");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Synthetic description");
    expect(screen.getByRole("button", { name: "Rediger" })).toBeTruthy();
  });

  it("collapses again on a second click", async () => {
    const user = userEvent.setup();
    renderRow();
    const toggle = screen.getByRole("button", { name: "Driftsansvar" });

    await user.click(toggle);
    await user.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Synthetic description")).toBeNull();
  });

  it("keeps the quick action outside the disclosure button, so no control is nested in another", () => {
    renderRow();

    const toggle = screen.getByRole("button", { name: "Driftsansvar" });
    expect(toggle.contains(screen.getByRole("button", { name: "Marker som fullført" }))).toBe(false);
  });
});
