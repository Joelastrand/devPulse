// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SignInPage from "./page";

describe("SignInPage", () => {
  it("gives a clear path to sign-up for visitors without an account", () => {
    render(<SignInPage />);

    const link = screen.getByRole("link", { name: /create one/i });
    expect(link.getAttribute("href")).toBe("/sign-up");
  });
});
