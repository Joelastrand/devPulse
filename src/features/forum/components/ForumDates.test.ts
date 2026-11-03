import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Forum dates are <time> elements with a machine-readable value (Product Experience
 * TASK-044). Source check: the list and the thread view both wrap their date.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("forum dates (TASK-044)", () => {
  it("wraps the thread list date in a time element", () => {
    expect(read("./ThreadList.tsx")).toContain("<time dateTime={thread.createdAt}>");
  });

  it("wraps the reply date in a time element", () => {
    expect(read("./ThreadDetail.tsx")).toContain("<time dateTime={reply.createdAt}>");
  });
});

describe("forum author cues (TASK-044)", () => {
  it("adds no avatar or per-author colour to the forum markup", () => {
    for (const path of ["./ThreadList.tsx", "./ThreadDetail.tsx"]) {
      expect(read(path)).not.toMatch(/avatar|Avatar|authorColor|author-color/);
    }
  });
});
