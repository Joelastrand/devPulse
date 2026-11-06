
import { issueErasureOwnerCleanupCapability } from "../../development-conversations/server/erasure-owner-cleanup-capability";
import "server-only";
import { getDefaultConversationStore } from "../../development-conversations/server/conversation-store";
import { decryptForClassification, encodeContent, probeKey } from "../../development-conversations/server/content-codec";
import type { ErasureStep } from "../domain/erasure-state";
import { createActorAuditStepHandler } from "./actor-audit-erasure";
import { createOwnedConversationsStepHandler, createLocatorsStepHandler } from "./conversations-erasure";
import { createForumStepHandler } from "./forum-erasure";
import { createInvitationsStepHandler } from "./invitations-erasure";
import { createMembershipStepHandler } from "./membership-erasure";
import { createParticipantBindingsStepHandler } from "./participant-bindings-erasure";
import { createPersonalDataStepHandler } from "./personal-data-erasure";
import { createSuperadminRecordStepHandler } from "./superadmin-record-erasure";
import { createSurveyParticipationsStepHandler } from "./survey-participations-erasure";
import { createVerifyHandler } from "./verification-sweep";
import { createSweepCounter } from "./erasure-adapters-sweep";
import { createActorAuditPort, createPersonalDataPort, createSurveyParticipationsPort } from "./erasure-adapters";
import { createForumPort } from "./erasure-adapters-forum";
import { createInvitationsPort, createMembershipPort } from "./erasure-adapters-team";
import { createParticipantBindingDiscovery } from "./erasure-adapters-conversations";
import type { BatchResult, StepHandler } from "./erasure-runner";

/**
 * The production handler graph for the erasure runner (TASK-038). It is built per request from the verified identity, so the
 * normalized e-mail used for invitation matching comes only from the authenticated start/resume request (approved decision).
 *
 * Step order (SPEC "Steps", fixed by ERASURE_STEPS): forum, memberships, conversations_owned, participant_bindings, locators,
 * personal_data, survey_participations, actor_audit, verify_data, auth_delete, final_sweep. The runner registers handlers for
 * the first eight, plus verify_data. auth_delete and final_sweep run after the runner's handoff (auth-deletion.ts).
 *
 * The `memberships` step is one step with two handlers in a fixed phase order: membership removal first (it nulls each
 * roadmap ownerRef while the memberRef still exists), then invitations and access requests (I-10, I-11). The phase advances
 * only after the membership handler reports `done`, so invitation cleanup never runs before the membership cleanup finished.
 */

export interface ErasureIdentity {
  readonly uid: string;
  /** The normalized e-mail of the verified caller. Non-empty by the caller's precondition (see start-erasure.ts). */
  readonly normalizedEmail: string;
}

type Handlers = Partial<Record<ErasureStep, StepHandler>>;

/** Runs `first` until it reports done, then `second`. Used only by the runner; the phase lives per request. */
function phased(first: StepHandler, second: StepHandler): StepHandler {
  let inSecond = false;
  return {
    async runBatch(input): Promise<BatchResult> {
      if (inSecond) return second.runBatch(input);
      const result = await first.runBatch(input);
      if (result === "more") return "more";
      // The first phase is complete. The second phase starts on the next batch, so each runner batch does one unit of work.
      inSecond = true;
      return "more";
    },
  };
}

/** Runs both handlers once per call. Used only by the verify_data cleanup, which needs every residual cleaned in one pass. */
function both(first: StepHandler, second: StepHandler): StepHandler {
  return {
    async runBatch(input): Promise<BatchResult> {
      await first.runBatch(input);
      await second.runBatch(input);
      return "more";
    },
  };
}

export function buildProductionStepHandlers(identity: ErasureIdentity, now: () => Date): Handlers {
  const store = getDefaultConversationStore();
  const forum = createForumStepHandler({ port: createForumPort(), now });
  const membership = createMembershipStepHandler({ port: createMembershipPort() });
  const invitations = createInvitationsStepHandler({
    port: createInvitationsPort(),
    normalizedEmailOf: async () => identity.normalizedEmail,
  });
  const ownedConversations = createOwnedConversationsStepHandler({ store });
  const bindings = createParticipantBindingsStepHandler({
    store,
    codec: { probeKey, decryptForClassification, encodeContent },
    discovery: createParticipantBindingDiscovery(),
    clock: now,
    cleanupCapability: issueErasureOwnerCleanupCapability(),
  });
  const locators = createLocatorsStepHandler({ store });
  const personalData = createPersonalDataStepHandler({ port: createPersonalDataPort() });
  const superadminRecord = createSuperadminRecordStepHandler();
  const personalDataWithRegistry = phased(personalData, superadminRecord);
  const personalDataCleanup = both(personalData, superadminRecord);
  const surveyParticipations = createSurveyParticipationsStepHandler({ port: createSurveyParticipationsPort() });
  const actorAudit = createActorAuditStepHandler({ port: createActorAuditPort() });

  const membershipsPhased = phased(membership, invitations);
  const membershipsCleanup = both(membership, invitations);

  const handlers: Handlers = {
    forum,
    memberships: membershipsPhased,
    conversations_owned: ownedConversations,
    participant_bindings: bindings,
    locators,
    personal_data: personalDataWithRegistry,
    survey_participations: surveyParticipations,
    actor_audit: actorAudit,
  };

  // verify_data: a residual for a step is cleaned by that step's cleanup. Each cleanup is stateless (it runs every
  // sub-handler it owns), so a residual is never stranded behind a phase that already advanced.
  handlers.verify_data = createVerifyHandler({
    counter: createSweepCounter(),
    normalizedEmailFor: () => identity.normalizedEmail,
    cleanups: {
      forum,
      memberships: membershipsCleanup,
      conversations_owned: ownedConversations,
      participant_bindings: bindings,
      locators,
      personal_data: personalDataCleanup,
      survey_participations: surveyParticipations,
      actor_audit: actorAudit,
    },
  });
  return handlers;
}

