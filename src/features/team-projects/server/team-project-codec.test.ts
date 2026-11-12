import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  openParticipationDocument,
  openTeamProjectDocument,
  toPersistedParticipation,
  toPersistedTeamProject,
} from "./team-project-codec";

const project = { teamId: "team-1", title: "Hemmelig prosjekt", startDate: "2026-01-01", endDate: "2026-02-01", archived: false };
const participation = { teamId: "team-1", projectId: "p1", memberRef: "m-1", startDate: "2026-01-01", endDate: "2026-02-01", archived: false, note: "Privat merknad" };

describe("team project and participation content codec", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  describe("project title", () => {
    it("persists the title only inside the envelope and keeps dates plaintext", () => {
      const persisted = toPersistedTeamProject("p1", project);
      expect(Object.hasOwn(persisted, "title")).toBe(false);
      expect(persisted).toMatchObject({ teamId: "team-1", startDate: "2026-01-01" });
      expect(JSON.stringify(persisted)).not.toContain("Hemmelig");
    });

    it("opens the title for the same project and team", () => {
      expect(openTeamProjectDocument("p1", toPersistedTeamProject("p1", project))).toMatchObject({ title: "Hemmelig prosjekt" });
    });

    it("refuses a title moved to another project (substitution)", () => {
      expect(openTeamProjectDocument("p2", toPersistedTeamProject("p1", project))).toBeNull();
    });

    it("refuses a plaintext title (no plaintext fallback)", () => {
      const metadata: Record<string, unknown> = { ...toPersistedTeamProject("p1", project) };
      delete metadata.content;
      expect(openTeamProjectDocument("p1", { ...metadata, title: "Hemmelig prosjekt" })).toBeNull();
    });

    it("fails closed when the key is missing", () => {
      const sealed = toPersistedTeamProject("p1", project);
      vi.stubEnv("ENCRYPTION_KEY", "");
      expect(() => openTeamProjectDocument("p1", sealed)).toThrow();
    });
  });

  describe("participation note", () => {
    it("persists the note only as an envelope and never as text", () => {
      const persisted = toPersistedParticipation("pa-1", participation);
      expect(persisted.note).toMatchObject({ keyVersion: "v2" });
      expect(JSON.stringify(persisted)).not.toContain("Privat");
    });

    it("opens the note for the same participation", () => {
      expect(openParticipationDocument("pa-1", toPersistedParticipation("pa-1", participation))).toMatchObject({ note: "Privat merknad" });
    });

    it("keeps a null note as null and an absent note absent", () => {
      expect(toPersistedParticipation("pa-1", { ...participation, note: null }).note).toBeNull();
      const withoutNote: Record<string, unknown> = { ...participation };
      delete withoutNote.note;
      expect(Object.hasOwn(toPersistedParticipation("pa-1", withoutNote), "note")).toBe(false);
    });

    it("refuses a note moved to another participation (substitution)", () => {
      const opened = openParticipationDocument("pa-2", toPersistedParticipation("pa-1", participation));
      expect(opened.note).toBe(false);
    });

    it("refuses a plaintext note (no plaintext fallback)", () => {
      expect(openParticipationDocument("pa-1", { ...participation, note: "Privat merknad" }).note).toBe(false);
    });
  });
});
