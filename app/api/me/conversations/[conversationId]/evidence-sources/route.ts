import { NextResponse } from "next/server";
import { conversationResponseStatus } from "../../../../../../src/features/development-conversations/domain/errors";
import { EVIDENCE_SOURCE_DTO_KEYS } from "../../../../../../src/features/development-conversations/domain/dto-keys";
import { listSelectableEvidenceForOwner } from "../../../../../../src/features/development-conversations/server/list-selectable-evidence";
import { productionSelectableEvidenceDeps } from "../../../../../../src/features/development-conversations/server/owner-route-deps";
import { verifiedSubject } from "../../_auth";
import { authRefusalStatus } from "../../../../../../src/features/auth/server/auth-refusal";

const NO_STORE = { "Cache-Control": "no-store" };

type RouteContext = { params: Promise<{ conversationId: string }> };

/**
 * Owner-only selectable evidence list (SPEC BR-41; SECURITY-REVIEW N-E2, N-E4). The verified token uid is the only subject.
 * A participant, a foreign owner and an unknown id all get `conversation_not_found`. Source ids appear only in this response.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const verified = await verifiedSubject(request);
  if (!verified.ok) return json({ error: verified.error }, authRefusalStatus(verified.error));

  const { conversationId } = await params;
  const result = await listSelectableEvidenceForOwner(verified.uid, conversationId, productionSelectableEvidenceDeps());
  if (!result.ok) return json({ error: result.error }, conversationResponseStatus(result.error));

  const items = result.items.map((item) => Object.fromEntries(EVIDENCE_SOURCE_DTO_KEYS.map((key) => [key, item[key]])));
  return json({ items, truncated: result.truncated }, 200);
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });
