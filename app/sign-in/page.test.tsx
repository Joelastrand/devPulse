// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import SignInPage from "./page";

describe("SignInPage", () => {
  afterEach(cleanup);

  it("gives a clear path to sign-up for visitors without an account, in Norwegian", () => {
    render(<SignInPage />);

    const link = screen.getByRole("link", { name: /opprett en/i });
    expect(link.getAttribute("href")).toBe("/sign-up");
  });

  it("renders inside the shared page shell's <main> landmark", () => {
    render(<SignInPage />);

    expect(screen.getByRole("main")).toBeTruthy();
  });
});
