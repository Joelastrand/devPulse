import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_MEMBER_ACCESS_NAMES,
  ALLOWED_UNREGISTERED_COLLECTIONS,
  ALLOWED_UNREGISTERED_NAMES,
  APPROVED_DYNAMIC_FIELD_PATHS,
  APPROVED_DYNAMIC_KEYS,
} from "./inventory-allow-list";
import { checkInventoryCoverage, type SourceFile } from "./inventory-guard";
import {
  INVENTORY_ROWS,
  inventorySweeps,
  registeredCollectionSegments,
  registeredFields,
  sweepQueriesForRow,
  type SweepQuery,
} from "./inventory";

function sweepsOf(rowId: string): readonly SweepQuery[] {
  return inventorySweeps()
    .filter((sweep) => sweep.rowId === rowId)
    .map((sweep) => sweep.query);
}

const REPO_ROOT = resolve(__dirname, "../../../..");
const SCAN_ROOTS = ["src/features", "src/lib", "src/components", "app"];
/** The registry and the guard are excluded from the scan; they define the vocabulary, they are not product code. */
const EXCLUDED_FILES = new Set([
  "src/features/account-erasure/server/inventory.ts",
  "src/features/account-erasure/server/inventory-allow-list.ts",
  "src/features/account-erasure/server/inventory-guard.ts",
]);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry) || /\.(test|spec)\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

function loadRepositorySource(): SourceFile[] {
  return SCAN_ROOTS.flatMap((root) => listSourceFiles(join(REPO_ROOT, root)))
    .map((full) => relative(REPO_ROOT, full).split(sep).join("/"))
    .filter((path) => !EXCLUDED_FILES.has(path))
    .map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), "utf8") }));
}

function guardOver(files: SourceFile[]) {
  return checkInventoryCoverage({
    files,
    registeredFields: registeredFields(),
    registeredCollectionSegments: registeredCollectionSegments(),
    allowedFields: ALLOWED_UNREGISTERED_NAMES,
    allowedMemberAccess: ALLOWED_MEMBER_ACCESS_NAMES,
    allowedCollections: ALLOWED_UNREGISTERED_COLLECTIONS,
    approvedDynamicKeys: APPROVED_DYNAMIC_KEYS,
    approvedDynamicFieldPaths: APPROVED_DYNAMIC_FIELD_PATHS,
  });
}

/** The SPEC row ids (SPEC "Erasure inventory"). Every one must appear exactly once in the registry. */
const SPEC_ROW_IDS = [
  ...Array.from({ length: 19 }, (_, i) => `I-${i + 1}`),
  ...Array.from({ length: 17 }, (_, i) => `A-${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `P-${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `E-${i + 1}`),
];

describe("erasure inventory registry", () => {
  it("contains every SPEC row exactly once and nothing else", () => {
    const ids = INVENTORY_ROWS.map((row) => row.id);
    expect(ids.slice().sort()).toEqual(SPEC_ROW_IDS.slice().sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("classifies A-5 ownerRef as a memberRef, never a uid (A-5 correction)", () => {
    const a5 = INVENTORY_ROWS.find((row) => row.id === "A-5");
    expect(a5?.fields).toEqual([{ name: "ownerRef", kind: "memberRef" }]);
  });

  it("never emits a uid or email field query for a memberRef field (A-5 ownerRef, I-7, I-9 memberRef)", () => {
    const queriedFields = inventorySweeps().flatMap((sweep) =>
      sweep.query.kind === "fieldEquals" || sweep.query.kind === "collectionGroupFieldEquals" ? [sweep.query.field] : [],
    );
    for (const memberRefField of ["ownerRef", "participantMemberRef", "memberRef"]) {
      expect(queriedFields).not.toContain(memberRefField);
    }
    expect(sweepsOf("A-5")).toEqual([{ kind: "perMembership", field: "ownerRef" }]);
  });
});

/**
 * Row-shape coverage (AE-SI-7). Each row is asserted against its locator and fields, not by a count, so a row that
 * silently loses its sweep query fails here.
 */
describe("erasure inventory sweep query shapes", () => {
  it("locates I-1 and I-2 by document ID equal to the uid, not by a field", () => {
    expect(sweepsOf("I-1")).toEqual([{ kind: "docIdEquals", value: "uid" }]);
    expect(sweepsOf("I-2")).toEqual([{ kind: "docIdEquals", value: "uid" }]);
  });

  it("locates I-9, I-10 and I-12 by document-ID prefix `uid__`, plus their uid field", () => {
    expect(sweepsOf("I-10")).toEqual([
      { kind: "docIdStartsWith", value: "uid" },
      { kind: "fieldEquals", field: "uid", value: "uid" },
    ]);
    expect(sweepsOf("I-12")).toEqual([
      { kind: "docIdStartsWith", value: "uid" },
      { kind: "fieldEquals", field: "uid", value: "uid" },
    ]);
    expect(sweepsOf("I-9")).toEqual([
      { kind: "docIdStartsWith", value: "uid" },
      { kind: "fieldEquals", field: "uid", value: "uid" },
      { kind: "perMembership", field: "memberRef" },
    ]);
  });

  it("locates I-3 to I-6 by subtree under the person's userDevelopment document", () => {
    expect(sweepsOf("I-3")).toEqual([{ kind: "subtree", path: "userDevelopment/{uid}/goals" }]);
    expect(sweepsOf("I-4")).toEqual([{ kind: "subtree", path: "userDevelopment/{uid}/roleTarget" }]);
    expect(sweepsOf("I-5")).toEqual([{ kind: "subtree", path: "userDevelopment/{uid}/conversations" }]);
    expect(sweepsOf("I-6")).toEqual([
      { kind: "subtree", path: "userDevelopment/{uid}/conversationParticipations" },
    ]);
  });

  it("sweeps I-7 through the owner-side collection group: participantUid by collection-group query, memberRef per membership", () => {
    expect(sweepsOf("I-7")).toEqual([
      { kind: "collectionGroupFieldEquals", field: "participantUid", value: "uid" },
      { kind: "perMembership", field: "participantMemberRef" },
    ]);
  });

  it("discovers I-8 through a collection-group query on participantUid", () => {
    expect(sweepsOf("I-8")).toEqual([{ kind: "collectionGroupFieldEquals", field: "participantUid", value: "uid" }]);
  });

  it("covers I-11 by the email field, by the invitation document-ID tail, and by resolvedUid", () => {
    expect(sweepsOf("I-11")).toEqual([
      { kind: "fieldEquals", field: "email", value: "email" },
      { kind: "docIdEndsWith", value: "normalizedEmail" },
      { kind: "fieldEquals", field: "resolvedUid", value: "uid" },
    ]);
  });

  it("registers the invitation document-ID email as an email-kind field on I-11, not as an allow-list exception", () => {
    expect(registeredFields().get("normalizedEmail")).toBe("email");
    expect(ALLOWED_UNREGISTERED_NAMES).not.toHaveProperty("normalizedEmail");
  });

  it("gives A-5 and the other fieldsOnly actor rows their uid field queries", () => {
    expect(sweepsOf("A-2")).toEqual([
      { kind: "fieldEquals", field: "createdBy", value: "uid" },
      { kind: "fieldEquals", field: "updatedBy", value: "uid" },
    ]);
  });

  it("gives I-13 and I-14 a uid field query on authorUid", () => {
    expect(sweepsOf("I-13")).toEqual([{ kind: "fieldEquals", field: "authorUid", value: "uid" }]);
    expect(sweepsOf("I-14")).toEqual([{ kind: "fieldEquals", field: "authorUid", value: "uid" }]);
  });

  it("has no sweep for preserved, transient and external rows (P-1..P-6, I-15, E-1..E-4)", () => {
    for (const id of ["P-1", "P-2", "P-3", "P-4", "P-5", "P-6", "I-15", "E-1", "E-2", "E-3", "E-4"]) {
      expect(sweepsOf(id)).toEqual([]);
    }
  });

  it("gives every DELETE, ANONYMIZE, DETACH and DISCOVERY row at least one sweep query", () => {
    const uncovered = INVENTORY_ROWS.filter(
      (row) =>
        ["DELETE", "ANONYMIZE", "DETACH", "DISCOVERY"].includes(row.class) && sweepQueriesForRow(row).length === 0,
    ).map((row) => row.id);
    expect(uncovered).toEqual([]);
  });
});

describe("erasure inventory change-detection tripwire over the repository (DEMOTED, not a completeness proof)", () => {
  const files = loadRepositorySource();
  const report = guardOver(files);

  it("scans a real amount of source (not a vacuous pass)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(report.collectionSegmentsSeen.size).toBeGreaterThanOrEqual(15);
    expect(report.uidBearingFieldsSeen.size).toBeGreaterThanOrEqual(10);
  });

  it("finds no unregistered uid-bearing field name and no unregistered collection", () => {
    expect(report.violations).toEqual([]);
  });

  it("registers the known persisted personal fields", () => {
    for (const name of ["authorUid", "createdBy", "archivedBy", "memberRef", "ownerRef", "email"]) {
      expect(registeredFields().has(name)).toBe(true);
    }
  });
});

/**
 * Source with the exact approved structure (SKILL_PROFILE_TRANSACTION_CONTEXT): the members are the object literal passed to
 * `work(...)` inside `runTransaction`, which is returned by `getDefaultSkillProfileStore`. Test-only; the real file is scanned
 * by the real-tree test.
 */
const inApprovedTransaction = (members: string) =>
  `export function getDefaultSkillProfileStore() { return { async runTransaction(uid, work) { return db.runTransaction(async (tx) => work({ ${members} })); } }; }`;

describe("erasure inventory tripwire (synthetic input)", () => {
  const registered = registeredFields();
  const segments = registeredCollectionSegments();

  it("fails on a uid-bearing field name that is neither registered nor allow-listed", () => {
    const report = checkInventoryCoverage({
      files: [{ path: "synthetic.ts", text: 'await docs.update({ unregisteredOwnerUid: "x" });' }],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([
      { kind: "unregistered-field", name: "unregisteredOwnerUid", path: "synthetic.ts" },
    ]);
  });

  it("fails on a collection literal that is not in the registry", () => {
    const report = checkInventoryCoverage({
      files: [{ path: "synthetic.ts", text: 'db.collection("shadowMemberships").doc(id).set({});' }],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([
      { kind: "unregistered-collection", name: "shadowMemberships", path: "synthetic.ts" },
    ]);
  });

  it("fails on an unregistered collection group, template-literal collection, or document path (Finding 1)", () => {
    const report = checkInventoryCoverage({
      files: [
        { path: "group.ts", text: 'db.collectionGroup("shadowMemberships").get();' },
        { path: "template.ts", text: "db.collection(`shadowTemplates`).get();" },
        { path: "doc.ts", text: 'db.doc("shadowTeams/team-1").set({});' },
      ],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([
      { kind: "unregistered-collection", name: "shadowMemberships", path: "group.ts" },
      { kind: "unregistered-collection", name: "shadowTemplates", path: "template.ts" },
      { kind: "unregistered-collection", name: "shadowTeams", path: "doc.ts" },
    ]);
  });

  it("does not read a document ID from a document path as a collection name", () => {
    const report = checkInventoryCoverage({
      files: [{ path: "doc.ts", text: 'db.doc("forumThreads/unregisteredDocumentId").get();' }],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([]);
  });

  it("fails on an unregistered uid-bearing member access such as snap.data().ownerUid (Finding 2)", () => {
    const report = checkInventoryCoverage({
      files: [{ path: "read.ts", text: "const owner = snapshot.shadowOwnerUid;" }],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([{ kind: "unregistered-field", name: "shadowOwnerUid", path: "read.ts" }]);
  });

  it("does not treat a method call on a uid-suffixed name as a field", () => {
    const report = checkInventoryCoverage({
      files: [{ path: "call.ts", text: "const r = service.lookupUid(id);" }],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([]);
  });

  it("fails on the modular API and single-quoted collection and document paths (review finding 1)", () => {
    const report = checkInventoryCoverage({
      files: [
        { path: "modular.ts", text: 'await addDoc(collection(db, "shadowB"), {});' },
        { path: "single.ts", text: "db.collection('shadowC').get();" },
        { path: "modularDoc.ts", text: 'await setDoc(doc(db, "shadowD/x"), {});' },
      ],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([
      { kind: "unregistered-collection", name: "shadowB", path: "modular.ts" },
      { kind: "unregistered-collection", name: "shadowC", path: "single.ts" },
      { kind: "unregistered-collection", name: "shadowD", path: "modularDoc.ts" },
    ]);
  });

  it("fails on an unregistered identifier-suffixed owner name such as ownerId (review finding 2)", () => {
    const report = checkInventoryCoverage({
      files: [{ path: "id.ts", text: "const row = { ownerId: uid };" }],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([{ kind: "unregistered-field", name: "ownerId", path: "id.ts" }]);
  });

  it("allows an injected member-access name only as a member read, never as a persisted key (review finding 3)", () => {
    const memberOnly = checkInventoryCoverage({
      files: [{ path: "deps.ts", text: "const f = deps.generateRef ?? gen;" }],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedMemberAccess: { generateRef: "reason" },
      allowedCollections: {},
    });
    expect(memberOnly.violations).toEqual([]);

    const persistedKey = checkInventoryCoverage({
      files: [{ path: "write.ts", text: "const f = deps.generateRef; tx.set(ref, { generateRef: value });" }],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedMemberAccess: { generateRef: "reason" },
      allowedCollections: {},
    });
    expect(persistedKey.violations).toEqual([{ kind: "unregistered-field", name: "generateRef", path: "write.ts" }]);
  });

  it("fails on optional, one-line and multi-line type members with an unregistered owner name (round-4 finding 1)", () => {
    const report = checkInventoryCoverage({
      files: [
        { path: "optional.ts", text: "type Row = { ownerId?: string };" },
        { path: "oneLine.ts", text: "type Row = { label: string; shadowOwnerUid: string };" },
        { path: "multiLine.ts", text: "type Row = {\n  shadowAuthorUid?: string;\n};" },
      ],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([
      { kind: "unregistered-field", name: "ownerId", path: "optional.ts" },
      { kind: "unregistered-field", name: "shadowOwnerUid", path: "oneLine.ts" },
      { kind: "unregistered-field", name: "shadowAuthorUid", path: "multiLine.ts" },
    ]);
  });

  it("fails on a backtick document path and on a collection behind a call as the first argument (round-4 findings 2 and 3)", () => {
    const report = checkInventoryCoverage({
      files: [
        { path: "docTemplate.ts", text: "await setDoc(doc(db, `shadowTeams/x`), {});" },
        { path: "callArg.ts", text: 'await addDoc(collection(getDb(), "shadowE"), {});' },
        { path: "callDoc.ts", text: 'await setDoc(doc(getDb(), "shadowT/x"), {});' },
      ],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([
      { kind: "unregistered-collection", name: "shadowTeams", path: "docTemplate.ts" },
      { kind: "unregistered-collection", name: "shadowE", path: "callArg.ts" },
      { kind: "unregistered-collection", name: "shadowT", path: "callDoc.ts" },
    ]);
  });

  it("fails on a collection or document path behind a quoted first argument, and on a single-quoted constant (review round 6)", () => {
    const report = checkInventoryCoverage({
      files: [
        { path: "quotedArg.ts", text: 'await addDoc(collection(getDb("prod"), "shadowE"), {});' },
        { path: "quotedDoc.ts", text: 'await setDoc(doc(getDb("prod"), "shadowT/x"), {});' },
        { path: "constant.ts", text: "export const X_COLLECTION = 'shadowC';" },
      ],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([
      { kind: "unregistered-collection", name: "shadowE", path: "quotedArg.ts" },
      { kind: "unregistered-collection", name: "shadowT", path: "quotedDoc.ts" },
      { kind: "unregistered-collection", name: "shadowC", path: "constant.ts" },
    ]);
  });

  it("fails on a single-quoted or backtick uid-bearing field name (review round 6)", () => {
    const report = checkInventoryCoverage({
      files: [
        { path: "quotes.ts", text: "where('shadowOwnerUid', '==', u); const r = { `shadowAuthorUid`: u };" },
      ],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([
      { kind: "unregistered-field", name: "shadowOwnerUid", path: "quotes.ts" },
      { kind: "unregistered-field", name: "shadowAuthorUid", path: "quotes.ts" },
    ]);
  });

  it("fails on a trailing-comma collection call, a modified member, a block comment before code, and an apostrophe in a comment (review round 7)", () => {
    const report = checkInventoryCoverage({
      files: [
        { path: "trailing.ts", text: 'await addDoc(collection(db, "shadowX",), {});' },
        { path: "modifier.ts", text: "type R = {\n  readonly shadowOwnerUid: string;\n};" },
        { path: "block.ts", text: "/* legacy */ tx.set(ref, { shadowAuthorUid: u });" },
        { path: "apostrophe.ts", text: 'await addDoc(collection(db, // don\'t\n "shadowY"), {});' },
        { path: "commentOnly.ts", text: "// tx.set(ref, { ownerUid: u }); // collection(db, \"shadowZ\")" },
      ],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([
      { kind: "unregistered-collection", name: "shadowX", path: "trailing.ts" },
      { kind: "unregistered-field", name: "shadowOwnerUid", path: "modifier.ts" },
      { kind: "unregistered-field", name: "shadowAuthorUid", path: "block.ts" },
      { kind: "unregistered-collection", name: "shadowY", path: "apostrophe.ts" },
    ]);
  });

  it("checks a *_SUBCOLLECTION constant at its definition, and fails closed on a dynamic subcollection helper (conversation-store refactor)", () => {
    const report = checkInventoryCoverage({
      files: [
        { path: "constants.ts", text: 'export const SHADOW_SUBCOLLECTION = "shadowSub";' },
        { path: "helper.ts", text: "function subtree(db, uid, sub) { return db.collection(USER_DEVELOPMENT_COLLECTION).doc(uid).collection(sub); }" },
        { path: "uses.ts", text: "db.collection(USER_DEVELOPMENT_COLLECTION).doc(uid).collection(SHADOW_SUBCOLLECTION);" },
      ],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([
      { kind: "unregistered-collection", name: "shadowSub", path: "constants.ts" },
      { kind: "unresolvable-collection", name: "sub", path: "helper.ts" },
    ]);
  });

  describe("approved SkillTree dynamic-key write shape (C1 persistence model exception)", () => {
    const SKILL_STORE = "src/features/skill-profiles/server/skill-profile-store.ts";
    const approvedWrite = inApprovedTransaction(
      "setLevel(treeId, level, stamps) { tx.set(profileRef, { levels: { [treeId]: level }, ...stamps }, { merge: true }); }",
    );
    const run = (path: string, text: string) =>
      checkInventoryCoverage({
        files: [{ path, text }],
        registeredFields: registered,
        registeredCollectionSegments: segments,
        allowedFields: {},
        allowedCollections: {},
        approvedDynamicKeys: APPROVED_DYNAMIC_KEYS,
      }).violations.filter((v) => v.kind === "unresolvable-field");

    it("accepts exactly the approved write in its approved file", () => {
      expect(run(SKILL_STORE, approvedWrite)).toEqual([]);
    });

    it("accepts the approved set only as a setLevel parameter that is not rebound (review round 11, finding 2)", () => {
      const inSetLevel = (body: string, method = "setLevel", params = "treeId, level, stamps") =>
        inApprovedTransaction(`${method}(${params}) { ${body} }`);
      const write = "tx.set(ref, { levels: { [treeId]: level } }, { merge: true });";
      expect(run(SKILL_STORE, inSetLevel(`const treeId = uid; ${write}`))).toHaveLength(1);
      expect(run(SKILL_STORE, inSetLevel(`treeId = uid; ${write}`))).toHaveLength(1);
      expect(run(SKILL_STORE, inSetLevel(write, "removeLevel"))).toHaveLength(1);
      expect(run(SKILL_STORE, inSetLevel(write, "setLevel", "uid, level, stamps"))).toHaveLength(1);
      expect(run(SKILL_STORE, `class Other { setLevel(treeId, level, stamps) { ${write} } }`)).toHaveLength(1);
    });

    it("still fails another computed key inside a Firestore write in the same file", () => {
      expect(run(SKILL_STORE, "tx.set(profileRef, { [field]: value });")).toEqual([
        { kind: "unresolvable-field", name: "[field]", path: SKILL_STORE },
      ]);
    });

    it("still fails the same shape in another file", () => {
      expect(run("src/features/skill-profiles/server/other-store.ts", approvedWrite)).toEqual([
        { kind: "unresolvable-field", name: "[treeId]", path: "src/features/skill-profiles/server/other-store.ts" },
      ]);
    });

    it("still fails another dynamic property beside the approved levels[treeId] shape", () => {
      const inSetLevel = (body: string) => inApprovedTransaction(`setLevel(treeId, level, stamps) { ${body} }`);
      expect(run(SKILL_STORE, inSetLevel("tx.set(ref, { levels: { [treeId]: level, [extra]: 2 } });"))).toEqual([
        { kind: "unresolvable-field", name: "[treeId]", path: SKILL_STORE },
        { kind: "unresolvable-field", name: "[extra]", path: SKILL_STORE },
      ]);
      expect(run(SKILL_STORE, inSetLevel("tx.set(ref, { levels: { [treeId]: level }, [dyn]: v });"))).toEqual([
        { kind: "unresolvable-field", name: "[dyn]", path: SKILL_STORE },
      ]);
    });

    it("never accepts an identity-bearing computed key in the levels shape", () => {
      expect(run(SKILL_STORE, "tx.set(ref, { levels: { [ownerUid]: level } });")).toEqual([
        { kind: "unresolvable-field", name: "[ownerUid]", path: SKILL_STORE },
      ]);
      expect(run(SKILL_STORE, "tx.set(ref, { levels: { [uid]: level } });")).toEqual([
        { kind: "unresolvable-field", name: "[uid]", path: SKILL_STORE },
      ]);
    });

    it("does not extend to another write call, so update with the same shape still fails", () => {
      expect(run(SKILL_STORE, "tx.update(ref, { levels: { [treeId]: level } });")).toEqual([
        { kind: "unresolvable-field", name: "[treeId]", path: SKILL_STORE },
      ]);
    });

    it("keeps the exception to exactly one shape (no broad allowance)", () => {
      expect(APPROVED_DYNAMIC_KEYS).toHaveLength(1);
      expect(APPROVED_DYNAMIC_KEYS[0]).toMatchObject({
        path: SKILL_STORE,
        writeCall: "set",
        parentProperty: "levels",
        keyIdentifier: "treeId",
      });
    });
  });

  it("checks each segment of a dotted field-path literal and a dynamic query field (review round 8)", () => {
    const report = checkInventoryCoverage({
      files: [
        { path: "dotted.ts", text: 'tx.update(ref, { "levels.shadowOwnerUid": uid });' },
        { path: "query.ts", text: "function f(field, v) { return q.where(field, '==', v); }" },
        { path: "modular.ts", text: "setDoc(ref, { shadowAuthorUid: uid });" },
      ],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations.filter((v) => v.kind !== "stale-allow-list")).toEqual([
      { kind: "unregistered-field", name: "shadowOwnerUid", path: "dotted.ts" },
      { kind: "unresolvable-field", name: "field", path: "query.ts" },
      { kind: "unregistered-field", name: "shadowAuthorUid", path: "modular.ts" },
    ]);
  });

  it("the approved shape is bound to the tx receiver, so another object's set with the same shape still fails", () => {
    const SKILL_STORE = "src/features/skill-profiles/server/skill-profile-store.ts";
    const report = checkInventoryCoverage({
      files: [{ path: SKILL_STORE, text: "map.set(id, { levels: { [treeId]: level } });" }],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
      approvedDynamicKeys: APPROVED_DYNAMIC_KEYS,
    });
    expect(report.violations.filter((v) => v.kind === "unresolvable-field")).toEqual([
      { kind: "unresolvable-field", name: "[treeId]", path: SKILL_STORE },
    ]);
  });

  describe("approved removeLevel FieldPath delete (C1 persistence model exception, delete side)", () => {
    const SKILL_STORE = "src/features/skill-profiles/server/skill-profile-store.ts";
    const APPROVED_CALL = 'tx.update(profileRef, new FieldPath("levels", treeId), FieldValue.delete(), "updatedAt", stamps.updatedAt);';
    /** A store object whose method holds `body`; the method name and parameters are parameters of the case. */
    const inMethod = (body: string, method = "removeLevel", params = "treeId, stamps") =>
      inApprovedTransaction(`${method}(${params}) { ${body} }`);
    const run = (path: string, text: string) =>
      checkInventoryCoverage({
        files: [{ path, text }],
        registeredFields: registered,
        registeredCollectionSegments: segments,
        allowedFields: {},
        allowedCollections: {},
        approvedDynamicKeys: APPROVED_DYNAMIC_KEYS,
        approvedDynamicFieldPaths: APPROVED_DYNAMIC_FIELD_PATHS,
      }).violations.filter((v) => v.kind === "unresolvable-field");

    it("accepts exactly the approved delete in removeLevel in its approved file", () => {
      expect(run(SKILL_STORE, inMethod(APPROVED_CALL))).toEqual([]);
    });

    it("keeps the exception to exactly one FieldPath shape, bound to the tx receiver and the removeLevel method", () => {
      expect(APPROVED_DYNAMIC_FIELD_PATHS).toEqual([
        expect.objectContaining({
          path: SKILL_STORE,
          receiver: "tx",
          firstSegment: "levels",
          keyIdentifier: "treeId",
          enclosingMethod: "removeLevel",
        }),
      ]);
    });

    it("does not accept new FieldPath with an identity-bearing segment (ownerUid, uid)", () => {
      expect(run(SKILL_STORE, inMethod('tx.update(ref, new FieldPath("levels", ownerUid), FieldValue.delete());'))).toEqual([
        { kind: "unresolvable-field", name: 'new FieldPath("levels", ownerUid)', path: SKILL_STORE },
      ]);
      expect(run(SKILL_STORE, inMethod('tx.update(ref, new FieldPath("levels", uid), FieldValue.delete());'))).toEqual([
        { kind: "unresolvable-field", name: 'new FieldPath("levels", uid)', path: SKILL_STORE },
      ]);
    });

    it("does not accept another first segment (otherMap) with the treeId identifier", () => {
      expect(run(SKILL_STORE, inMethod('tx.update(ref, new FieldPath("otherMap", treeId), FieldValue.delete());'))).toHaveLength(1);
    });

    it("does not accept the same FieldPath shape in an unrelated file", () => {
      expect(run("src/features/skill-profiles/server/other-store.ts", inMethod(APPROVED_CALL))).toHaveLength(1);
    });

    it("does not accept the same shape through an unrelated receiver such as map.update", () => {
      expect(run(SKILL_STORE, inMethod(APPROVED_CALL.replace("tx.update", "map.update")))).toHaveLength(1);
    });

    it("does not accept a non-delete value instead of FieldValue.delete()", () => {
      expect(run(SKILL_STORE, inMethod('tx.update(ref, new FieldPath("levels", treeId), level);'))).toHaveLength(1);
      expect(run(SKILL_STORE, inMethod('tx.update(ref, new FieldPath("levels", treeId), FieldValue.serverTimestamp());'))).toHaveLength(1);
    });

    it("does not accept a dynamic first segment, an extra segment, or the same shape in another method", () => {
      expect(run(SKILL_STORE, inMethod('tx.update(ref, new FieldPath(segment, treeId), FieldValue.delete());'))).toHaveLength(1);
      expect(run(SKILL_STORE, inMethod('tx.update(ref, new FieldPath("levels", treeId, extra), FieldValue.delete());'))).toHaveLength(1);
      expect(run(SKILL_STORE, inMethod(APPROVED_CALL, "setLevel"))).toHaveLength(1);
    });

    it("does not accept the shape when treeId is not a parameter of removeLevel, or from a closure inside it", () => {
      expect(run(SKILL_STORE, inMethod(APPROVED_CALL, "removeLevel", "id, stamps"))).toHaveLength(1);
      expect(run(SKILL_STORE, inMethod(`[1].forEach(() => { ${APPROVED_CALL} });`))).toHaveLength(1);
    });

    it("does not accept the modular updateDoc form or a dynamic FieldPath in a query", () => {
      expect(run(SKILL_STORE, inMethod('updateDoc(ref, new FieldPath("levels", treeId), FieldValue.delete());'))).toHaveLength(1);
      expect(run(SKILL_STORE, inMethod('q.where(new FieldPath("levels", treeId), "==", 1);'))).toHaveLength(1);
    });

    it("does not accept an extra field/value pair after the approved delete (review round 10, finding 1)", () => {
      expect(
        run(SKILL_STORE, inMethod('tx.update(profileRef, new FieldPath("levels", treeId), FieldValue.delete(), new FieldPath("levels", uid), FieldValue.delete(), "updatedAt", stamps.updatedAt);')),
      ).toEqual([{ kind: "unresolvable-field", name: 'new FieldPath("levels", uid)', path: SKILL_STORE }]);
      expect(run(SKILL_STORE, inMethod('tx.update(ref, "updatedAt", v, dynName, stamps.uid);'))).toEqual([
        { kind: "unresolvable-field", name: "dynName", path: SKILL_STORE },
      ]);
    });

    it("does not accept a spread of dynamic field names in a field position (review round 10, finding 1)", () => {
      expect(run(SKILL_STORE, inMethod('tx.update(ref, "updatedAt", v, ...pairs);'))).toHaveLength(1);
      expect(run(SKILL_STORE, inMethod('tx.update(profileRef, ...pairs);'))).toHaveLength(1);
      expect(run(SKILL_STORE, inMethod('tx.update(profileRef, "updatedAt", ...pairs);'))).toHaveLength(1);
      // The spread is flagged, and so is the dynamic field name `w` that follows it (positions after a spread are unknown).
      expect(run(SKILL_STORE, inMethod('tx.update(ref, "a", v, ...pairs, "b", w);'))).toHaveLength(2);
      expect(run(SKILL_STORE, inMethod('tx.update(ref, "updatedAt", v, ...(c ? [dyn, v] : []));'))).toHaveLength(1);
      expect(run(SKILL_STORE, inMethod('tx.update(ref, "updatedAt", v, ...(c ? ["createdAt", v] : []));'))).toEqual([]);
    });

    it("does not accept a treeId that is redeclared or reassigned inside removeLevel (review round 10, finding 2)", () => {
      expect(run(SKILL_STORE, inMethod(`{ const treeId = stamps.sessionKey; ${APPROVED_CALL} }`))).toHaveLength(1);
      expect(run(SKILL_STORE, inMethod(`treeId = stamps.uid; ${APPROVED_CALL}`))).toHaveLength(1);
      expect(run(SKILL_STORE, inMethod(`[1].forEach((treeId) => { ${APPROVED_CALL} });`))).toHaveLength(1);
    });

    it("fails closed on a non-identifier callee that carries a forbidden identity key or field (round 12, finding 1)", () => {
      expect(run(SKILL_STORE, 'tx["set"](ref, { [ownerUid]: true });')).toHaveLength(1);
      expect(run(SKILL_STORE, "(tx.set)(ref, { [ownerUid]: true });")).toHaveLength(1);
      expect(run(SKILL_STORE, 'tx["update"](profileRef, new FieldPath("levels", ownerUid), FieldValue.delete());')).toHaveLength(1);
      expect(run(SKILL_STORE, 'q["where"](ownerUid, "==", 1);')).toHaveLength(1);
    });

    it("rejects an unregistered collection reached through an element access or a parenthesized callee (round 12, finding 1)", () => {
      const anyViolation = (text: string) =>
        checkInventoryCoverage({
          files: [{ path: SKILL_STORE, text }],
          registeredFields: registered,
          registeredCollectionSegments: segments,
          allowedFields: {},
          allowedCollections: {},
          approvedDynamicKeys: APPROVED_DYNAMIC_KEYS,
          approvedDynamicFieldPaths: APPROVED_DYNAMIC_FIELD_PATHS,
        }).violations.filter((v) => v.kind !== "stale-allow-list");
      expect(anyViolation('db["collection"]("personalMailbox");')).toEqual([
        { kind: "unregistered-collection", name: "personalMailbox", path: SKILL_STORE },
      ]);
      expect(anyViolation('(db.collection)("personalMailbox");')).toEqual([
        { kind: "unregistered-collection", name: "personalMailbox", path: SKILL_STORE },
      ]);
    });

    it("fails closed on an unnameable callee that carries a dynamic key, and does not report unrelated calls", () => {
      const kinds = (text: string) =>
        checkInventoryCoverage({
          files: [{ path: SKILL_STORE, text }],
          registeredFields: registered,
          registeredCollectionSegments: segments,
          allowedFields: {},
          allowedCollections: {},
        }).violations.filter((v) => v.kind !== "stale-allow-list");
      expect(kinds("handlers[kind](ref, { [k]: v });")).toEqual([
        { kind: "unresolvable-call", name: "handlers[kind](ref, { [k]: v })", path: SKILL_STORE },
      ]);
      expect(kinds('import("firebase-admin/app");')).toEqual([]);
      expect(kinds('super("invalid key");')).toEqual([]);
      expect(kinds("(deps.getNames ?? fallback)(offered.map((row) => row.uid));")).toEqual([]);
    });

    it("keeps ordinary tx.set and tx.update checked", () => {
      expect(run(SKILL_STORE, "tx.set(ref, { [ownerUid]: true });")).toHaveLength(1);
      // Field positions are 1, 3, 5, …: `dyn` at position 3 is the dynamic field; `w` at position 4 is a value.
      expect(run(SKILL_STORE, 'tx.update(ref, "updatedAt", v, dyn, w);')).toHaveLength(1);
    });

    it("does not give the exception to a same-named removeLevel outside the approved transaction (round 12, finding 2)", () => {
      const delete_ = 'tx.update(ref, new FieldPath("levels", treeId), FieldValue.delete());';
      expect(run(SKILL_STORE, `const o = { removeLevel(treeId, tx, ref) { ${delete_} } };`)).toHaveLength(1);
      expect(run(SKILL_STORE, `class Other { removeLevel(treeId, tx, ref) { ${delete_} } }`)).toHaveLength(1);
      expect(
        run(
          SKILL_STORE,
          `export function getDefaultSkillProfileStore() { return { async runTransaction(uid, work) { return db.runTransaction(async (tx) => work({ readProfile() {} })); }, async other() { const o = { removeLevel(treeId, tx, ref) { ${delete_} } }; } }; }`,
        ),
      ).toHaveLength(1);
    });

    it("resolves an imported *_FIELD constant declared once in the scan, and not one declared twice (review round 10, finding 3)", () => {
      const definition = { path: "src/features/a/domain/fields.ts", text: 'export const OWNER_LABEL_FIELD = "label";' };
      const importer = {
        path: "src/features/a/server/store.ts",
        text: 'import { OWNER_LABEL_FIELD } from "../domain/fields"; function w(tx, ref, v) { tx.set(ref, { [OWNER_LABEL_FIELD]: v }); }',
      };
      const check = (files: SourceFile[]) =>
        checkInventoryCoverage({
          files,
          registeredFields: registered,
          registeredCollectionSegments: segments,
          allowedFields: {},
          allowedCollections: {},
        }).violations.filter((v) => v.kind === "unresolvable-field");
      expect(check([definition, importer])).toEqual([]);
      const second = { path: "src/features/b/domain/other.ts", text: 'export const OWNER_LABEL_FIELD = pick();' };
      expect(check([definition, importer, second])).toHaveLength(1);
    });

    it("does not treat a same-file name shadowed by a parameter, a dynamic *_FIELD constant, or a reassigned let as static (review round 10, finding 3)", () => {
      expect(run(SKILL_STORE, 'const name = "x"; function w(tx, ref, name: string, v) { tx.set(ref, { [name]: v }); }')).toHaveLength(1);
      expect(run(SKILL_STORE, 'declare function pick(): string; const OWNER_FIELD = pick(); function w(tx, ref, uid) { tx.set(ref, { [OWNER_FIELD]: uid }); }')).toHaveLength(1);
      expect(run(SKILL_STORE, 'let field = "levels"; field = "x"; function w(tx, ref, uid) { field = uid; tx.set(ref, { [field]: 1 }); }')).toHaveLength(1);
    });
  });

  it("rejects persisted fields named as the former injected dependencies, under the real allow-lists (TASK-006 rename)", () => {
    const report = checkInventoryCoverage({
      files: [
        { path: "persist.ts", text: "tx.set(ref, { getUserByEmail: value, generateRef: other });" },
        { path: "member.ts", text: "const f = deps.createKey;" },
      ],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: ALLOWED_UNREGISTERED_NAMES,
      allowedMemberAccess: ALLOWED_MEMBER_ACCESS_NAMES,
      allowedCollections: ALLOWED_UNREGISTERED_COLLECTIONS,
    });
    expect(report.violations.filter((v) => v.kind === "unregistered-field")).toEqual([
      { kind: "unregistered-field", name: "getUserByEmail", path: "persist.ts" },
      { kind: "unregistered-field", name: "generateRef", path: "persist.ts" },
    ]);
  });

  it("accepts a registered field and a registered collection", () => {
    const report = checkInventoryCoverage({
      files: [{ path: "synthetic.ts", text: 'db.collection("forumThreads").where("authorUid", "==", uid);' }],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: {},
      allowedCollections: {},
    });
    expect(report.violations).toEqual([]);
  });

  it("reports an allow-list entry that no longer occurs in source as stale", () => {
    const report = checkInventoryCoverage({
      files: [{ path: "synthetic.ts", text: "const x = 1;" }],
      registeredFields: registered,
      registeredCollectionSegments: segments,
      allowedFields: { presenterUid: "reason" },
      allowedCollections: {},
    });
    expect(report.violations).toEqual([{ kind: "stale-allow-list", name: "presenterUid" }]);
  });
});
