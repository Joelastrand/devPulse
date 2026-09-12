// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  afterEach(cleanup);

  it("announces its message via role=status", () => {
    render(<EmptyState>Ingen team ennå.</EmptyState>);

    expect(screen.getByRole("status").textContent).toBe("Ingen team ennå.");
  });
});
