import { describe, expect, it } from "vitest";
import { arrangeAssignableMembers, type AssignableCandidate } from "./assignable-ordinals";

const REF = (n: number) => `${String(n).padStart(2, "0")}aaaaaaaaaaaaaaaaaaaaaaaa`;
const at = (n: number) => new Date("2026-01-01T00:00:00Z").getTime() + n * 86_400_000;

function candidate(
  n: number,
  displayName: string | null,
  joinedAt: number | null = at(n),
): AssignableCandidate {
  return { memberRef: REF(n), displayName, joinedAt, isSelf: false };
}

const summary = (list: ReturnType<typeof arrangeAssignableMembers>) =>
  list.map((m) => [m.memberRef, m.displayName, m.ordinal]);

describe("arrangeAssignableMembers", () => {
  it("gives unique names no ordinal", () => {
    const out = arrangeAssignableMembers([candidate(1, "Berit"), candidate(2, "Anna")]);

    expect(summary(out)).toEqual([
      [REF(2), "Anna", null],
      [REF(1), "Berit", null],
    ]);
  });

  it("numbers named duplicates 1..n by createdAt ascending", () => {
    const out = arrangeAssignableMembers([candidate(3, "Alex"), candidate(1, "Alex"), candidate(2, "Alex")]);

    expect(summary(out)).toEqual([
      [REF(1), "Alex", 1],
      [REF(2), "Alex", 2],
      [REF(3), "Alex", 3],
    ]);
  });

  it("treats NFC-, trim- and case-equal names as one group", () => {
    const decomposed = "Réne"; // e + combining acute
    const out = arrangeAssignableMembers([
      candidate(1, "Réne"),
      candidate(2, `  ${decomposed}  `),
      candidate(3, "RÉNE"),
    ]);

    expect(out.map((m) => m.ordinal)).toEqual([1, 2, 3]);
  });

  it("does not group names that differ beyond case/NFC/trim", () => {
    const out = arrangeAssignableMembers([candidate(1, "Alex"), candidate(2, "Alexa")]);

    expect(out.map((m) => m.ordinal)).toEqual([null, null]);
  });

  it("groups all unnamed members together and lists them last", () => {
    const out = arrangeAssignableMembers([
      candidate(1, null),
      candidate(2, "Zed"),
      candidate(3, null),
      candidate(4, "   "),
    ]);

    expect(summary(out)).toEqual([
      [REF(2), "Zed", null],
      [REF(1), null, 1],
      [REF(3), null, 2],
      [REF(4), null, 3],
    ]);
  });

  it("gives a single unnamed member no ordinal", () => {
    expect(arrangeAssignableMembers([candidate(1, null)])[0].ordinal).toBeNull();
  });

  it("merges a member literally named 'Medlem uten navn' into the unnamed group", () => {
    const out = arrangeAssignableMembers([candidate(1, "Medlem uten navn"), candidate(2, null)]);

    expect(out.map((m) => m.ordinal)).toEqual([1, 2]);
  });

  it("breaks createdAt ties by memberRef ascending", () => {
    const out = arrangeAssignableMembers([
      { ...candidate(5, "Alex"), joinedAt: at(1) },
      { ...candidate(4, "Alex"), joinedAt: at(1) },
    ]);

    expect(summary(out)).toEqual([
      [REF(4), "Alex", 1],
      [REF(5), "Alex", 2],
    ]);
  });

  it("ranks a missing createdAt last, then by memberRef", () => {
    const out = arrangeAssignableMembers([
      candidate(1, "Alex", null),
      candidate(9, "Alex", at(50)),
      candidate(2, "Alex", null),
    ]);

    expect(out.map((m) => m.memberRef)).toEqual([REF(9), REF(1), REF(2)]);
  });

  it("is deterministic regardless of input order", () => {
    const input = [candidate(1, "Alex"), candidate(2, "alex"), candidate(3, null), candidate(4, "Bo"), candidate(5, null)];

    const forward = arrangeAssignableMembers(input);
    const backward = arrangeAssignableMembers([...input].reverse());

    expect(summary(backward)).toEqual(summary(forward));
  });

  it("orders groups by nb collation (å after z)", () => {
    const out = arrangeAssignableMembers([candidate(1, "Åse"), candidate(2, "Zoe"), candidate(3, "Ola")]);

    expect(out.map((m) => m.displayName)).toEqual(["Ola", "Zoe", "Åse"]);
  });

  it("returns only memberRef, displayName, ordinal and isSelf — never the ranking inputs", () => {
    const out = arrangeAssignableMembers([{ ...candidate(1, "Alex"), isSelf: true }]);

    expect(Object.keys(out[0]).sort()).toEqual(["displayName", "isSelf", "memberRef", "ordinal"]);
    expect(out[0].isSelf).toBe(true);
    expect(JSON.stringify(out)).not.toContain(String(at(1)));
  });

  it("does not mutate its input", () => {
    const input = [candidate(2, "Alex"), candidate(1, "Alex")];
    const copy = structuredClone(input);

    arrangeAssignableMembers(input);

    expect(input).toEqual(copy);
  });
});
