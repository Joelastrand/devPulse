"use client";

import type { FormEvent, ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import type {
  AdminPendingAccessRequestEntry,
  AdminPendingInvitationEntry,
} from "../client/admin-team-detail-gateway";
import { adminCopy } from "../copy";

/** Invite form state. `saved` is set only after the server confirms the invitation. */
export type InviteFormState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "saved" }
  | { status: "error"; message: string };

/** Per-row state for a pending invitation's cancel action. */
export type RowActionState = { status: "idle" } | { status: "pending" } | { status: "error"; message: string };

/** Per-row state for an access request. `action` says which button is in flight, so only that button is relabelled. */
export type RequestActionState =
  | { status: "idle" }
  | { status: "pending"; action: "approve" | "reject" }
  | { status: "error"; message: string };

export interface TeamInvitationsPanelProps {
  email: string;
  onEmailChange: (value: string) => void;
  inviteState: InviteFormState;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  invitations: readonly AdminPendingInvitationEntry[];
  invitationActions: Readonly<Record<string, RowActionState>>;
  onCancelInvitation: (email: string) => void;
  requests: readonly AdminPendingAccessRequestEntry[];
  requestActions: Readonly<Record<string, RequestActionState>>;
  onResolveRequest: (uid: string, status: "approved" | "rejected") => void;
}

/**
 * Invitations tab body. Three separate workflows share one layout and keep their own logic: the invite form, pending
 * invitations (cancel only) and pending access requests (approve or reject). An access request is not an invitation,
 * and opening a row never approves it. Dates come from the already-loaded `createdAt` values. Anything missing is omitted,
 * never invented. Invitation tokens and links are not part of these entries and are not shown.
 */
export function TeamInvitationsPanel({
  email,
  onEmailChange,
  inviteState,
  onInvite,
  invitations,
  invitationActions,
  onCancelInvitation,
  requests,
  requestActions,
  onResolveRequest,
}: TeamInvitationsPanelProps) {
  const copy = adminCopy.detail;
  const inviting = inviteState.status === "pending";

  return (
    <div className="flex flex-col gap-6">
      <section id="admin-section-invite" aria-labelledby="admin-section-invite-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="admin-section-invite-heading" className="text-lg font-semibold text-text-primary">
            {copy.inviteTabTitle}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">{copy.inviteTabDescription}</p>
        </div>

        <dl className="flex flex-wrap gap-2">
          <Stat label={copy.pendingInvitationsStat} value={invitations.length} />
          <Stat label={copy.pendingRequestsStat} value={requests.length} />
        </dl>

        <div className="rounded-surface border border-border-subtle bg-surface p-4 shadow-card">
          <h3 className="text-base font-semibold text-text-primary">{copy.inviteSectionTitle}</h3>
          <p className="mt-1 text-sm text-text-secondary">{copy.inviteSectionDescription}</p>
          <form onSubmit={onInvite} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full min-w-0 sm:max-w-md sm:flex-1">
              <TextField
                id="admin-invite-email"
                label={copy.emailLabel}
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                error={inviteState.status === "error" ? inviteState.message : undefined}
              />
            </div>
            <Button type="submit" className="shrink-0" pending={inviting}>
              {inviting ? copy.invitingButton : copy.inviteButton}
            </Button>
          </form>
          {inviteState.status === "saved" && (
            <p role="status" className="mt-3 text-sm text-text-secondary">
              {copy.inviteSuccess}
            </p>
          )}
        </div>
      </section>

      <section id="admin-section-invitations" aria-labelledby="admin-section-invitations-heading" className="flex flex-col gap-3">
        <h3 id="admin-section-invitations-heading" className="text-base font-semibold text-text-primary">
          {copy.invitationsSectionTitle}
        </h3>
        {invitations.length === 0 ? (
          <EmptyBox>{copy.noInvitations}</EmptyBox>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-surface border border-border-subtle bg-surface shadow-card">
            {invitations.map((invitation) => {
              const action = invitationActions[invitation.email] ?? { status: "idle" as const };
              const pending = action.status === "pending";
              const sent = formatDate(invitation.createdAt);
              return (
                <li
                  key={invitation.email}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <p className="break-all font-medium text-text-primary">{invitation.email}</p>
                    {sent !== null && <p className="text-sm text-text-secondary">{copy.sentOn(sent)}</p>}
                    {action.status === "error" && (
                      <Alert variant="error" className="mt-1 text-sm">
                        {action.message}
                      </Alert>
                    )}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="shrink-0 self-start sm:self-center"
                    pending={pending}
                    onClick={() => onCancelInvitation(invitation.email)}
                  >
                    {pending ? copy.cancelingButton : copy.cancelInvitationButton}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section id="admin-section-requests" aria-labelledby="admin-section-requests-heading" className="flex flex-col gap-3">
        <h3 id="admin-section-requests-heading" className="text-base font-semibold text-text-primary">
          {copy.requestsSectionTitle}
        </h3>
        {requests.length === 0 ? (
          <EmptyBox>{copy.noRequests}</EmptyBox>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-surface border border-border-subtle bg-surface shadow-card">
            {requests.map((request) => {
              const action = requestActions[request.uid] ?? { status: "idle" as const };
              const isPending = action.status === "pending";
              // Only the clicked button shows a pending label. The other is disabled but never relabelled.
              const isApprovePending = action.status === "pending" && action.action === "approve";
              const isRejectPending = action.status === "pending" && action.action === "reject";
              const requested = formatDate(request.createdAt);
              return (
                <li
                  key={request.uid}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <p className="break-all font-medium text-text-primary">
                      {request.email ?? copy.requestAddressMissing}
                    </p>
                    {requested !== null && <p className="text-sm text-text-secondary">{copy.requestedOn(requested)}</p>}
                    {action.status === "error" && (
                      <Alert variant="error" className="mt-1 text-sm">
                        {action.message}
                      </Alert>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-center">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isPending}
                      pending={isRejectPending}
                      onClick={() => onResolveRequest(request.uid, "rejected")}
                    >
                      {isRejectPending ? copy.rejectingButton : copy.rejectButton}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={isPending}
                      pending={isApprovePending}
                      onClick={() => onResolveRequest(request.uid, "approved")}
                    >
                      {isApprovePending ? copy.approvingButton : copy.approveButton}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2 rounded-control border border-border-subtle bg-surface px-3 py-1.5">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className="text-base font-semibold tabular-nums text-text-primary">{value}</dd>
    </div>
  );
}

function EmptyBox({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-surface border border-border-subtle bg-surface px-4 py-4 text-sm text-text-secondary">{children}</p>
  );
}
