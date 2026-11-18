import { resolveDemoSeedConfig, type DemoSeedConfig, type DemoSeedCredentials } from "../config";
import { runLocalCryptoPreflight, type DemoCrypto } from "../preflight";
import { membershipDocId } from "../../teams/domain/team-membership";
import { DEMO_MEMBER_IDENTITIES } from "../identities/fixtures";
import { verifyTargetTeam } from "../identities/plan";
import { DEMO_FORUM_THREADS, buildForumReplyDocument, buildForumThreadDocument, validateDemoForumThreads, type DemoForumThread } from "./fixtures";
import {
  authorMembershipOk,
  membershipRefPath,
  planForumProvisioning,
  type ForumProvisioningPlan,
} from "./plan";
import type { ForumOnlineAdapters } from "./adapters";

/**
 * Runner for `pnpm seed:demo-team-forum` (Phase D). Same argv and env gates as the team seed (`resolveDemoSeedConfig`), then:
 *
 *   1. offline: validate the forum fixtures only (no network).
 *   2. online: read-only checks of the target team, the presenter's teamadmin membership, every fixture author's live
 *      membership, and every fixture thread and reply document. Nothing is written.
 *   3. any conflict or unreadable record aborts before a write; the plan is printed either way.
 *   4. write (only with `--write --confirm=<projectId>` and a conflict-free plan): ONE create-only batch of the records observed
 *      absent. Firestore `create` fails the whole batch if any document exists, so there is no partial write. Nothing is
 *      updated, deleted or overwritten, and the presenter's records are read only.
 *
 * Authors are the fictional members only. Each record is a thread or a reply, authored and attributed exactly as the forum
 * persists them. No consent, assessment, membership or Auth record is written by this flow.
 */

export interface ForumRunnerInput {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  crypto: DemoCrypto;
  createOnlineAdapters: (target: { projectId: string; credentials: DemoSeedCredentials }) => Promise<ForumOnlineAdapters>;
  threads?: readonly DemoForumThread[];
}

export interface ForumRunnerOutput {
  exitCode: 0 | 1 | 2;
  stdout: string[];
  stderr: string[];
}

function abort(stdout: string[], category: string): ForumRunnerOutput {
  return { exitCode: 1, stdout, stderr: [`Aborted: ${category} (nothing further was written)`] };
}

function formatCounts(plan: ForumProvisioningPlan): string[] {
  const threads = plan.items.filter((item) => item.kind === "thread");
  const replies = plan.items.filter((item) => item.kind === "reply");
  const tally = (items: typeof plan.items) => {
    const out = { create: 0, skip: 0, conflict: 0 };
    for (const item of items) out[item.decision.action] += 1;
    return out;
  };
  const t = tally(threads);
  const r = tally(replies);
  return [
    `forumThreads: create ${t.create}, skip ${t.skip}, conflict ${t.conflict}`,
    `forumReplies: create ${r.create}, skip ${r.skip}, conflict ${r.conflict}`,
  ];
}

function conflictLines(plan: ForumProvisioningPlan): string[] {
  return plan.items
    .filter((item) => item.decision.action === "conflict")
    .map((item) => `Conflict: ${item.path} (${item.decision.reason ?? "unknown"})`);
}

export async function runForumProvisioning(input: ForumRunnerInput): Promise<ForumRunnerOutput> {
  const resolved = resolveDemoSeedConfig({ argv: input.argv, env: input.env, now: input.now });
  if (!resolved.ok) {
    const { category, subject } = resolved.error;
    return {
      exitCode: 2,
      stdout: [],
      stderr: [`Configuration error: ${category}${subject === undefined ? "" : ` (${subject})`}`],
    };
  }
  const config: DemoSeedConfig = resolved.config;
  const threads = input.threads ?? DEMO_FORUM_THREADS;

  const problems = validateDemoForumThreads(threads, config.asOf, config.presenterUid);
  if (problems.length > 0) return abort([], "fixtures-invalid");
  if (!runLocalCryptoPreflight(input.crypto)) return abort([], "crypto-failed");

  const replyCount = threads.reduce((sum, thread) => sum + thread.replies.length, 0);
  const header = [
    `Project: ${config.projectId} (verified against FIREBASE_PROJECT_ID)`,
    `Team: ${config.teamId}`,
    `Forum fixtures: ${threads.length} threads, ${replyCount} replies (fixtures valid)`,
  ];

  if (config.mode === "offline-dry-run") {
    return {
      exitCode: 0,
      stdout: [...header, "Mode: offline (no network, no reads, no writes). Run with the live flags for a read-only preflight."],
      stderr: [],
    };
  }

  if (config.credentials === null) return abort([], "adapters-missing");
  let adapters: ForumOnlineAdapters;
  try {
    adapters = await input.createOnlineAdapters({ projectId: config.projectId, credentials: config.credentials });
  } catch {
    return abort([], "adapters-failed");
  }

  // Target team and presenter (read-only). The presenter must already be the team's teamadmin.
  let verified;
  try {
    const team = await adapters.readDoc(`teams/${config.teamId}`);
    const presenterMembership = await adapters.readDoc(`teamMemberships/${membershipDocId(config.presenterUid, config.teamId)}`);
    verified = verifyTargetTeam({
      teamId: config.teamId,
      presenterUid: config.presenterUid,
      teamExists: team.exists,
      presenterMembershipRaw: presenterMembership.exists ? presenterMembership.data : undefined,
    });
  } catch {
    return abort(header, "preflight-failed");
  }
  if (!verified.ok) return abort(header, verified.reason);

  // Every fixture author must hold a live ordinary membership of the target team (read-only).
  const authorUids = [...new Set(threads.flatMap((thread) => [thread.authorUid, ...thread.replies.map((r) => r.authorUid)]))];
  const knownMembers = new Set(DEMO_MEMBER_IDENTITIES.map((identity) => identity.uid));
  if (authorUids.some((uid) => !knownMembers.has(uid))) return abort(header, "author-not-fictional-member");
  try {
    for (const uid of authorUids) {
      const membership = await adapters.readDoc(membershipRefPath(uid, config.teamId));
      if (!membership.exists || !authorMembershipOk(membership.data, uid, config.teamId)) {
        return abort(header, "author-membership-missing");
      }
    }
  } catch {
    return abort(header, "preflight-failed");
  }

  // Observe every fixture thread and reply (read-only). An unreadable document aborts the whole run.
  const observed: { threads: Map<string, unknown>; replies: Map<string, unknown> } = { threads: new Map(), replies: new Map() };
  try {
    for (const thread of threads) {
      const doc = await adapters.readDoc(`forumThreads/${thread.threadId}`);
      observed.threads.set(thread.threadId, doc.exists ? doc.data : undefined);
      for (const reply of thread.replies) {
        const replyDoc = await adapters.readDoc(`forumReplies/${reply.replyId}`);
        observed.replies.set(reply.replyId, replyDoc.exists ? replyDoc.data : undefined);
      }
    }
  } catch {
    return abort(header, "preflight-failed");
  }

  const open = (envelope: Parameters<DemoCrypto["openRecord"]>[0], context: string): string | null => {
    try {
      return input.crypto.openRecord(envelope, context);
    } catch {
      return null;
    }
  };
  const plan = planForumProvisioning({
    threads,
    teamId: config.teamId,
    observed,
    seal: input.crypto.sealRecord,
    open,
  });

  const lines = [...header, ...formatCounts(plan)];
  if (!plan.noConflicts) return abort([...lines, ...conflictLines(plan)], "conflicts-found");
  if (config.mode !== "write") {
    return { exitCode: 0, stdout: [...lines, "Dry run: nothing written."], stderr: [] };
  }
  if (!config.writesAllowed) return abort(lines, "write-gate-not-satisfied");

  const toCreate = plan.items.filter((item) => item.decision.action === "create");
  if (toCreate.length === 0) {
    return { exitCode: 0, stdout: [...lines, "Write: nothing to write; every forum fixture already matches."], stderr: [] };
  }

  try {
    const batch = adapters.createBatch();
    for (const thread of threads) {
      if (toCreate.some((item) => item.path === `forumThreads/${thread.threadId}`)) {
        batch.create(`forumThreads/${thread.threadId}`, buildForumThreadDocument(thread, config.teamId, input.crypto.sealRecord));
      }
      for (const reply of thread.replies) {
        const path = `forumReplies/${reply.replyId}`;
        if (toCreate.some((item) => item.path === path)) {
          batch.create(path, buildForumReplyDocument(reply, thread, config.teamId, input.crypto.sealRecord));
        }
      }
    }
    await batch.commit();
  } catch {
    return abort([...lines, "Write: the batch failed and wrote nothing. Rerun the same command to resume."], "forum-write-failed");
  }

  return {
    exitCode: 0,
    stdout: [...lines, `Write: created ${toCreate.length} forum documents in one create-only batch. Updates: 0. Deletes: 0`],
    stderr: [],
  };
}
