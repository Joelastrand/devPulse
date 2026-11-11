// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../../../../src/components/ui/heading-structure";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/me/conversations" }));
vi.mock("../../../../src/features/development-conversations/components/ConversationsPage", () => ({
  ConversationsPage: () => <div data-testid="conversations-page" />,
}));

const { default: MyConversationsPage } = await import("./page");

afterEach(cleanup);

describe("/me/conversations page", () => {
  it("renders the Samtaler heading and the conversations feature component, without a duplicate page-level nav", () => {
    render(<MyConversationsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Samtaler" })).toBeTruthy();
    expect(screen.getByTestId("conversations-page")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Personlig utvikling" })).toBeNull();
  });
});

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark and a valid heading structure with one level-1 title", async () => {
    render(<MyConversationsPage />);
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});
