// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const observeIdTokenMock = vi.fn();

vi.mock("../src/features/auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

const { default: Home } = await import("./page");

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

describe("Home", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
  });

  it("explains what DevPulse is, in Norwegian", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<Home />);

    expect(screen.getByRole("heading", { name: "DevPulse" })).toBeTruthy();
    expect(
      screen.getByText(/arbeidsflyt og leveransetilfredshet/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/bærekraftig arbeidsmengde og stress/i),
    ).toBeTruthy();
    expect(screen.getByText(/glede og motivasjon/i)).toBeTruthy();
  });

  it("does not frame results as individual performance surveillance", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<Home />);

    expect(screen.getByText(/anonyme/i)).toBeTruthy();
    expect(screen.getByText(/team.*samlede trender/i)).toBeTruthy();
  });

  it("renders exactly one top-level heading", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<Home />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders inside the shared page shell's <main> landmark", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<Home />);

    expect(screen.getByRole("main")).toBeTruthy();
  });

  describe("before the first auth event (fails closed to signed-out)", () => {
    it("shows sign-in/sign-up, never Mine team", () => {
      observeIdTokenMock.mockImplementation(() => () => {});
      render(<Home />);

      expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
      expect(screen.getByRole("link", { name: /opprett konto/i })).toBeTruthy();
      expect(screen.queryByRole("link", { name: /mine team/i })).toBeNull();
    });
  });

  describe("signed out", () => {
    it("shows exactly Logg inn and Opprett konto, in Norwegian, and no Mine team", () => {
      observeIdTokenMock.mockImplementation(subscribingWith(null));
      render(<Home />);

      expect(screen.getByRole("link", { name: /logg inn/i })).toHaveProperty(
        "href",
        expect.stringContaining("/sign-in"),
      );
      expect(
        screen.getByRole("link", { name: /opprett konto/i }),
      ).toHaveProperty("href", expect.stringContaining("/sign-up"));
      expect(screen.queryByRole("link", { name: /mine team/i })).toBeNull();
    });

    it("never links to the retired public pulse-survey page or a results view", () => {
      observeIdTokenMock.mockImplementation(subscribingWith(null));
      render(<Home />);

      expect(screen.queryByRole("link", { name: /pulsmåling/i })).toBeNull();
      expect(screen.queryByRole("link", { name: /resultater/i })).toBeNull();
    });
  });

  describe("signed in", () => {
    it("never shows Logg inn or Opprett konto", () => {
      observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
      render(<Home />);

      expect(screen.queryByRole("link", { name: /logg inn/i })).toBeNull();
      expect(screen.queryByRole("link", { name: /opprett konto/i })).toBeNull();
    });

    it("shows a Mine team action linking to /teams", () => {
      observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
      render(<Home />);

      expect(screen.getByRole("link", { name: /mine team/i })).toHaveProperty(
        "href",
        expect.stringContaining("/teams"),
      );
    });
  });

  it("contains no leftover English marketing copy", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<Home />);

    expect(screen.queryByText(/answer pulse/i)).toBeNull();
    expect(screen.queryByText(/view results/i)).toBeNull();
    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(screen.queryByText(/create account/i)).toBeNull();
  });
});
