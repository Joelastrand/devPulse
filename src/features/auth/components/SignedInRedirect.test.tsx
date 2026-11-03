// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const observeIdTokenMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("../client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

const { SignedInRedirect } = await import("./SignedInRedirect");

function subscribingWith(...tokens: Array<string | null>) {
  return (callback: (token: string | null) => void) => {
    for (const token of tokens) callback(token);
    return () => {};
  };
}

describe("SignedInRedirect", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    replaceMock.mockReset();
  });

  it("redirects a signed-in visitor to /teams by default", () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    render(<SignedInRedirect />);

    expect(replaceMock).toHaveBeenCalledWith("/teams");
  });

  it("redirects to a validated survey continuation", () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    render(<SignedInRedirect continuation="/survey/abc123" />);

    expect(replaceMock).toHaveBeenCalledWith("/survey/abc123");
  });

  it("ignores an unsafe continuation and uses the default", () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    render(<SignedInRedirect continuation="https://evil.example/" />);

    expect(replaceMock).toHaveBeenCalledWith("/teams");
  });

  it("does not redirect a visitor who is signed out", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<SignedInRedirect />);

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect after a sign-in completed on the page", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null, "a-token"));
    render(<SignedInRedirect />);

    expect(replaceMock).not.toHaveBeenCalled();
  });
});
