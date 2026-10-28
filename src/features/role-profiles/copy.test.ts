import { describe, expect, it } from "vitest";
import { adminRolesCopy, personRoleCopy, roleErrorMessage, targetErrorMessage } from "./copy";

/**
 * Approved Norwegian strings from the SPEC "Navigation and UX" terminology table and the notices. A change to any of
 * them is a product decision, so this file pins the exact text rather than a pattern.
 */
const PRIVACY_NOTICE =
  "Valgt rolle og sammenligningen er bare synlige for deg. Rollen sier noe om forventninger til en rolle, ikke om deg som person, og brukes ikke i vurdering, lønn eller tildeling av oppgaver.";
const ADMIN_NOTICE = "Ikke registrer personnavn eller personlige opplysninger i rollebeskrivelser.";

describe("role-profiles copy — approved terminology", () => {
  it("pins the person section and selector terms", () => {
    expect(personRoleCopy.sectionHeading).toBe("Rolleforventninger");
    expect(personRoleCopy.chooseRole).toBe("Rolle å utvikle mot");
    expect(personRoleCopy.noTarget).toBe("Ingen rolle valgt");
    expect(personRoleCopy.changeRole).toBe("Endre rolle");
    expect(personRoleCopy.clearRole).toBe("Fjern valgt rolle");
    expect(personRoleCopy.archived).toBe("Rollen er arkivert");
    expect(personRoleCopy.noExpectations).toBe("Rollen har ingen forventninger ennå.");
  });

  it("pins the comparison status labels, level labels and the create-goal action", () => {
    expect(personRoleCopy.comparison.meets).toBe("Møter forventningen");
    expect(personRoleCopy.comparison.developmentOpportunity).toBe("Utviklingsmulighet");
    expect(personRoleCopy.comparison.notAssessed).toBe("Ikke vurdert ennå");
    expect(personRoleCopy.comparison.unavailable).toBe("Ikke tilgjengelig");
    expect(personRoleCopy.comparison.expectedLevel(3)).toBe("Forventet nivå 3");
    expect(personRoleCopy.comparison.ownLevel(2)).toBe("Ditt nivå 2");
    expect(personRoleCopy.comparison.createGoal).toBe("Opprett mål");
  });

  it("pins the privacy notice of the comparison word for word", () => {
    expect(personRoleCopy.comparison.privacyNotice).toBe(PRIVACY_NOTICE);
  });

  it("pins the admin page, notice, empty state and admin actions", () => {
    expect(adminRolesCopy.pageTitle).toBe("Roller");
    expect(adminRolesCopy.notice).toBe(ADMIN_NOTICE);
    expect(adminRolesCopy.empty).toBe("Ingen roller er lagt inn ennå.");
    expect(adminRolesCopy.newRole).toBe("Ny rolle");
    expect(adminRolesCopy.editRole).toBe("Rediger");
    expect(adminRolesCopy.archiveRole).toBe("Arkiver");
    expect(adminRolesCopy.restoreRole).toBe("Gjenopprett");
  });
});

describe("role-profiles copy — neutral error messages", () => {
  it("maps each known server code to its message and any unknown code to the neutral failure", () => {
    expect(roleErrorMessage("role_archived")).toBe(adminRolesCopy.errors.role_archived);
    expect(roleErrorMessage("cap_reached")).toBe(adminRolesCopy.errors.cap_reached);
    expect(roleErrorMessage("something_new")).toBe(adminRolesCopy.errors.persistence_failed);
    expect(targetErrorMessage("role_not_selectable")).toBe(personRoleCopy.errors.role_not_selectable);
    expect(targetErrorMessage("something_new")).toBe(personRoleCopy.errors.persistence_failed);
  });

  it("never echoes role content: messages are fixed sentences without placeholders", () => {
    for (const message of Object.values(adminRolesCopy.errors)) {
      expect(message).not.toMatch(/\$\{|\{\}/);
    }
    for (const message of Object.values(personRoleCopy.errors)) {
      expect(message).not.toMatch(/\$\{|\{\}/);
    }
  });
});
