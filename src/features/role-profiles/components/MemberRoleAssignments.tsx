"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { TextField } from "../../../components/ui/TextField";
import { InitialsAvatar } from "../../../components/ui/dashboard/DashboardPrimitives";
import { matchesSearchQuery } from "../../../components/ui/search-match";
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
 * assignment never grants application permission; the copy says so beside the section. Each row is compact. Only one
 * row's editor is open at a time, so a long member list never mounts a select per member. Search runs over the already
 * loaded names, e-mails and role names.
 */
export function MemberRoleAssignments({ token, members }: MemberRoleAssignmentsProps) {
  const [catalogue, setCatalogue] = useState<CatalogueState>({ status: "loading" });
  const [assignments, setAssignments] = useState<AssignmentsState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [editingUid, setEditingUid] = useState<string | null>(null);
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
  const roleNameFor = (uid: string): string | null => {
    const roleId = roleIds[uid] ?? null;
    if (roleId === null) return null;
    return roles.find((role) => role.roleId === roleId)?.name ?? null;
  };
  const assignedCount = members.filter((member) => (roleIds[member.uid] ?? null) !== null).length;
  const isSearching = query.trim() !== "";
  const visibleMembers = members.filter((member) =>
    matchesSearchQuery(query, [member.displayName, member.email, roleNameFor(member.uid)]),
  );

  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-wrap gap-2">
        <RoleStat label={roleAssignmentCopy.statMembers} value={members.length} />
        <RoleStat label={roleAssignmentCopy.statWithRole} value={assignedCount} />
        <RoleStat label={roleAssignmentCopy.statWithoutRole} value={members.length - assignedCount} />
      </dl>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full min-w-0 sm:max-w-sm">
          <TextField
            id="member-role-search"
            type="search"
            label={roleAssignmentCopy.searchLabel}
            value={query}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {isSearching && (
          <Button type="button" variant="tertiary" size="sm" onClick={() => setQuery("")}>
            {roleAssignmentCopy.searchReset}
          </Button>
        )}
      </div>
      <p role="status" className="text-sm text-text-secondary">
        {isSearching ? roleAssignmentCopy.resultCount(visibleMembers.length, members.length) : ""}
      </p>

      {visibleMembers.length === 0 ? (
        <p className="rounded-surface border border-border-subtle bg-surface px-4 py-6 text-center text-sm text-text-secondary">
          {`${roleAssignmentCopy.noMatches} ${roleAssignmentCopy.tryAnother}`}
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-surface border border-border-subtle bg-surface shadow-card">
          {visibleMembers.map((member) => (
            <MemberRoleRow
              key={member.uid}
              token={token}
              member={member}
              assignedRoleId={roleIds[member.uid] ?? null}
              roles={roles}
              isEditing={editingUid === member.uid}
              onStartEdit={() => setEditingUid(member.uid)}
              onStopEdit={() => setEditingUid((current) => (current === member.uid ? null : current))}
              onAssignedRoleChange={(roleId) =>
                setAssignments((previous) =>
                  previous.status === "ready"
                    ? { status: "ready", roleIds: { ...previous.roleIds, [member.uid]: roleId } }
                    : previous,
                )
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RoleStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2 rounded-control border border-border-subtle bg-surface px-3 py-1.5">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className="text-base font-semibold tabular-nums text-text-primary">{value}</dd>
    </div>
  );
}

interface MemberRoleRowProps {
  token: string;
  member: RoleAssignmentMember;
  assignedRoleId: string | null;
  roles: readonly AdminRoleView[];
  isEditing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onAssignedRoleChange: (roleId: string | null) => void;
}

type RowState = { status: "idle" } | { status: "pending" } | { status: "error"; message: string } | { status: "saved"; message: string };

function MemberRoleRow({
  token,
  member,
  assignedRoleId,
  roles,
  isEditing,
  onStartEdit,
  onStopEdit,
  onAssignedRoleChange,
}: MemberRoleRowProps) {
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const selectId = `${baseId}-select`;
  const editorId = `${baseId}-editor`;
  const [selected, setSelected] = useState<string>("");
  const [row, setRow] = useState<RowState>({ status: "idle" });
  // Set by the handler that changes the editor, so focus moves only for the row the user acted on. An effect keyed on
  // `isEditing` alone would let a sibling's close steal focus from a row that was just opened.
  const focusIntent = useRef<"open" | "close" | null>(null);

  useEffect(() => {
    const intent = focusIntent.current;
    if (intent === null) return;
    focusIntent.current = null;
    const target = document.getElementById(intent === "open" ? selectId : triggerId);
    target?.focus({ preventScroll: true });
  }, [isEditing, selectId, triggerId]);

  const assignedRole = assignedRoleId === null ? undefined : roles.find((role) => role.roleId === assignedRoleId);
  // An assignment to an archived (or no longer listed) role stays visible and changeable, but no active role is ever substituted.
  const archivedAssignment = assignedRoleId !== null && (assignedRole === undefined || assignedRole.archived);
  const activeRoles = roles.filter((role) => !role.archived);
  const selectedRole = activeRoles.find((role) => role.roleId === selected);
  const pending = row.status === "pending";
  const displayName = member.displayName ?? roleAssignmentCopy.unnamedMember;

  function openEditor() {
    // Preselect the current role when it is active, so a change starts from what is stored.
    setSelected(assignedRole !== undefined && !assignedRole.archived ? assignedRole.roleId : "");
    setRow({ status: "idle" });
    focusIntent.current = "open";
    onStartEdit();
  }

  function closeEditor() {
    setSelected("");
    focusIntent.current = "close";
    onStopEdit();
  }

  async function handleAssign() {
    if (selected === "" || pending) return;
    setRow({ status: "pending" });
    const result = await assignAdminRoleToUser(token, member.uid, selected);
    if (result.ok) {
      onAssignedRoleChange(result.roleId);
      setRow({ status: "saved", message: roleAssignmentCopy.saved });
      closeEditor();
    } else {
      // The selection is kept on failure so the administrator can retry without choosing again.
      setRow({ status: "error", message: roleAssignmentErrorMessage(result.error) });
    }
  }

  async function handleRemove() {
    if (pending) return;
    setRow({ status: "pending" });
    const result = await removeAdminRoleFromUser(token, member.uid);
    if (result.ok) {
      onAssignedRoleChange(null);
      setRow({ status: "saved", message: roleAssignmentCopy.removed });
      closeEditor();
    } else {
      setRow({ status: "error", message: roleAssignmentErrorMessage(result.error) });
    }
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <InitialsAvatar name={member.displayName ?? ""} />
          <div className="min-w-0">
            <p className="break-words font-medium text-text-primary">{displayName}</p>
            {member.email !== null && <p className="break-all text-sm text-text-secondary">{member.email}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {assignedRoleId === null ? (
            <span className="text-sm text-text-muted">{roleAssignmentCopy.none}</span>
          ) : (
            <StatusBadge tone="info">
              {`${assignedRole?.name ?? roleAssignmentCopy.errors.role_not_found}${archivedAssignment ? ` (${roleAssignmentCopy.archivedRole})` : ""}`}
            </StatusBadge>
          )}
          <Button
            id={triggerId}
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={isEditing}
            aria-controls={editorId}
            onClick={() => (isEditing ? closeEditor() : openEditor())}
          >
            {assignedRoleId === null ? roleAssignmentCopy.assign : roleAssignmentCopy.change}
          </Button>
        </div>
      </div>

      {isEditing && (
        <div
          id={editorId}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            closeEditor();
          }}
          className="flex flex-col gap-3 rounded-control border border-border-subtle bg-surface-subtle p-3"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleAssign();
            }}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="min-w-0 sm:max-w-xs sm:flex-1">
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
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={pending || selected === "" || selected === assignedRoleId}
                pending={pending}
              >
                {pending ? roleAssignmentCopy.saving : roleAssignmentCopy.save}
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={closeEditor}>
                {roleAssignmentCopy.cancelEdit}
              </Button>
              {assignedRoleId !== null && (
                <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => void handleRemove()}>
                  {pending ? roleAssignmentCopy.removing : roleAssignmentCopy.remove}
                </Button>
              )}
            </div>
          </form>
          {selectedRole?.description ? <p className="text-sm text-text-secondary">{selectedRole.description}</p> : null}
        </div>
      )}

      {row.status === "error" && <Alert variant="error">{row.message}</Alert>}
      {row.status === "saved" && <p role="status" className="text-sm text-text-secondary">{row.message}</p>}
    </li>
  );
}
