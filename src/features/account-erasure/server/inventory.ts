/**
 * The single erasure inventory registry (SPEC "Erasure inventory", BR-5, AE-SI-7). Every I-, A-, P-, and E- row of the
 * SPEC is here exactly once. The verification sweep (TASK-012) and the allow-list guard derive from this module, so a
 * missing row means a missed sweep.
 *
 * Correction recorded by TASK-006: A-5 (`roadmapItems.ownerRef`), I-7 (`participantMemberRef`), and I-9 (`memberRef`)
 * hold an opaque, team-scoped `memberRef`, never a uid. They are `memberRef` kinds and generate no uid equality query.
 *
 * The SPEC describes A-rows as "one field", but some rows list several fields (for example A-2 `createdBy`,
 * `updatedBy`). This registry keeps the SPEC row ids and lists each field under its row.
 *
 * Pure data. No Firestore access. Field names here are the persisted names only.
 */

export type InventoryClass = "DELETE" | "ANONYMIZE" | "DETACH" | "PRESERVE" | "EXTERNAL" | "TRANSIENT" | "DISCOVERY";

/** What a field holds. `none` means the field is not a person identifier. */
export type IdentifierKind = "uid" | "memberRef" | "email" | "none";

/** How a row's documents are located. */
export type RowLocator =
  | "docIdIsUid"
  | "docIdPrefixUid"
  | "uidField"
  | "subtree"
  | "collectionGroup"
  | "fieldsOnly"
  | "external";

/** Where a field's identifier is persisted: as a document field, or only inside the document ID. */
export type IdentifierLocation = "field" | "docIdSuffix";

export interface InventoryField {
  readonly name: string;
  readonly kind: IdentifierKind;
  /** Defaults to `field`. `docIdSuffix` means the value is stored only as the `__<value>` tail of the document ID. */
  readonly location?: IdentifierLocation;
}

/**
 * How the verification sweep (TASK-012) finds a row's residual documents for one person. Pure descriptors: the sweep
 * binds the uid or normalized email value and runs the query. `perMembership` rows are resolved per membership in
 * TASK-016 (A-5 and the membership `memberRef` fields); they never use a uid query.
 */
export type SweepQuery =
  | { readonly kind: "fieldEquals"; readonly field: string; readonly value: "uid" | "email" }
  | { readonly kind: "docIdEquals"; readonly value: "uid" }
  | { readonly kind: "docIdStartsWith"; readonly value: "uid" }
  | { readonly kind: "docIdEndsWith"; readonly value: "normalizedEmail" }
  | { readonly kind: "subtree"; readonly path: string }
  | { readonly kind: "collectionGroupFieldEquals"; readonly field: string; readonly value: "uid" }
  | { readonly kind: "perMembership"; readonly field: string };

/** One sweep query owned by one inventory row. */
export interface InventorySweep {
  readonly rowId: string;
  readonly collection: string;
  readonly query: SweepQuery;
}

export interface InventoryRow {
  readonly id: string;
  /** Collection or path pattern, as the SPEC names it. `null` for external rows. */
  readonly collection: string | null;
  readonly locator: RowLocator;
  readonly class: InventoryClass;
  readonly fields: readonly InventoryField[];
}

const uid = (name: string): InventoryField => ({ name, kind: "uid" });
const memberRef = (name: string): InventoryField => ({ name, kind: "memberRef" });
const email = (name: string): InventoryField => ({ name, kind: "email" });
/** An e-mail that persists only as the `__<normalizedEmail>` tail of an invitation document ID (`teamId__email`). */
const docIdEmail = (name: string): InventoryField => ({ name, kind: "email", location: "docIdSuffix" });
const plain = (name: string): InventoryField => ({ name, kind: "none" });

/** I-rows: person-owned stores. */
const PERSON_OWNED: readonly InventoryRow[] = [
  { id: "I-1", collection: "skillProfiles", locator: "docIdIsUid", class: "DELETE", fields: [plain("levels")] },
  { id: "I-2", collection: "userProfiles", locator: "docIdIsUid", class: "DELETE", fields: [plain("displayName")] },
  { id: "I-3", collection: "userDevelopment/{uid}/goals", locator: "subtree", class: "DELETE", fields: [] },
  { id: "I-4", collection: "userDevelopment/{uid}/roleTarget", locator: "subtree", class: "DELETE", fields: [] },
  { id: "I-5", collection: "userDevelopment/{uid}/conversations", locator: "subtree", class: "DELETE", fields: [] },
  {
    id: "I-6",
    collection: "userDevelopment/{uid}/conversationParticipations",
    locator: "subtree",
    class: "DELETE",
    fields: [uid("ownerUid"), plain("invitedAt")],
  },
  {
    id: "I-7",
    collection: "conversations",
    locator: "collectionGroup",
    class: "DETACH",
    fields: [
      uid("participantUid"),
      memberRef("participantMemberRef"),
      plain("participantState"),
      plain("participantInvitedAt"),
      plain("participantAcceptedAt"),
      plain("participantNotes"),
    ],
  },
  { id: "I-8", collection: "conversations", locator: "collectionGroup", class: "DISCOVERY", fields: [uid("participantUid")] },
  {
    id: "I-9",
    collection: "teamMemberships",
    locator: "docIdPrefixUid",
    class: "DELETE",
    fields: [uid("uid"), memberRef("memberRef"), plain("role"), plain("skillContribution")],
  },
  {
    id: "I-10",
    collection: "teamAccessRequests",
    locator: "docIdPrefixUid",
    class: "DELETE",
    fields: [uid("uid")],
  },
  {
    id: "I-11",
    collection: "teamInvitations",
    locator: "uidField",
    class: "DELETE",
    fields: [email("email"), docIdEmail("normalizedEmail"), uid("resolvedUid")],
  },
  {
    id: "I-12",
    collection: "surveyParticipations",
    locator: "docIdPrefixUid",
    class: "DELETE",
    fields: [uid("uid"), plain("surveyId")],
  },
  { id: "I-13", collection: "forumThreads", locator: "uidField", class: "DELETE", fields: [uid("authorUid")] },
  { id: "I-14", collection: "forumReplies", locator: "uidField", class: "ANONYMIZE", fields: [uid("authorUid")] },
  { id: "I-15", collection: "accountErasures", locator: "docIdIsUid", class: "TRANSIENT", fields: [] },
  // I-16 (superadmin registry, docs/SECURITY.md superadmin section). The record is keyed by the Firebase Auth UID and stores the
  // grant state of that person. Erasure must revoke it through the registry rules (last-superadmin protection and the
  // control count), never by a bare delete. The erasure adapter for this row is required before cutover (see the
  // superadmin cutover document).
  { id: "I-16", collection: "superadmins", locator: "docIdIsUid", class: "DELETE", fields: [] },
  // Personal role workspace, first increment (SECURITY-REVIEW §11.3). Owner subtrees; encrypted content; no key needed to delete.
  { id: "I-17", collection: "userDevelopment/{uid}/responsibilities", locator: "subtree", class: "DELETE", fields: [] },
  { id: "I-18", collection: "userDevelopment/{uid}/achievements", locator: "subtree", class: "DELETE", fields: [] },
  // I-19 (docs/features/team-owned-skills/SPEC.md §7): a person's private team-skill ratings, one document per
  // (person, team skill). Located by the stored `uid` field, not by the id, so the sweep is a field equality.
  { id: "I-19", collection: "teamSkillAssessments", locator: "uidField", class: "DELETE", fields: [uid("uid")] },
];

/** A-rows: actor and audit identities on preserved records (D5). Each field is set to null or to the erased marker. */
const ACTOR_AUDIT: readonly InventoryRow[] = [
  { id: "A-1", collection: "surveys", locator: "fieldsOnly", class: "ANONYMIZE", fields: [uid("createdBy")] },
  {
    id: "A-2",
    collection: "skillTrees",
    locator: "fieldsOnly",
    class: "ANONYMIZE",
    fields: [uid("createdBy"), uid("updatedBy")],
  },
  {
    id: "A-3",
    collection: "roleDefinitions",
    locator: "fieldsOnly",
    class: "ANONYMIZE",
    fields: [uid("createdBy"), uid("updatedBy"), uid("archivedBy")],
  },
  {
    id: "A-4",
    collection: "roadmapItems",
    locator: "fieldsOnly",
    class: "ANONYMIZE",
    fields: [uid("createdBy"), uid("updatedBy"), uid("archivedBy")],
  },
  { id: "A-5", collection: "roadmapItems", locator: "fieldsOnly", class: "DETACH", fields: [memberRef("ownerRef")] },
  { id: "A-6", collection: "skillProgress", locator: "fieldsOnly", class: "ANONYMIZE", fields: [uid("updatedBy")] },
  {
    id: "A-7",
    collection: "challenges",
    locator: "fieldsOnly",
    class: "ANONYMIZE",
    fields: [uid("resolvedBy"), uid("archivedBy")],
  },
  { id: "A-8", collection: "forumReplies", locator: "fieldsOnly", class: "ANONYMIZE", fields: [uid("deletedBy")] },
  { id: "A-9", collection: "teamAccessRequests", locator: "fieldsOnly", class: "ANONYMIZE", fields: [uid("resolvedBy")] },
  { id: "A-10", collection: "teamInvitations", locator: "fieldsOnly", class: "ANONYMIZE", fields: [uid("invitedBy")] },
  {
    id: "A-11",
    collection: "teamMemberships",
    locator: "fieldsOnly",
    class: "ANONYMIZE",
    fields: [uid("grantedBy"), uid("roleUpdatedBy")],
  },
  { id: "A-12", collection: "teams", locator: "fieldsOnly", class: "ANONYMIZE", fields: [uid("createdBy")] },
  {
    id: "A-13",
    collection: "teamSystems",
    locator: "fieldsOnly",
    class: "ANONYMIZE",
    fields: [uid("createdBy"), uid("updatedBy"), uid("assessedBy")],
  },
  {
    id: "A-14",
    collection: "teamSystems",
    locator: "fieldsOnly",
    class: "DETACH",
    fields: [memberRef("knowledgeMemberRefs")],
  },
  {
    id: "A-15",
    collection: "teamProjectParticipations",
    locator: "fieldsOnly",
    class: "DELETE",
    fields: [memberRef("memberRef")],
  },
  // A-17 (docs/features/team-owned-skills/SPEC.md §7): the acting admin of a team-owned skill definition is audit only.
  {
    id: "A-17",
    collection: "teamSkills",
    locator: "fieldsOnly",
    class: "ANONYMIZE",
    fields: [uid("createdBy"), uid("updatedBy")],
  },
  // A-16: the superadmin registry records the granting and revoking administrator on each record. Erasing a person clears
  // those references on other people's records and keeps the record state (the registry count is never changed by this row).
  {
    id: "A-16",
    collection: "superadmins",
    locator: "fieldsOnly",
    class: "ANONYMIZE",
    fields: [uid("grantedByUid"), uid("revokedByUid")],
  },
];

/** P-rows: preserved records with no person linkage, or anonymous. Listed so the sweep knows they are intentional. */
const PRESERVED: readonly InventoryRow[] = [
  { id: "P-1", collection: "surveyResponses", locator: "fieldsOnly", class: "PRESERVE", fields: [] },
  { id: "P-2", collection: "challenges", locator: "fieldsOnly", class: "PRESERVE", fields: [] },
  { id: "P-3", collection: "teamSurveyState", locator: "fieldsOnly", class: "PRESERVE", fields: [] },
  { id: "P-4", collection: "teamSkillNeeds", locator: "fieldsOnly", class: "PRESERVE", fields: [] },
  { id: "P-5", collection: "forumThreads", locator: "fieldsOnly", class: "PRESERVE", fields: [] },
  { id: "P-6", collection: "conversations", locator: "fieldsOnly", class: "PRESERVE", fields: [] },
];

/** E-rows: outside product-controlled stores. Not claimed as erased. */
const EXTERNAL: readonly InventoryRow[] = [
  { id: "E-1", collection: null, locator: "external", class: "EXTERNAL", fields: [] },
  { id: "E-2", collection: null, locator: "external", class: "EXTERNAL", fields: [] },
  { id: "E-3", collection: null, locator: "external", class: "EXTERNAL", fields: [] },
  { id: "E-4", collection: null, locator: "external", class: "EXTERNAL", fields: [] },
];

/** Every row of the SPEC inventory, in SPEC order. */
export const INVENTORY_ROWS: readonly InventoryRow[] = [...PERSON_OWNED, ...ACTOR_AUDIT, ...PRESERVED, ...EXTERNAL];

/** Field names the registry knows about, with their kind. Used by the guard. */
export function registeredFields(): Map<string, IdentifierKind> {
  const fields = new Map<string, IdentifierKind>();
  for (const row of INVENTORY_ROWS) {
    for (const field of row.fields) {
      const existing = fields.get(field.name);
      if (existing !== undefined && existing !== field.kind) {
        throw new Error(`inventory field "${field.name}" is registered with two kinds`);
      }
      fields.set(field.name, field.kind);
    }
  }
  return fields;
}

/** Top-level and sub-path segments that name a collection (variable `{uid}` segments excluded). */
export function registeredCollectionSegments(): Set<string> {
  const segments = new Set<string>();
  for (const row of INVENTORY_ROWS) {
    if (row.collection === null) continue;
    for (const segment of row.collection.split("/")) {
      if (!segment.startsWith("{")) segments.add(segment);
    }
  }
  return segments;
}

/**
 * Sweep descriptors for one row. Locator-aware: a document-ID-keyed row (I-1, I-2), a document-ID-prefix row (I-9,
 * I-10, I-12), a subtree (I-3..I-6), a collection-group discovery (I-8), and an invitation ID tail (I-11) each get
 * their own shape, not a field equality. Rows whose data is preserved, transient, or external have no sweep: they
 * are not residuals to erase (P-rows, I-15 which is the fence record itself, E-rows).
 */
export function sweepQueriesForRow(row: InventoryRow): readonly SweepQuery[] {
  if (row.collection === null || row.class === "PRESERVE" || row.class === "TRANSIENT" || row.class === "EXTERNAL") {
    return [];
  }
  if (row.locator === "subtree") return [{ kind: "subtree", path: row.collection }];

  const queries: SweepQuery[] = [];
  if (row.locator === "docIdIsUid") queries.push({ kind: "docIdEquals", value: "uid" });
  if (row.locator === "docIdPrefixUid") queries.push({ kind: "docIdStartsWith", value: "uid" });

  for (const field of row.fields) {
    if (field.kind === "memberRef") {
      queries.push({ kind: "perMembership", field: field.name });
    } else if (field.kind === "uid" && row.locator === "collectionGroup") {
      queries.push({ kind: "collectionGroupFieldEquals", field: field.name, value: "uid" });
    } else if (field.kind === "uid") {
      queries.push({ kind: "fieldEquals", field: field.name, value: "uid" });
    } else if (field.kind === "email" && (field.location ?? "field") === "docIdSuffix") {
      queries.push({ kind: "docIdEndsWith", value: "normalizedEmail" });
    } else if (field.kind === "email") {
      queries.push({ kind: "fieldEquals", field: field.name, value: "email" });
    }
  }
  return queries;
}

/** Every sweep query in the registry, row by row. TASK-012 binds the uid or normalized email value and runs them. */
export function inventorySweeps(): readonly InventorySweep[] {
  return INVENTORY_ROWS.flatMap((row) =>
    sweepQueriesForRow(row).map((query) => ({ rowId: row.id, collection: row.collection ?? "", query })),
  );
}

/**
 * The actor-audit targets: each actor field that holds an erased uid and is cleared to `null`. TASK-023 added SPEC A-1, A-2,
 * A-3, A-7; TASK-024 adds A-4, A-6, A-11, A-12. Kept in the registry so the collection names live in one place. The
 * `actor_audit` step imports this list. A-11 runs after the `memberships` step, so only other members' memberships remain.
 */
export const ACTOR_AUDIT_TARGETS = [
  { collection: "surveys", field: "createdBy" },
  { collection: "skillTrees", field: "createdBy" },
  { collection: "skillTrees", field: "updatedBy" },
  { collection: "roleDefinitions", field: "createdBy" },
  { collection: "roleDefinitions", field: "updatedBy" },
  { collection: "roleDefinitions", field: "archivedBy" },
  { collection: "challenges", field: "resolvedBy" },
  { collection: "challenges", field: "archivedBy" },
  { collection: "roadmapItems", field: "createdBy" },
  { collection: "roadmapItems", field: "updatedBy" },
  { collection: "roadmapItems", field: "archivedBy" },
  { collection: "skillProgress", field: "updatedBy" },
  { collection: "teamMemberships", field: "grantedBy" },
  { collection: "teamMemberships", field: "roleUpdatedBy" },
  { collection: "teams", field: "createdBy" },
  // A-13 (team-system-overview, owner decision OQ-1, 2026-11-05). `assessedBy` is stored inside each assessment map, so its
  // target is the dotted field path. Each target is one closed entry, like the others.
  { collection: "teamSystems", field: "createdBy" },
  { collection: "teamSystems", field: "updatedBy" },
  { collection: "teamSystems", field: "availability.assessedBy" },
  { collection: "teamSystems", field: "maintainability.assessedBy" },
  { collection: "teamSystems", field: "security.assessedBy" },
  { collection: "teamSystems", field: "reliability.assessedBy" },
  { collection: "teamSystems", field: "testability.assessedBy" },
  { collection: "teamSystems", field: "deployability.assessedBy" },
  { collection: "teamSystems", field: "observability.assessedBy" },
  { collection: "superadmins", field: "grantedByUid" },
  { collection: "superadmins", field: "revokedByUid" },
  // A-17 (team-owned skills, SPEC §7): the acting admin of a team skill definition is audit only.
  { collection: "teamSkills", field: "createdBy" },
  { collection: "teamSkills", field: "updatedBy" },
] as const;
