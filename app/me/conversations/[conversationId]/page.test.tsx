// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/me/conversations/conv-1" }));
const detailProps: { conversationId: string }[] = [];
vi.mock("../../../../src/features/development-conversations/components/ConversationDetail", () => ({
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
