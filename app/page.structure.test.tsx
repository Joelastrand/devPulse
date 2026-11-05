// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../src/components/ui/heading-structure";

let currentToken: string | null = null;

vi.mock("../src/features/auth/client/auth-client", () => ({
  observeIdToken: (callback: (token: string | null) => void) => {
    callback(currentToken);
    return () => {};
  },
}));
// The signed-in home's main landmark comes from PageShell inside AuthenticatedHome; the mock keeps that shell.
vi.mock("../src/features/home/components/AuthenticatedHome", async () => {
  const { PageShell } = await import("../src/components/ui/PageShell");
  return {
    AuthenticatedHome: () => (
      <PageShell>
        <h1>Hjem</h1>
      </PageShell>
    ),
  };
});

const { default: Home } = await import("./page");

describe("signed-out home route structure (visual-redesign TASK-019)", () => {
  afterEach(() => {
    cleanup();
    currentToken = null;
  });

  it("renders one main landmark and a valid heading structure with one level-1 headline", () => {
    render(<Home />);

    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});

describe("signed-in home route structure (visual-redesign TASK-019, reference 03)", () => {
  afterEach(() => {
    cleanup();
    currentToken = null;
  });

  it("renders one main landmark from the app shell and a valid heading structure for the signed-in home", async () => {
    currentToken = "a-token";
    render(<Home />);

    await screen.findByRole("heading", { level: 1, name: "Hjem" });
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});
