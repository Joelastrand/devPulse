// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LoadingState } from "./LoadingState";

describe("LoadingState", () => {
  afterEach(cleanup);

  it("announces a default Norwegian loading message via role=status", () => {
    render(<LoadingState />);

    expect(screen.getByRole("status").textContent).toBe("Laster…");
  });

  it("announces a caller-supplied label instead of the default", () => {
    render(<LoadingState label="Laster team…" />);

    expect(screen.getByRole("status").textContent).toBe("Laster team…");
  });
});
