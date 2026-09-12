// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageShell } from "./PageShell";

describe("PageShell", () => {
  afterEach(cleanup);

  it("renders its children inside a <main> landmark", () => {
    render(
      <PageShell>
        <p>Innhold</p>
      </PageShell>,
    );

    const main = screen.getByRole("main");
    expect(main).toBeTruthy();
    expect(screen.getByText("Innhold")).toBeTruthy();
  });
});
