// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../../../src/components/ui/heading-structure";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signInMock = vi.fn();

vi.mock("../../../src/features/auth/client/auth-client", () => ({
  signIn: signInMock,
  observeIdToken: () => () => {},
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

const { default: SignInPage } = await import("./page");

function searchParamsOf(query: Record<string, string | string[] | undefined>) {
  return Promise.resolve(query);
}

describe("SignInPage", () => {
  afterEach(() => {
    cleanup();
    signInMock.mockReset();
  });

  it("gives a clear path to sign-up for visitors without an account, in Norwegian", async () => {
    render(await SignInPage({ searchParams: searchParamsOf({}) }));

    const link = screen.getByRole("link", { name: /opprett en/i });
    expect(link.getAttribute("href")).toBe("/sign-up");
  });

  it("shows the three value points and the form card in a split layout", async () => {
    const { container } = render(await SignInPage({ searchParams: searchParamsOf({}) }));

    expect(screen.getByText("Følg utvikling")).toBeTruthy();
    expect(screen.getByText("Jobb mot tydelige mål")).toBeTruthy();
    expect(screen.getByText("Styrk teamet")).toBeTruthy();
    const grid = container.querySelector("main > div");
    expect(grid?.className).toContain("lg:grid-cols-[");
    expect(screen.getByLabelText("E-postadresse")).toBeTruthy();
    expect(screen.getByLabelText("Passord")).toBeTruthy();
  });

  it("does not render Google sign-in, remember-me or forgotten-password controls", async () => {
    render(await SignInPage({ searchParams: searchParamsOf({}) }));

    expect(screen.queryByText(/google/i)).toBeNull();
    expect(screen.queryByText(/husk meg/i)).toBeNull();
    expect(screen.queryByText(/glemt passord/i)).toBeNull();
  });

  it("uses the landscape art as decorative, hidden background only", async () => {
    const { container } = render(await SignInPage({ searchParams: searchParamsOf({}) }));

    const art = container.querySelector("svg[aria-hidden='true']");
    expect(art).not.toBeNull();
    expect(art?.closest("main > div")?.className).toContain("relative");
    expect(art?.getAttribute("class")).toContain("lg:w-1/2");
    expect(art?.getAttribute("class")).toContain("lg:right-0");
    expect(art?.getAttribute("class")).toContain("lg:h-full");
    expect(art?.getAttribute("class")).toContain("pointer-events-none");
  });

  it("paints the form content and card above the decorative art so the art never covers them", async () => {
    const { container } = render(await SignInPage({ searchParams: searchParamsOf({}) }));

    const grid = container.querySelector("main > div");
    const children = Array.from(grid?.children ?? []);
    const art = children.find((child) => child.tagName.toLowerCase() === "svg");
    const content = children.find((child) => child.tagName.toLowerCase() === "section");
    const card = children[children.length - 1];

    expect(art).toBeDefined();
    expect(content?.className).toContain("relative");
    expect(card).not.toBe(art);
    expect(card.className).toContain("relative");
  });

  it("renders inside the shared page shell's <main> landmark", async () => {
    render(await SignInPage({ searchParams: searchParamsOf({}) }));

    expect(screen.getByRole("main")).toBeTruthy();
  });

  it("with no continue param, redirects to / after sign-in (unchanged default)", async () => {
    signInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(await SignInPage({ searchParams: searchParamsOf({}) }));

    await user.type(screen.getByLabelText("E-postadresse"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    const link = await screen.findByRole("link", { name: /fortsett til team/i });
    expect(link.getAttribute("href")).toBe("/");
  });

  it("with a valid /survey/{surveyId} continue param, redirects there after sign-in", async () => {
    signInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(
      await SignInPage({
        searchParams: searchParamsOf({ continue: "/survey/abc123" }),
      }),
    );

    await user.type(screen.getByLabelText("E-postadresse"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    const link = await screen.findByRole("link", {
      name: /fortsett til undersøkelsen/i,
    });
    expect(link.getAttribute("href")).toBe("/survey/abc123");
  });

  it("with an external URL as the continue param, falls back to / rather than redirecting there", async () => {
    signInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(
      await SignInPage({
        searchParams: searchParamsOf({ continue: "https://evil.example" }),
      }),
    );

    await user.type(screen.getByLabelText("E-postadresse"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    const link = await screen.findByRole("link", { name: /fortsett til team/i });
    expect(link.getAttribute("href")).toBe("/");
  });
});

describe("sign-in heading structure (visual-redesign TASK-019)", () => {
  it("keeps one level-1 headline and a valid hierarchy for the split layout", async () => {
    render(await SignInPage({ searchParams: searchParamsOf({}) }));
    await screen.findByRole("heading", { level: 1 });
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark and a valid heading structure with one level-1 title", async () => {
    render(await SignInPage({ searchParams: searchParamsOf({}) }));
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});
