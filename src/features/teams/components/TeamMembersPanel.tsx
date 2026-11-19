"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { UserPlus } from "lucide-react";
import { ActionsMenu, type ActionMenuItem } from "../../../components/ui/ActionsMenu";
import { Alert } from "../../../components/ui/Alert";
import { Button, buttonClassName } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Icon } from "../../../components/ui/Icon";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { TextField } from "../../../components/ui/TextField";
import { InitialsAvatar } from "../../../components/ui/dashboard/DashboardPrimitives";
import { adminTeamTabHref } from "../admin-team-tabs";
import type { AdminTeamMemberEntry } from "../client/admin-team-detail-gateway";
import { adminCopy } from "../copy";
import { matchesSearchQuery } from "../../../components/ui/search-match";

/**
 * A member row's action state. `kind` says which mutation is in flight; either one blocks the other on that row. The
 * `confirming_removal` phase is the inline confirmation for removal: removal never runs from a single click.
 */
export type MemberActionState =
  | { status: "idle" }
  | { status: "confirming_removal" }
  | { status: "pending"; kind: "remove" | "role" }
  | { status: "error"; message: string };

export interface TeamMembersPanelProps {
  teamId: string;
  teamDisabled: boolean;
  members: readonly AdminTeamMemberEntry[];
  memberActions: Readonly<Record<string, MemberActionState>>;
  onSetRole: (uid: string, role: "teamadmin" | "member") => void;
  onRequestRemoval: (uid: string) => void;
  onCancelRemoval: (uid: string) => void;
  onConfirmRemoval: (uid: string) => void;
  /** Team-wide notices (member-reference preparation) shown under the header. */
  notices?: ReactNode;
}

/**
 * Members tab body (`Medlemmer`). Compact rows, client-side search over display name and e-mail, and one actions
 * disclosure per row. All data and mutations come from the parent `AdminTeamDetail`, which keeps the authorization
 * path and the account-generation guard. This component only decides presentation. Its search text is not persisted,
 * and the parent keys it by account generation so a switch clears it.
 */
export function TeamMembersPanel({
  teamId,
  teamDisabled,
  members,
  memberActions,
  onSetRole,
  onRequestRemoval,
  onCancelRemoval,
  onConfirmRemoval,
  notices,
}: TeamMembersPanelProps) {
  const copy = adminCopy.detail;
  const [query, setQuery] = useState("");
  const visibleMembers = members.filter((member) => matchesSearchQuery(query, [member.displayName, member.email]));
  const isSearching = query.trim() !== "";

  return (
    <section id="admin-section-members" aria-labelledby="admin-section-members-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="admin-section-members-heading" className="text-lg font-semibold text-text-primary">
            {copy.membersSectionTitle}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">{copy.membersSectionDescription}</p>
          <p className="mt-1 text-sm font-medium text-text-primary">{copy.memberCount(members.length)}</p>
          <p className="mt-1 text-sm text-text-secondary">
            {teamDisabled ? copy.leadDisabledTeamNote : copy.leadRoleHint}
          </p>
        </div>
        <Link
          href={adminTeamTabHref(teamId, "invitasjoner")}
          className={buttonClassName({ variant: "secondary", size: "sm", className: "shrink-0 gap-2 self-start" })}
        >
          <Icon icon={UserPlus} size="inline" />
          {copy.inviteMemberLink}
        </Link>
      </div>

      {notices}

      {members.length === 0 ? (
        <EmptyState>{copy.noMembers}</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-full min-w-0 sm:max-w-sm">
              <TextField
                id="admin-member-search"
                type="search"
                label={copy.memberSearchLabel}
                value={query}
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {isSearching && (
              <Button type="button" variant="tertiary" size="sm" onClick={() => setQuery("")}>
                {copy.memberSearchReset}
              </Button>
            )}
          </div>
          <p role="status" className="text-sm text-text-secondary">
            {isSearching ? copy.memberSearchResult(visibleMembers.length, members.length) : ""}
          </p>

          {visibleMembers.length === 0 ? (
            <EmptyState>{`${copy.noMatchingMembers} ${adminCopy.teams.tryAnotherSearch}`}</EmptyState>
          ) : (
            <ul className="divide-y divide-border-subtle rounded-surface border border-border-subtle bg-surface shadow-card">
              {visibleMembers.map((member) => (
                <MemberRow
                  key={member.uid}
                  member={member}
                  teamDisabled={teamDisabled}
                  action={memberActions[member.uid] ?? { status: "idle" }}
                  onSetRole={onSetRole}
                  onRequestRemoval={onRequestRemoval}
                  onCancelRemoval={onCancelRemoval}
                  onConfirmRemoval={onConfirmRemoval}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

interface MemberRowProps {
  member: AdminTeamMemberEntry;
  teamDisabled: boolean;
  action: MemberActionState;
  onSetRole: (uid: string, role: "teamadmin" | "member") => void;
  onRequestRemoval: (uid: string) => void;
  onCancelRemoval: (uid: string) => void;
  onConfirmRemoval: (uid: string) => void;
}

function MemberRow({
  member,
  teamDisabled,
  action,
  onSetRole,
  onRequestRemoval,
  onCancelRemoval,
  onConfirmRemoval,
}: MemberRowProps) {
  const copy = adminCopy.detail;
  const { uid } = member;
  const isLead = member.role === "teamadmin";
  const name = member.displayName ?? copy.unnamedMember;
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirming = action.status === "confirming_removal";

  // Focus moves to the safe choice (cancel) when confirmation opens, so Enter cannot remove the member by accident.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const pending = action.status === "pending";
  const pendingLabel =
    action.status === "pending"
      ? action.kind === "role"
        ? copy.savingRoleButton
        : copy.removingButton
      : null;

  const items: ActionMenuItem[] = [
    {
      key: "role",
      label: isLead ? copy.makeMemberButton : copy.makeLeadButton,
      // Existing rule: a team that is disabled cannot gain a new teamadmin. Demoting remains possible.
      disabled: !isLead && teamDisabled,
      onSelect: () => onSetRole(uid, isLead ? "member" : "teamadmin"),
    },
    {
      key: "remove",
      label: copy.removeFromTeamButton,
      destructive: true,
      onSelect: () => onRequestRemoval(uid),
    },
  ];

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <InitialsAvatar name={member.displayName ?? ""} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-words font-medium text-text-primary">{name}</span>
            <StatusBadge tone={isLead ? "info" : "neutral"}>{isLead ? copy.leadBadge : copy.memberBadge}</StatusBadge>
          </div>
          {member.email !== null && <p className="break-all text-sm text-text-secondary">{member.email}</p>}
          {isLead && teamDisabled && <p className="text-sm text-text-muted">{copy.leadMarkerDormant}</p>}
          {pendingLabel !== null && (
            <p role="status" className="text-sm text-text-secondary">
              {pendingLabel}
            </p>
          )}
          {action.status === "error" && (
            <Alert variant="error" className="mt-1 text-sm">
              {action.message}
            </Alert>
          )}
        </div>
      </div>

      {confirming ? (
        <div className="flex flex-col gap-2 sm:items-end">
          <p className="text-sm font-medium text-text-primary">{copy.removeConfirm(name)}</p>
          <div className="flex flex-wrap gap-2">
            <Button ref={cancelRef} variant="secondary" size="sm" onClick={() => onCancelRemoval(uid)}>
              {copy.cancelRemoval}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => onConfirmRemoval(uid)}>
              {copy.removeFromTeamButton}
            </Button>
          </div>
        </div>
      ) : (
        <div className="self-end sm:self-center">
          <ActionsMenu
            label={copy.moreActionsFor(name)}
            title={copy.moreActions}
            items={items}
            disabled={pending}
          />
        </div>
      )}
    </li>
  );
}
