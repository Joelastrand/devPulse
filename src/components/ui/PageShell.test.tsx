// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CONTAINER_CLASSNAMES } from "./Container";
import { CONTAINER_FOR_WIDTH, PageShell, type PageShellWidth } from "./PageShell";

const WIDTHS = Object.keys(CONTAINER_FOR_WIDTH) as PageShellWidth[];

describe("PageShell", () => {
  afterEach(cleanup);

  it("renders its children inside a <main> landmark", () => {
    render(
      <PageShell>
        <p>Innhold</p>
      </PageShell>,
    );

    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByText("Innhold")).toBeTruthy();
  });

  it.each(WIDTHS)("gives the %s width the container it maps to", (width) => {
    const { container } = render(
      <PageShell width={width}>
        <p>Innhold</p>
      </PageShell>,
    );

    const expected = CONTAINER_CLASSNAMES[CONTAINER_FOR_WIDTH[width]];
    expect(container.querySelector(".max-w-main, .max-w-reading, .max-w-survey, .max-w-auth")?.className).toBe(expected);
  });

  it("maps the default to the main container", () => {
    expect(CONTAINER_FOR_WIDTH["3xl"]).toBe("main");
  });

  it("maps the sign-in width to the auth container and the survey width to the survey container", () => {
    expect(CONTAINER_FOR_WIDTH.sm).toBe("auth");
    expect(CONTAINER_FOR_WIDTH.lg).toBe("survey");
  });
});
