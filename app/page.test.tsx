// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  afterEach(cleanup);

  it("explains what DevPulse is", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { name: "DevPulse" })).toBeTruthy();
    expect(screen.getByText(/flow and delivery satisfaction/i)).toBeTruthy();
    expect(screen.getByText(/sustainable workload and stress/i)).toBeTruthy();
    expect(screen.getByText(/fun and motivation/i)).toBeTruthy();
  });

  it("does not frame results as individual performance surveillance", () => {
    render(<Home />);

    expect(screen.getByText(/anonymous/i)).toBeTruthy();
    expect(screen.getByText(/team.*aggregated trends/i)).toBeTruthy();
  });

  it("links to the pulse survey, sign-in, sign-up, and results", () => {
    render(<Home />);

    expect(
      screen.getByRole("link", { name: /answer pulse/i }),
    ).toHaveProperty("href", expect.stringContaining("/pulse-survey"));
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveProperty(
      "href",
      expect.stringContaining("/sign-in"),
    );
    expect(
      screen.getByRole("link", { name: /create account/i }),
    ).toHaveProperty("href", expect.stringContaining("/sign-up"));
    expect(
      screen.getByRole("link", { name: /view results/i }),
    ).toHaveProperty("href", expect.stringContaining("/results"));
  });
});
