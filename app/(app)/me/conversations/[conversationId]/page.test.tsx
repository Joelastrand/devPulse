// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../../../../../src/components/ui/heading-structure";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/me/conversations/conv-1" }));
const detailProps: { conversationId: string }[] = [];
vi.mock("../../../../../src/features/development-conversations/components/ConversationDetail", () => ({
  ConversationDetail: (props: { conversationId: string }) => {
    detailProps.push(props);
    return <div data-testid="conversation-detail" />;
  },
}));

const { default: MyConversationDetailPage } = await import("./page");

afterEach(() => {
  cleanup();
  detailProps.length = 0;
});

describe("/me/conversations/[conversationId] page", () => {
  it("renders the Samtale heading, the shared personal navigation, and passes only the route id to the client view", async () => {
    render(await MyConversationDetailPage({ params: Promise.resolve({ conversationId: "conv-1" }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Samtale" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Personlig utvikling" })).toBeTruthy();
    expect(screen.getByTestId("conversation-detail")).toBeTruthy();
    expect(detailProps).toEqual([{ conversationId: "conv-1" }]);
  });
});

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark and a valid heading structure with one level-1 title", async () => {
    render(await MyConversationDetailPage({ params: Promise.resolve({ conversationId: "conv-1" }) }));
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});
