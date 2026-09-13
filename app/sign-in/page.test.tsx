// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signInMock = vi.fn();

vi.mock("../../src/features/auth/client/auth-client", () => ({
  signIn: signInMock,
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

  it("renders inside the shared page shell's <main> landmark", async () => {
    render(await SignInPage({ searchParams: searchParamsOf({}) }));

    expect(screen.getByRole("main")).toBeTruthy();
  });

  it("with no continue param, redirects to /teams after sign-in (unchanged default)", async () => {
    signInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(await SignInPage({ searchParams: searchParamsOf({}) }));

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    const link = await screen.findByRole("link", { name: /fortsett til team/i });
    expect(link.getAttribute("href")).toBe("/teams");
  });

  it("with a valid /survey/{surveyId} continue param, redirects there after sign-in", async () => {
    signInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(
      await SignInPage({
        searchParams: searchParamsOf({ continue: "/survey/abc123" }),
      }),
    );

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    const link = await screen.findByRole("link", {
      name: /fortsett til undersøkelsen/i,
    });
    expect(link.getAttribute("href")).toBe("/survey/abc123");
  });

  it("with an external URL as the continue param, falls back to /teams rather than redirecting there", async () => {
    signInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(
      await SignInPage({
        searchParams: searchParamsOf({ continue: "https://evil.example" }),
      }),
    );

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    const link = await screen.findByRole("link", { name: /fortsett til team/i });
    expect(link.getAttribute("href")).toBe("/teams");
  });
});
