// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { expectHeadingStructure } from "../src/components/ui/heading-structure";

const observeIdTokenMock = vi.fn();

vi.mock("../src/features/auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../src/components/nav/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock("../src/features/home/components/AuthenticatedHome", () => ({
  AuthenticatedHome: () => <h1>Hjem</h1>,
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

    expect(screen.getByRole("heading", { name: "Fra innsikt til utvikling – sammen" })).toBeTruthy();
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

    expect(
      screen.getByText(
        "Svarene lagres uten navn eller e-postadresse. Individuelle svar vises aldri. Teamet ser bare samlede resultater, og først når nok personer har svart.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/anonym/i)).toBeNull();
    expect(screen.queryByText(/individuelle poeng/i)).toBeNull();
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

      expect(screen.getAllByRole("link", { name: /logg inn/i }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("link", { name: /opprett konto/i }).length).toBeGreaterThan(0);
      expect(screen.queryByRole("link", { name: /mine team/i })).toBeNull();
    });
  });

  describe("signed out", () => {
    it("shows exactly Logg inn and Opprett konto, in Norwegian, and no Mine team", () => {
      observeIdTokenMock.mockImplementation(subscribingWith(null));
      render(<Home />);

      for (const link of screen.getAllByRole("link", { name: /logg inn/i })) {
        expect(link).toHaveProperty("href", expect.stringContaining("/sign-in"));
      }
      for (const link of screen.getAllByRole("link", { name: /opprett konto/i })) {
        expect(link).toHaveProperty("href", expect.stringContaining("/sign-up"));
      }
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

    it("renders the authenticated home inside the app shell, not the public header", () => {
      observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
      render(<Home />);

      expect(screen.getByTestId("app-shell")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Hjem" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: /opprett konto/i })).toBeNull();
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

describe("Home composition (visual-redesign TASK-003, BR-10)", () => {
  const lockedLine =
    "Svarene lagres uten navn eller e-postadresse. Individuelle svar vises aldri. Teamet ser bare samlede resultater, og først når nok personer har svart.";

  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
  });

  it("shows the locked class A line verbatim exactly once, in the trust band", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<Home />);

    const matches = screen.getAllByText(lockedLine);
    expect(matches).toHaveLength(1);
    expect(matches[0].closest("ul")).not.toBeNull();
  });

  it("does not use the shortened privacy claim as a trust item", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<Home />);

    expect(screen.queryByText("Svar uten navn eller e-postadresse")).toBeNull();
  });

  it("does not show the excluded trust item 'Enkel å bruke' (visual-redesign BR-10)", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<Home />);

    expect(screen.queryByText("Enkel å bruke")).toBeNull();
  });

  it("renders no excluded reference copy", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<Home />);

    for (const excluded of [
      /gratis/i,
      /priser/i,
      /produkt/i,
      /sikkerhet og personvern/i,
      /se hvordan det fungerer/i,
      /skaper engasjement/i,
      /enkel å bruke/i,
    ]) {
      expect(screen.queryByText(excluded)).toBeNull();
    }
  });

  it("renders hero, value strip and trust band in that order", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<Home />);

    const h1 = screen.getByRole("heading", { level: 1 });
    const valueHeading = screen.getByRole("heading", { name: "Følg utvikling" });
    const trustLine = screen.getAllByText(lockedLine)[0];

    expect(h1.compareDocumentPosition(valueHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(valueHeading.compareDocumentPosition(trustLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps both primary actions as keyboard-reachable links", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<Home />);

    const actions = [
      ...screen.getAllByRole("link", { name: "Logg inn" }),
      ...screen.getAllByRole("link", { name: "Opprett konto" }),
    ];
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.tabIndex).not.toBe(-1);
    }
  });
});

describe("Home privacy line (class A, TASK-014)", () => {
  it("contains the old wording neither in the copy nor the word anonym", async () => {
    const { homeCopy } = await import("./page.copy");
    expect(homeCopy.privacyNote).toBe(
      "Svarene lagres uten navn eller e-postadresse. Individuelle svar vises aldri. Teamet ser bare samlede resultater, og først når nok personer har svart.",
    );
    expect(homeCopy.privacyNote).not.toMatch(/anonym/i);
    expect(homeCopy.privacyNote).not.toContain("Individuelle svar er anonyme");
  });
});

describe("signed-out home heading structure (visual-redesign TASK-019)", () => {
  it("keeps one level-1 headline and a valid hierarchy for the landing composition", () => {
    render(<Home />);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});
