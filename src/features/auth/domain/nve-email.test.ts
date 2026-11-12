import { describe, expect, it } from "vitest";
import { isNveEmail } from "./nve-email";

describe("isNveEmail", () => {
  it.each([
    "employee@nve.no",
    "Employee.Name@NVE.NO",
    "  employee@nve.no  ",
  ])("accepts the exact NVE domain: %s", (email) => {
    expect(isNveEmail(email)).toBe(true);
  });

  it.each([
    "person@nve.no.attacker.com",
    "person@fake-nve.no",
    "person@evilnve.no",
    "person@sub.nve.no",
    "person@gmail.com",
    "person@nve.no.",
    "nve.no@gmail.com",
    "person@nve.nope",
    "@nve.no",
    "nve.no",
    "",
    "person@nve.no extra@gmail.com",
    "a@b@nve.no",
  ])("rejects %s", (email) => {
    expect(isNveEmail(email)).toBe(false);
  });
});
