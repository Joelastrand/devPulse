/**
 * Presentation-only duplicate-name disambiguation and ordering for the
 * assignable-members selector (docs/features/team-skill-planning/SPEC.md —
 * D5b, BR-7). Pure: the ordinal is a rank computed per response from the
 * current member set, never stored, never accepted as an identifier.
 */

/** One current member that has a valid `memberRef`. `joinedAt` is a private ranking input (epoch ms), `null` when missing/invalid. */
export interface AssignableCandidate {
  memberRef: string;
  displayName: string | null;
  joinedAt: number | null;
  isSelf: boolean;
}

/** The only fields that leave this function: no `joinedAt`, no ranking key. */
export interface ArrangedAssignableMember {
  memberRef: string;
  displayName: string | null;
  ordinal: number | null;
  isSelf: boolean;
}

/** The neutral label unnamed members render as; used here only to group them with a member literally so named. */
const UNNAMED_GROUP_KEY = "medlem uten navn";

const NAME_COLLATOR = new Intl.Collator("nb", { sensitivity: "accent" });

function groupKeyOf(displayName: string | null): { key: string; unnamed: boolean } {
  const normalized = displayName === null ? "" : displayName.normalize("NFC").trim().toLowerCase();
  return normalized === "" ? { key: UNNAMED_GROUP_KEY, unnamed: true } : { key: normalized, unnamed: false };
}

function compareWithinGroup(a: AssignableCandidate, b: AssignableCandidate): number {
  const aJoined = a.joinedAt ?? Infinity;
  const bJoined = b.joinedAt ?? Infinity;
  if (aJoined !== bJoined) {
    return aJoined < bJoined ? -1 : 1;
  }
  return a.memberRef < b.memberRef ? -1 : a.memberRef > b.memberRef ? 1 : 0;
}

/**
 * Groups by normalised name (NFC, trim, case-insensitive; all unnamed
 * members form one group), ranks inside a group by `joinedAt` ascending
 * (missing last) then `memberRef` ascending, and assigns `ordinal = 1..n` only
 * to members of a group with ≥2 members. Output order: group by `nb`
 * collation of its normalised name (a group containing an unnamed member
 * last), then rank — so ordinals ascend within a name.
 */
export function arrangeAssignableMembers(
  candidates: readonly AssignableCandidate[],
): ArrangedAssignableMember[] {
  const groups = new Map<string, { key: string; unnamed: boolean; members: AssignableCandidate[] }>();
  for (const candidate of candidates) {
    const { key, unnamed } = groupKeyOf(candidate.displayName);
    const group = groups.get(key) ?? { key, unnamed: false, members: [] };
    group.unnamed ||= unnamed;
    group.members.push(candidate);
    groups.set(key, group);
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (a.unnamed !== b.unnamed) {
      return a.unnamed ? 1 : -1;
    }
    return NAME_COLLATOR.compare(a.key, b.key) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });

  return ordered.flatMap((group) => {
    const ranked = [...group.members].sort(compareWithinGroup);
    const duplicated = ranked.length > 1;
    return ranked.map(
      ({ memberRef, displayName, isSelf }, index): ArrangedAssignableMember => ({
        memberRef,
        // A blank name is unnamed: the client renders the neutral fallback.
        displayName: displayName !== null && displayName.trim() === "" ? null : displayName,
        ordinal: duplicated ? index + 1 : null,
        isSelf,
      }),
    );
  });
}
