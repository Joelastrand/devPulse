// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { erasureCopy } from "../copy";
import { ErasureEntryLink } from "./ErasureEntryLink";

// TASK-039: the profile page's entry link to the erasure confirmation.

afterEach(() => {
  cleanup();
});

describe("ErasureEntryLink", () => {
  it("links the profile page to the erasure confirmation under the approved label", () => {
    render(<ErasureEntryLink />);

    const link = screen.getByRole("link", { name: erasureCopy.profileLinkLabel });
    expect(link.getAttribute("href")).toBe("/me/erasure");
  });
});
