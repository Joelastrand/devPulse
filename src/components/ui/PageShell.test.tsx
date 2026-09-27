// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageShell, WIDTH_CLASSNAMES, type PageShellWidth } from "./PageShell";

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

  it.each(Object.keys(WIDTH_CLASSNAMES) as PageShellWidth[])(
    "renders the %s width token's own max-width class, and no other token's",
    (width) => {
      render(
        <PageShell width={width}>
          <p>Innhold</p>
        </PageShell>,
      );

      const main = screen.getByRole("main");
      expect(main.className).toContain(WIDTH_CLASSNAMES[width]);
      for (const [otherWidth, otherClassName] of Object.entries(WIDTH_CLASSNAMES)) {
        if (otherWidth !== width) {
          expect(main.className).not.toContain(otherClassName);
        }
      }
    },
  );

  it("defaults to the existing 3xl width when none is supplied", () => {
    render(
      <PageShell>
        <p>Innhold</p>
      </PageShell>,
    );

    expect(screen.getByRole("main").className).toContain(WIDTH_CLASSNAMES["3xl"]);
  });

  it("accepts the new wide token, materially wider than the existing 3xl default", () => {
    render(
      <PageShell width="wide">
        <p>Innhold</p>
      </PageShell>,
    );

    expect(screen.getByRole("main").className).toContain(WIDTH_CLASSNAMES.wide);
    expect(WIDTH_CLASSNAMES.wide).not.toBe(WIDTH_CLASSNAMES["3xl"]);
  });
});
