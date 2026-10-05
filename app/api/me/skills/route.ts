import { NextResponse } from "next/server";
import { deleteOwnSkillProfile } from "../../../../src/features/skill-profiles/server/delete-own-skill-profile";
import { getOwnSkills } from "../../../../src/features/skill-profiles/server/get-own-skills";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Own skill self-assessment read (docs/features/individual-skill-self-assessment/
 * SPEC.md — BR-8). Thin: no uid in path, query or body; the subject is always
 * the verified token's own identity. `GET` and `DELETE` (erase-all) only.
 */
export async function GET(request: Request) {
  const result = await getOwnSkills(extractBearerToken(request.headers.get("authorization")));

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "unauthenticated" ? 401 : 500 });
  }

  const { skills, truncated, profile } = result.dto;
  return NextResponse.json(
    {
      skills: skills.map(({ treeId, name, level }) => ({ treeId, name, level })),
      truncated,
      profile,
    },
    { status: 200 },
  );
}

/** Erase-all (BR-14). The request body is deliberately never read. */
export async function DELETE(request: Request) {
  const result = await deleteOwnSkillProfile(extractBearerToken(request.headers.get("authorization")));

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "unauthenticated" ? 401 : 500 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) return "";
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}
