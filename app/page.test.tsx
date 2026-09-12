// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  afterEach(cleanup);

  it("explains what DevPulse is, in Norwegian", () => {
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
    render(<Home />);

    expect(screen.getByText(/anonyme/i)).toBeTruthy();
    expect(screen.getByText(/team.*samlede trender/i)).toBeTruthy();
  });

  it("renders exactly one top-level heading", () => {
    render(<Home />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("links to the pulse survey, sign-in, sign-up, and results, in Norwegian", () => {
    render(<Home />);

    expect(
      screen.getByRole("link", { name: /svar på pulsmåling/i }),
    ).toHaveProperty("href", expect.stringContaining("/pulse-survey"));
    expect(screen.getByRole("link", { name: /logg inn/i })).toHaveProperty(
      "href",
      expect.stringContaining("/sign-in"),
    );
    expect(
      screen.getByRole("link", { name: /opprett konto/i }),
    ).toHaveProperty("href", expect.stringContaining("/sign-up"));
    expect(
      screen.getByRole("link", { name: /se resultater/i }),
    ).toHaveProperty("href", expect.stringContaining("/results"));
  });

  it("contains no leftover English marketing copy", () => {
    render(<Home />);

    expect(screen.queryByText(/answer pulse/i)).toBeNull();
    expect(screen.queryByText(/view results/i)).toBeNull();
    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(screen.queryByText(/create account/i)).toBeNull();
  });

  it("renders inside the shared page shell's <main> landmark", () => {
    render(<Home />);

    expect(screen.getByRole("main")).toBeTruthy();
  });
});
