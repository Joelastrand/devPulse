import { describe, expect, it } from "vitest";
import { goalsCopy } from "./copy";

/** All user-visible strings, with the function entries expanded for the cases the page renders. */
function allCopy(): string[] {
  const strings: string[] = [];
  for (const value of Object.values(goalsCopy)) {
    if (typeof value === "string") strings.push(value);
  }
  return [
    ...strings,
    goalsCopy.completedSummary(3),
    goalsCopy.recoveryNotice(1),
    goalsCopy.recoveryNotice(2),
    goalsCopy.recoveryItemLabel(2, 3),
    goalsCopy.recoveryDeleteButtonName(2, 3),
    goalsCopy.deleteButtonName("Eksempel"),
    goalsCopy.deleteConfirmGoal("Eksempel"),
    goalsCopy.editButtonName("Eksempel"),
    goalsCopy.completeButtonName("Eksempel"),
    goalsCopy.reopenButtonName("Eksempel"),
  ];
}

describe("goals copy (BR-49, BR-50)", () => {
  it("uses the approved page title", () => {
    expect(goalsCopy.pageTitle).toBe("Mål");
  });

  it("states that goals are personal, that teammates and team leads have no access, and discourages sensitive titles", () => {
    expect(goalsCopy.privacyNotice).toContain("personlige");
    expect(goalsCopy.privacyNotice).toContain("Teamkolleger og teamledere får ikke tilgang");
    expect(goalsCopy.privacyNotice).toMatch(/Ikke skriv sensitiv eller konfidensiell informasjon i en måltittel/);
  });

  it("makes no encryption, anonymity, operator-access or inference claims", () => {
    expect(goalsCopy.privacyNotice).not.toMatch(/krypter|anonym|aldri|umulig|ingen kan|garanter/i);
  });

  it("contains none of the forbidden terms outside the explicit team-lead privacy sentence", () => {
    const forbidden = /score|poeng|ranking|rangering|ytelse|prestasjon|forsinket|overskredet|leder|administrator|samtaler|%/i;
    const withoutPrivacySentence = allCopy().map((text) => text.replace("Teamkolleger og teamledere", ""));
    for (const text of withoutPrivacySentence) {
      expect(text).not.toMatch(forbidden);
    }
  });

  it("uses the approved status, area and recovery wording", () => {
    expect(goalsCopy.statusActive).toBe("Aktivt");
    expect(goalsCopy.statusCompleted).toBe("Fullført");
    expect(goalsCopy.areaUnavailable).toBe("Ferdighetsområdet er ikke lenger tilgjengelig");
    expect(goalsCopy.recoveryNotice(1)).toBe("Et lagret mål kan ikke vises. Du kan slette det og opprette målet på nytt.");
    expect(goalsCopy.recoveryNotice(2)).toBe("Flere lagrede mål kan ikke vises. Du kan slette dem og opprette målene på nytt.");
  });
});
