/**
 * Synthetic Teamkompetanse ratings for the ten fictional demo members (`demo-member-01`…`10`).
 *
 * Pure data only. Every rating is a level 1–4 on the production scale (`TEAM_SKILL_LEVELS`) against a skill id from the demo
 * team catalog (`DEMO_TEAM_SKILLS`). A skill that a member does not list is simply not rated: absence is never a level.
 * Profiles are deliberately uneven. Some skills have a clear specialist, some have only one or two contributors (below the
 * k = 3 threshold, so the aggregate suppresses them), and some are shared across several members.
 */

export const TEAMKOMPETANSE_AS_OF = new Date("2026-10-01T09:00:00.000Z");
export const TEAMKOMPETANSE_CONSENT_AS_OF = new Date("2026-09-15T09:00:00.000Z");
/** The production team-skill criteria version every fixture rating is given under. */
export const TEAMKOMPETANSE_CRITERIA_VERSION = 1;
/**
 * When the approved rating update of 2026-11-16 was made. Only `updatedAt` of the 20 changed assessments takes this value;
 * `createdAt` keeps `TEAMKOMPETANSE_AS_OF`.
 */
export const TEAMKOMPETANSE_RATING_UPDATE_AS_OF = new Date("2026-11-16T09:00:00.000Z");

export type FixtureLevel = 1 | 2 | 3 | 4;

export interface TeamkompetanseProfile {
  uid: string;
  /** Specialization from the demo identity fixtures (for the report, not persisted). */
  specialization: string;
  /** skillId → level. Skills not listed are not rated. */
  ratings: Readonly<Partial<Record<string, FixtureLevel>>>;
}

export const TEAMKOMPETANSE_PROFILES: readonly TeamkompetanseProfile[] = Object.freeze([
  {
    uid: "demo-member-01",
    specialization: "Frontend-utvikler",
    ratings: {
      skTypescript: 4, skReact: 4, skTilgjengelighet: 3, skApiDesign: 3, skIntegrasjon: 2,
      skTestautomatisering: 4, skKodegjennomgang: 3, skUtviklingsverktoy: 3, skKunnskapsdeling: 2, skProduktforstaelse: 2,
    },
  },
  {
    uid: "demo-member-02",
    specialization: "Backend-utvikler",
    ratings: {
      skApiDesign: 4, skIntegrasjon: 4, skDatamodellering: 4, skTypescript: 3, skSkyplattform: 2,
      skInfosikkerhet: 2, skObservability: 2, skTekniskDok: 3, skKodegjennomgang: 3, skInfraKode: 2,
      skAvhengigheter: 2, skUtviklingsverktoy: 2,
    },
  },
  {
    uid: "demo-member-03",
    specialization: "Fullstack-utvikler",
    ratings: {
      skTypescript: 3, skReact: 3, skApiDesign: 4, skIntegrasjon: 3, skTestautomatisering: 3, skCiCd: 3,
      skKodegjennomgang: 3, skTekniskDok: 2, skKunnskapsdeling: 3, skAgilLevering: 2, skUtviklingsverktoy: 3,
      skTilgjengelighet: 2, skDatamodellering: 3, skHendelseshandtering: 2,
    },
  },
  {
    uid: "demo-member-04",
    specialization: "UX- og tilgjengelighetsspesialist",
    ratings: {
      skTilgjengelighet: 4, skProduktforstaelse: 4, skKunnskapsdeling: 2, skReact: 2, skTypescript: 2,
      skStakeholder: 3, skTekniskDok: 2, skKodegjennomgang: 2, skAgilLevering: 2, skUtviklingsverktoy: 2,
    },
  },
  {
    uid: "demo-member-05",
    specialization: "Sky- og infrastrukturingeniør",
    ratings: {
      skSkyplattform: 4, skInfraKode: 3, skCiCd: 4, skObservability: 3, skHendelseshandtering: 4,
      skInfosikkerhet: 2, skAvhengigheter: 2, skSystemarkitektur: 3, skUtviklingsverktoy: 3, skTekniskDok: 2,
      skTekniskVeiledning: 2,
    },
  },
  {
    uid: "demo-member-06",
    specialization: "Sikkerhetsingeniør",
    ratings: {
      skInfosikkerhet: 4, skTrusselmodellering: 4, skAvhengigheter: 4, skKodegjennomgang: 3, skSystemarkitektur: 4,
      skApiDesign: 3, skSkyplattform: 2, skHendelseshandtering: 2, skTekniskVeiledning: 2, skDatamodellering: 3,
      skInfraKode: 2,
    },
  },
  {
    uid: "demo-member-07",
    specialization: "Dataingeniør",
    ratings: {
      skDatakvalitet: 4, skDatamodellering: 4, skIntegrasjon: 3, skObservability: 2, skTestautomatisering: 3,
      skTypescript: 2, skSkyplattform: 2, skTekniskDok: 2, skProduktforstaelse: 3, skKunnskapsdeling: 2,
    },
  },
  {
    uid: "demo-member-08",
    specialization: "QA- og testautomatiseringsingeniør",
    ratings: {
      skTestautomatisering: 4, skKodegjennomgang: 4, skHendelseshandtering: 2, skObservability: 2, skReact: 2,
      skTilgjengelighet: 2, skCiCd: 4, skDatakvalitet: 3, skKunnskapsdeling: 3, skTekniskVeiledning: 2,
      skAgilLevering: 3,
    },
  },
  {
    uid: "demo-member-09",
    specialization: "Teknisk arkitekt",
    ratings: {
      skSystemarkitektur: 4, skApiDesign: 4, skIntegrasjon: 4, skTekniskDok: 4, skDatamodellering: 4,
      skTrusselmodellering: 3, skSkyplattform: 2, skTekniskVeiledning: 3, skKunnskapsdeling: 3, skInfosikkerhet: 2,
      skTypescript: 2, skStakeholder: 3, skProduktforstaelse: 2,
    },
  },
  {
    uid: "demo-member-10",
    specialization: "Produkt- og leveranseansvarlig",
    ratings: {
      skAgilLevering: 4, skStakeholder: 4, skProduktforstaelse: 3, skKunnskapsdeling: 2, skTekniskDok: 2,
      skHendelseshandtering: 2, skUtviklingsverktoy: 1,
    },
  },
]);
