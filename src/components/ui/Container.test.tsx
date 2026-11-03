// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CONTAINER_CLASSNAMES, Container, type ContainerVariant } from "./Container";

describe("Container", () => {
  afterEach(cleanup);

  it.each([
    ["main", "max-w-main"],
    ["reading", "max-w-reading"],
    ["survey", "max-w-survey"],
    ["auth", "max-w-auth"],
  ] as const)("the %s container is capped at its SPEC width token", (variant, cap) => {
    const { container } = render(<Container variant={variant}>x</Container>);

    expect(container.firstElementChild?.className).toContain(cap);
  });

  it("has the SPEC widths: main 1200, reading 680, survey 560, auth 420", () => {
    expect(CONTAINER_CLASSNAMES.main).toContain("max-w-main");
    expect(CONTAINER_CLASSNAMES.reading).toContain("max-w-reading");
    expect(CONTAINER_CLASSNAMES.survey).toContain("max-w-survey");
    expect(CONTAINER_CLASSNAMES.auth).toContain("max-w-auth");
  });

  it("centres every container and keeps it full-width below its cap", () => {
    const variants: ContainerVariant[] = ["main", "reading", "survey", "auth"];
    for (const variant of variants) {
      expect(CONTAINER_CLASSNAMES[variant]).toMatch(/mx-auto/);
      expect(CONTAINER_CLASSNAMES[variant]).toMatch(/(^|\s)w-full(\s|$)/);
    }
  });

  it("uses a 16 px gutter on mobile and 32 px on desktop", () => {
    expect(CONTAINER_CLASSNAMES.main).toMatch(/(^|\s)px-4(\s|$)/);
    expect(CONTAINER_CLASSNAMES.main).toMatch(/md:px-8/);
  });
});
