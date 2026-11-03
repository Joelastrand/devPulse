// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button, buttonClassName } from "./Button";

describe("Button", () => {
  afterEach(cleanup);

  it("renders a native <button> element", () => {
    render(<Button>Klikk</Button>);

    expect(screen.getByRole("button", { name: "Klikk" }).tagName).toBe("BUTTON");
  });

  it("defaults to type=button so it never implicitly submits an enclosing form", () => {
    render(<Button>Klikk</Button>);

    expect(screen.getByRole("button")).toHaveProperty("type", "button");
  });

  it("supports type=submit for form-submission buttons", () => {
    render(
      <form>
        <Button type="submit">Lagre</Button>
      </form>,
    );

    expect(screen.getByRole("button")).toHaveProperty("type", "submit");
  });

  it("respects native disabled and does not fire onClick while disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Klikk
      </Button>,
    );
    const button = screen.getByRole("button") as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("fires onClick when enabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Klikk</Button>);

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables and marks aria-busy while pending", () => {
    render(<Button pending>Lagrer…</Button>);
    const button = screen.getByRole("button") as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("does not mark aria-busy when not pending", () => {
    render(<Button>Klikk</Button>);

    expect(screen.getByRole("button").hasAttribute("aria-busy")).toBe(false);
  });
});

describe("buttonClassName", () => {
  afterEach(cleanup);

  it("matches the className Button itself renders for the same variant/size", () => {
    render(
      <Button variant="secondary" size="sm">
        Klikk
      </Button>,
    );

    expect(buttonClassName({ variant: "secondary", size: "sm" })).toBe(
      screen.getByRole("button").className,
    );
  });

  it("defaults to the primary/md variant, matching Button's own defaults", () => {
    render(<Button>Klikk</Button>);

    expect(buttonClassName()).toBe(screen.getByRole("button").className);
  });

  it("appends a caller-supplied className", () => {
    expect(buttonClassName({ className: "w-full" })).toMatch(/(^|\s)w-full(\s|$)/);
  });
});

describe("Button action hierarchy", () => {
  afterEach(cleanup);

  it.each([
    ["primary", "bg-primary"],
    ["secondary", "border-border-strong"],
    ["destructive", "border-danger-text"],
  ] as const)("gives the %s variant its filled or outlined treatment", (variant, marker) => {
    render(<Button variant={variant}>Klikk</Button>);

    expect(screen.getByRole("button").className).toContain(marker);
  });

  it("gives tertiary a text treatment with no border", () => {
    render(<Button variant="tertiary">Klikk</Button>);

    const className = screen.getByRole("button").className;
    expect(className).toContain("text-primary");
    expect(className).not.toMatch(/(^|\s)border(\s|$)/);
  });

  it("uses the 10 px control radius", () => {
    render(<Button>Klikk</Button>);

    expect(screen.getByRole("button").className).toContain("rounded-control");
    expect(screen.getByRole("button").className).not.toContain("rounded-full");
  });

  it("does not restate or remove focus styling (the global rule owns it)", () => {
    render(<Button>Klikk</Button>);

    expect(screen.getByRole("button").className).not.toMatch(/focus-visible|outline-none/);
  });
});
