import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";
import type { CompetencePlan, PlanMilestone } from "../domain/competence-plan";

/**
 * Encryption of a competence plan's user-authored content: its title and its milestones (title, target date and status).
 * They are sealed together as one v2 envelope bound to `competence-plan:<teamId>:<planId>`, so the content cannot be moved
 * to another plan or another team.
 *
 * Plaintext stays for the plan's identity and metadata: the team (query key), the optional skill-tree label (a reference to
 * an organisational tree, not user-authored), the target stage, priority, archive flag and timestamps. Milestone ids live
 * inside the envelope, which keeps milestone identity intact.
 *
 * Fail-closed: a document without a valid envelope, or whose envelope fails authentication, opens as `null`, which the
 * domain parser refuses. A document carrying plaintext `title` or `milestones` is refused the same way.
 */

export const PLAN_CONTENT_FIELD = "content";
const SEALED_KEYS = ["title", "milestones"] as const;

interface PlanContent {
  title: string;
  milestones: PlanMilestone[];
}

function planContext(teamId: string, planId: string): string {
  return `competence-plan:${teamId}:${planId}`;
}

export function toPersistedCompetencePlan(
  planId: string,
  plan: CompetencePlan,
  seal: (plaintext: string, context: string) => RecordEnvelope = encryptRecord,
): Record<string, unknown> {
  const { title, milestones, ...metadata } = plan;
  const content: PlanContent = { title, milestones };
  const sealed: RecordEnvelope = seal(JSON.stringify(content), planContext(plan.teamId, planId));
  return { ...metadata, [PLAN_CONTENT_FIELD]: sealed };
}

/** Opens a stored plan back into the domain shape. `undefined` when absent; `null` when it cannot be opened. */
export function openCompetencePlanDocument(
  planId: string,
  data: unknown,
  open: (envelope: RecordEnvelope, context: string) => string = decryptRecord,
): unknown {
  if (data === undefined) return undefined;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const { [PLAN_CONTENT_FIELD]: sealed, ...metadata } = data as Record<string, unknown>;
  if (SEALED_KEYS.some((key) => Object.hasOwn(metadata, key))) return null;
  if (typeof metadata.teamId !== "string") return null;
  const content = openContent(metadata.teamId, planId, sealed, open);
  return content === null ? null : { ...metadata, ...content };
}

function openContent(
  teamId: string,
  planId: string,
  value: unknown,
  open: (envelope: RecordEnvelope, context: string) => string,
): PlanContent | null {
  const envelope = readRecordEnvelope(value);
  if (envelope === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(open(envelope, planContext(teamId, planId)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { title, milestones } = parsed as Record<string, unknown>;
  // Shape only: the domain parser validates the values.
  return { title, milestones } as PlanContent;
}
