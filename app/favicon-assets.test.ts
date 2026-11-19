import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The App Router file conventions (app/favicon.ico, app/icon.png, app/apple-icon.png)
// replace the default Next.js icon. These checks guard the binary assets so a
// regenerated file cannot silently drop the 16px variant or change its size.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)));

function pngSize(buffer: Buffer) {
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function icoSizes(buffer: Buffer) {
  expect(buffer.readUInt16LE(0)).toBe(0);
  expect(buffer.readUInt16LE(2)).toBe(1);
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => buffer.readUInt8(6 + i * 16)).sort((a, b) => a - b);
}

describe("favicon assets", () => {
  it("favicon.ico contains the 16, 32 and 48 pixel variants", () => {
    expect(icoSizes(read("./favicon.ico"))).toEqual([16, 32, 48]);
  });

  it("icon.png is a 32 by 32 PNG", () => {
    expect(pngSize(read("./icon.png"))).toEqual({ width: 32, height: 32 });
  });

  it("apple-icon.png is a 180 by 180 PNG", () => {
    expect(pngSize(read("./apple-icon.png"))).toEqual({ width: 180, height: 180 });
  });
});
