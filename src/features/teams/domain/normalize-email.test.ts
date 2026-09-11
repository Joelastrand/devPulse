import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./normalize-email";

describe("normalizeEmail", () => {
  it("lowercases the email", () => {
    expect(normalizeEmail("Dev@Example.com")).toBe("dev@example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  dev@example.com  ")).toBe("dev@example.com");
  });

  it("combines trimming and lowercasing", () => {
    expect(normalizeEmail("  Dev@Example.COM ")).toBe("dev@example.com");
  });
});
