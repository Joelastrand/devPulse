// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { UnsavedChangesContext, useReportUnsaved, type UnsavedChangesReporter } from "./unsaved-changes";

afterEach(cleanup);

/** A test section whose dirty state the test drives through a button-free prop, the same way a draft drives the hook. */
function Section({ dirty }: { dirty: boolean }) {
  useReportUnsaved("notes", dirty);
  return null;
}

describe("useReportUnsaved", () => {
  it("reports the section's dirty state to the detail's reporter", () => {
    const report = vi.fn();
    const reporter: UnsavedChangesReporter = { report };
    render(
      <UnsavedChangesContext.Provider value={reporter}>
        <Section dirty />
      </UnsavedChangesContext.Provider>,
    );
    expect(report).toHaveBeenCalledWith("notes", true);
  });

  it("clears its report when the dirty state changes to clean", () => {
    const report = vi.fn();
    const reporter: UnsavedChangesReporter = { report };
    const { rerender } = render(
      <UnsavedChangesContext.Provider value={reporter}>
        <Section dirty />
      </UnsavedChangesContext.Provider>,
    );
    rerender(
      <UnsavedChangesContext.Provider value={reporter}>
        <Section dirty={false} />
      </UnsavedChangesContext.Provider>,
    );
    expect(report.mock.calls.at(-1)).toEqual(["notes", false]);
  });

  it("clears its report when the section unmounts, so removed drafts never block leaving", () => {
    const report = vi.fn();
    const reporter: UnsavedChangesReporter = { report };
    function Host() {
      const [visible] = useState(true);
      return visible ? <Section dirty /> : null;
    }
    const { unmount } = render(
      <UnsavedChangesContext.Provider value={reporter}>
        <Host />
      </UnsavedChangesContext.Provider>,
    );
    unmount();
    expect(report.mock.calls.at(-1)).toEqual(["notes", false]);
  });

  it("does nothing and does not throw without a provider", () => {
    expect(() => render(<Section dirty />)).not.toThrow();
  });
});
