// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CompletionIllustration, ConversationsIllustration, GoalsIllustration } from "./illustrations";

const ALL = [GoalsIllustration, ConversationsIllustration, CompletionIllustration];

describe("illustrations (TASK-070)", () => {
  it.each(ALL.map((Illustration) => [Illustration.name, Illustration] as const))(
    "%s is an aria-hidden 160 x 120 svg with no text",
    (_name, Illustration) => {
      const { container } = render(<Illustration />);
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("viewBox")).toBe("0 0 160 120");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(container.querySelector("text")).toBeNull();
      expect(svg?.textContent).toBe("");
    },
  );
});
