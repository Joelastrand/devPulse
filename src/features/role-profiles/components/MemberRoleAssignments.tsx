"use client";

import { useEffect, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import { fetchAdminRoles, type AdminRoleView } from "../client/roles-gateway";
import { assignAdminRoleToUser, lookupRoleAssignments, removeAdminRoleFromUser } from "../client/role-assignment-gateway";
import { roleAssignmentCopy, roleAssignmentErrorMessage } from "../copy";

export interface RoleAssignmentMember {
  uid: string;
  displayName: string | null;
  email: string | null;
}

interface MemberRoleAssignmentsProps {
  /** The verified-session token for the admin calls. Every call is re-authorized by the server. */
  token: string;
  members: readonly RoleAssignmentMember[];
}

type CatalogueState = { status: "loading" } | { status: "ready"; roles: AdminRoleView[] } | { status: "error" };
type AssignmentsState = { status: "loading" } | { status: "ready"; roleIds: Record<string, string | null> } | { status: "error" };

/**
 * Admin section of the team page: each member's formal organizational role, with assign, change and remove controls
 * (role-profiles SPEC, "Formal role assignment"). The role list and the assignments are read once per section. An
 * assignment never grants application permission; the copy says so only where it helps the administrator.
 */
export function MemberRoleAssignments({ token, members }: MemberRoleAssignmentsProps) {
  const [catalogue, setCatalogue] = useState<CatalogueState>({ status: "loading" });
  const [assignments, setAssignments] = useState<AssignmentsState>({ status: "loading" });
  const memberUids = members.map((member) => member.uid).join("\u0000");

  useEffect(() => {
    let current = true;
    void fetchAdminRoles(token).then((result) => {
      if (!current) return;
      setCatalogue(result.status === "ok" ? { status: "ready", roles: result.roles } : { status: "error" });
    });
    return () => {
      current = false;
    };
  }, [token]);

  useEffect(() => {
    let current = true;
    const uids = memberUids === "" ? [] : memberUids.split("\u0000");
    void lookupRoleAssignments(token, uids).then((result) => {
      if (!current) return;
      setAssignments(result.status === "ok" ? { status: "ready", roleIds: result.roleIds } : { status: "error" });
    });
    return () => {
      current = false;
    };
  }, [token, memberUids]);

  if (members.length === 0) return null;
  if (catalogue.status === "loading" || assignments.status === "loading") {
    return <p className="text-sm text-text-secondary">{roleAssignmentCopy.loading}</p>;
  }
  if (catalogue.status === "error" || assignments.status === "error") {
    // Plain text, not an alert: this secondary section must not compete with the team page's own alerts.
    return <p className="text-sm text-text-secondary">{roleAssignmentCopy.lookupFailed}</p>;
  }

  const roles = catalogue.roles;
  const roleIds = assignments.roleIds;
  return (
    <ul className="flex flex-col gap-3">
      {members.map((member) => (
        <MemberRoleRow
          key={member.uid}
          token={token}
          member={member}
          assignedRoleId={roleIds[member.uid] ?? null}
          roles={roles}
          onAssignedRoleChange={(roleId) =>
            setAssignments((previous) =>
              previous.status === "ready" ? { status: "ready", roleIds: { ...previous.roleIds, [member.uid]: roleId } } : previous,
            )
          }
        />
      ))}
    </ul>
  );
}

interface MemberRoleRowProps {
  token: string;
  member: RoleAssignmentMember;
  assignedRoleId: string | null;
  roles: readonly AdminRoleView[];
  onAssignedRoleChange: (roleId: string | null) => void;
}

type RowState = { status: "idle" } | { status: "pending" } | { status: "error"; message: string } | { status: "saved"; message: string };

function MemberRoleRow({ token, member, assignedRoleId, roles, onAssignedRoleChange }: MemberRoleRowProps) {
  const [selected, setSelected] = useState<string>("");
  const [row, setRow] = useState<RowState>({ status: "idle" });

  const assignedRole = assignedRoleId === null ? undefined : roles.find((role) => role.roleId === assignedRoleId);
  // An assignment to an archived (or no longer listed) role stays visible and changeable, but no active role is ever substituted.
  const archivedAssignment = assignedRoleId !== null && (assignedRole === undefined || assignedRole.archived);
  const activeRoles = roles.filter((role) => !role.archived);
  const pending = row.status === "pending";
  const label = member.displayName ?? member.email ?? member.uid;
  const selectId = `member-role-${member.uid}`;

  async function handleAssign() {
    if (selected === "" || pending) return;
    setRow({ status: "pending" });
    const result = await assignAdminRoleToUser(token, member.uid, selected);
    if (result.ok) {
      onAssignedRoleChange(result.roleId);
      setSelected("");
      setRow({ status: "saved", message: roleAssignmentCopy.saved });
    } else {
      setRow({ status: "error", message: roleAssignmentErrorMessage(result.error) });
    }
  }

  async function handleRemove() {
    if (pending) return;
    setRow({ status: "pending" });
    const result = await removeAdminRoleFromUser(token, member.uid);
    if (result.ok) {
      onAssignedRoleChange(null);
      setSelected("");
      setRow({ status: "saved", message: roleAssignmentCopy.removed });
    } else {
      setRow({ status: "error", message: roleAssignmentErrorMessage(result.error) });
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border-subtle p-4">
      <div className="min-w-0">
        <p className="break-words font-medium text-text-primary">{label}</p>
        <p className="text-sm text-text-secondary">
          {roleAssignmentCopy.heading}:{" "}
          {assignedRoleId === null
            ? roleAssignmentCopy.none
            : `${assignedRole?.name ?? roleAssignmentCopy.errors.role_not_found}${archivedAssignment ? ` (${roleAssignmentCopy.archivedRole})` : ""}`}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <Select
            id={selectId}
            label={roleAssignmentCopy.select}
            value={selected}
            disabled={pending}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">{roleAssignmentCopy.select}</option>
            {activeRoles.map((role) => (
              <option key={role.roleId} value={role.roleId}>
                {role.name}
              </option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending || selected === "" || selected === assignedRoleId}
          pending={pending}
          onClick={() => void handleAssign()}
        >
          {assignedRoleId === null ? roleAssignmentCopy.assign : roleAssignmentCopy.change}
        </Button>
        {assignedRoleId !== null && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => void handleRemove()}
          >
            {roleAssignmentCopy.remove}
          </Button>
        )}
      </div>

      {row.status === "error" && <Alert variant="error">{row.message}</Alert>}
      {row.status === "saved" && <p role="status" className="text-sm text-text-secondary">{row.message}</p>}
    </li>
  );
}
