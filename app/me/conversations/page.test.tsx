// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/me/conversations" }));
vi.mock("../../../src/features/development-conversations/components/ConversationsPage", () => ({
  ConversationsPage: () => <div data-testid="conversations-page" />,
}));

const { default: MyConversationsPage } = await import("./page");

afterEach(cleanup);

describe("/me/conversations page", () => {
  it("renders the Samtaler heading, the conversations feature component and the shared personal navigation with only Samtaler current", () => {
    render(<MyConversationsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Samtaler" })).toBeTruthy();
    expect(screen.getByTestId("conversations-page")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Personlig utvikling" });
    const current = nav.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe("Samtaler");
  });
});
