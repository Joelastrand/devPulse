"use client";

import { useEffect, useState } from "react";
import {
  createTeamSystem,
  fetchAssignableMembers,
  updateTeamSystem,
  type AssignableMemberOption,
  type TeamSystemMutationResult,
} from "../client/team-systems-gateway";
import type { TeamSystemView } from "../server/list-team-systems";
import { SystemForm } from "./SystemForm";

/**
 * Create or edit panel shared by the Systemoversikt list and the system detail page. Loads the knowledge selector options
 * only while it is mounted. `system` is `null` to create. Writes always go through the authorized server gateway.
 */
export function SystemEditorPanel({
  token,
  teamId,
  system,
  onCancel,
  onSaved,
}: {
  token: string;
  teamId: string;
  system: TeamSystemView | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [members, setMembers] = useState<AssignableMemberOption[]>([]);
  const [membersStatus, setMembersStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    fetchAssignableMembers(token, teamId).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        setMembers(result.members);
        setMembersStatus("ok");
      } else {
        setMembersStatus("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, teamId]);

  async function submit(body: Record<string, unknown>): Promise<TeamSystemMutationResult> {
    if (system === null) {
      return createTeamSystem(token, teamId, body);
    }
    return updateTeamSystem(token, teamId, system.systemId, body);
  }

  return (
    <SystemForm
      key={system === null ? "create" : system.systemId}
      system={system}
      members={members}
      membersStatus={membersStatus}
      onSubmit={submit}
      onDone={onSaved}
      onCancel={onCancel}
    />
  );
}
