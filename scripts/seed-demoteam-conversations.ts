// Synthetic owner-only development conversations for the Demoteam owner.
//
// Encrypted through the app's own content codec (`encodeContent`), so no
// plaintext content reaches Firestore and no ciphertext is hand-made. Owner-only
// (no participant, no team link), so no participation index is written.
//
// Run (dry-run by default; writes need both flags):
//   node --conditions=react-server --import ./src/features/demo-team/register-ts-resolver.mjs \
//     --env-file-if-exists=.env.local scripts/seed-demoteam-conversations.ts
//   ... --write --confirm=devpulse-ac26e:demo-team

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { encodeContent, decodeContent } from "../src/features/development-conversations/server/content-codec";
import { decryptForClassification } from "../src/features/development-conversations/server/content-codec";
import { classifyStoredConversation } from "../src/features/development-conversations/domain/stored-owner-conversation";
import type { ConversationContent } from "../src/features/development-conversations/domain/content-payload";

const TARGET_PROJECT = "devpulse-ac26e";
const TEAM_ID = "demo-team";
const OWNER_UID = "GG0zEj9mPNMXFzQdicKdEgKQMsN2";

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const confirm = argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);
if (!argv.includes(`--project=${TARGET_PROJECT}`)) throw new Error("Aborted: --project=devpulse-ac26e is required");
if (WRITE && confirm !== `${TARGET_PROJECT}:${TEAM_ID}`) throw new Error("Aborted: --write requires --confirm=devpulse-ac26e:demo-team");
if (process.env.FIREBASE_PROJECT_ID !== TARGET_PROJECT) throw new Error("Aborted: env project does not match the target");

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const app = initializeApp(
  {
    credential: cert({
      projectId: TARGET_PROJECT,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? "",
      privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? "").split(BS + "n").join(NL).trim(),
    }),
    projectId: TARGET_PROJECT,
  },
  "seed-demoteam-conversations",
);
const db = getFirestore(app);

const d = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

const CONVERSATIONS: Array<{ id: string; plannedFor: string; status: "open" | "completed"; completedAt?: Date; createdAt: Date; updatedAt: Date; content: ConversationContent }> = [
  {
    id: "demoteam-conv-01",
    plannedFor: "2026-11-20",
    status: "open",
    createdAt: d("2026-11-02"),
    updatedAt: d("2026-11-04"),
    content: {
      title: "Oppfølging: trusselmodellering i nye tjenester",
      ownerNotes: "Gå gjennom malen for trusselmodellering og velg første pilottjeneste. Avklar hvem fra teamet som deltar.",
      nextSteps: ["Velge pilottjeneste", "Booke workshop med teamet bak Kontroll"],
      participantNotes: "",
      sharedGoals: [],
    },
  },
  {
    id: "demoteam-conv-02",
    plannedFor: "2026-09-25",
    status: "completed",
    completedAt: d("2026-10-02"),
    createdAt: d("2026-09-10"),
    updatedAt: d("2026-10-02"),
    content: {
      title: "Retrospektiv etter migrering av varsling",
      ownerNotes: "Migreringen gikk bra, men overvåkingen av kølengden var for svak. Vi må dokumentere runbooken.",
      nextSteps: ["Skrive runbook for varslingskø", "Sette opp alarm for kølengde"],
      participantNotes: "",
      sharedGoals: [],
    },
  },
  {
    id: "demoteam-conv-03",
    plannedFor: "2026-12-03",
    status: "open",
    createdAt: d("2026-10-20"),
    updatedAt: d("2026-11-05"),
    content: {
      title: "Mål for observerbarhet og mentorering",
      ownerNotes: "Ønsker å bli tryggere på strukturert logging og målinger. Avtale fast ukentlig tid til dette.",
      nextSteps: ["Gå gjennom logg-standarden", "Velge en mentee i teamet"],
      participantNotes: "",
      sharedGoals: [],
    },
  },
];

async function guards() {
  const team = await db.doc(`teams/${TEAM_ID}`).get();
  if (!team.exists || team.data()?.name !== "Demoteam" || team.data()?.status !== "active") throw new Error("Aborted: demo-team guard failed");
  if ((await db.doc(`superadmins/${OWNER_UID}`).get()).data()?.active !== true) throw new Error("Aborted: owner superadmin guard failed");
  if ((await db.doc(`accountErasures/${OWNER_UID}`).get()).exists) throw new Error("Aborted: owner erasure guard failed");
}

await guards();
const creates: string[] = [];
const skips: string[] = [];
for (const c of CONVERSATIONS) {
  const ref = db.doc(`userDevelopment/${OWNER_UID}/conversations/${c.id}`);
  if ((await ref.get()).exists) {
    skips.push(c.id);
    continue;
  }
  creates.push(c.id);
}
console.log(`Mode: ${WRITE ? "WRITE" : "dry-run"} | create=${creates.length} skip=${skips.length} (owner-only, team=null, no participant)`);

if (WRITE) {
  for (const c of CONVERSATIONS.filter((x) => creates.includes(x.id))) {
    const encoded = encodeContent(c.content);
    if (!encoded.ok) throw new Error(`Aborted: content codec unavailable (${encoded.error})`);
    const data = {
      teamId: null,
      participantUid: null,
      participantMemberRef: null,
      participantState: null,
      participantInvitedAt: null,
      participantAcceptedAt: null,
      plannedFor: c.plannedFor,
      status: c.status,
      completedAt: c.completedAt ?? null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      ...encoded.content,
    };
    await db.doc(`userDevelopment/${OWNER_UID}/conversations/${c.id}`).create(data);
  }
}

// Verification: classify each stored record with the app's own classifier and decode it.
for (const c of CONVERSATIONS) {
  const snap = await db.doc(`userDevelopment/${OWNER_UID}/conversations/${c.id}`).get();
  if (!snap.exists) {
    console.log(`${c.id}: not present (dry-run)`);
    continue;
  }
  const raw = snap.data() as Record<string, unknown>;
  const plain = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v instanceof Timestamp ? v.toDate() : v]));
  const result = classifyStoredConversation(plain, decryptForClassification);
  const decoded = result.kind === "valid" ? decodeContent({ ciphertext: raw.ciphertext as string, iv: raw.iv as string, authTag: raw.authTag as string, keyVersion: "v1", keyCheck: raw.keyCheck as string }) : null;
  const titleOk = decoded?.ok === true && decoded.content.title === c.content.title;
  console.log(`${c.id}: classification=${result.kind}${result.kind === "malformed" ? `(${result.reason})` : ""} titleRoundTrip=${titleOk}`);
}
process.exit(0);
