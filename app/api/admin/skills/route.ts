import { NextResponse } from "next/server";
import { createSkillTree } from "../../../../src/features/skill-trees/server/create-skill-tree";
import { listSkillTrees } from "../../../../src/features/skill-trees/server/list-skill-trees";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only SkillTree catalog endpoint (docs/features/team-skill-tree/
 * SPEC.md — "API/DTO contracts"). `GET` lists the bounded catalog, `POST`
 * creates a new SkillTree. Kept thin — authorization, validation, and
 * persistence live entirely in `listSkillTrees`/`createSkillTree`
 * (`.claude/rules/nextjs-react.md`); this route duplicates none of that
 * decision logic and never spreads the parsed request body into either
 * operation.
 */
export async function GET(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listSkillTrees(token);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForListError(result.error) });
  }

  return NextResponse.json({ trees: result.trees }, { status: 200 });
}

export async function POST(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const result = await createSkillTree(token, record.name, record.nodeLabels);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForCreateError(result.error) });
  }

  return NextResponse.json({ treeId: result.treeId }, { status: 201 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForListError(error: "unauthenticated" | "forbidden" | "read_failed"): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  return 500;
}

function statusForCreateError(
  error: "unauthenticated" | "forbidden" | "invalid_input" | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "invalid_input") return 400;
  return 500;
}
