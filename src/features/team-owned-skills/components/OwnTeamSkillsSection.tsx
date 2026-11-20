"use client";

import { useRef, useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamsOverview } from "../../teams/client/teams-overview-gateway";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingRegion, Skeleton } from "../../../components/ui/Skeleton";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import { teamSkillsCopy } from "../copy";
import type { TeamSkillLevel } from "../domain/team-skill";
import {
  clearOwnTeamSkillRating,
  fetchTeamSkills,
  setOwnTeamSkillRating,
  type OwnTeamSkillRating,
  type TeamSkillsListResult,
  type TeamSkillView,
} from "../client/team-skills-gateway";
import { TeamSkillRatingControl } from "./TeamSkillRatingControl";
import { assessmentPercent, groupTeamSkillsByCategory } from "./team-skill-groups";
import { matchesSearchQuery } from "../../../components/ui/search-match";
import { SearchField } from "../../../components/ui/SearchField";
import { LevelLegend } from "../../skill-profiles/components/LevelLegend";

type Filter = "all" | "assessed" | "notAssessed";

interface TeamBlock {
  teamId: string;
  name: string;
  list: TeamSkillsListResult;
  /** Set when the last rating action for this team failed; shown next to the team, never silently dropped. */
  error: string | null;
}

function ratingFor(list: Extract<TeamSkillsListResult, { status: "ok" }>, skillId: string): OwnTeamSkillRating | undefined {
  return list.own.find((rating) => rating.skillId === skillId);
}

/**
 * The personal assessment of team-owned skills, grouped by team (docs/archive/features/team-owned-skills/SPEC.md §8). Team names
 * come from the existing membership overview; only teams the person belongs to are shown. Ratings are written per skill
 * through the server, and the list is reloaded after each change so the stored state is what is shown.
 */
export function OwnTeamSkillsSection() {
  const [blocks, setBlocks] = useState<TeamBlock[] | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  /** Rating keys (`teamId:skillId`) with a write in flight. Mirrored in a ref so a repeat click is blocked before re-render. */
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef(new Set<string>());
  /** The current identity and its generation. Every late result is checked against the generation it was started under. */
  const current = useRef<{ token: string | null; generation: number; isCurrent: (generation: number) => boolean }>({
    token: null,
    generation: 0,
    isCurrent: () => false,
  });

  useAuthGatedResource((nextToken, generation, isCurrentGeneration) => {
    current.current = { token: nextToken, generation, isCurrent: isCurrentGeneration };
    // A new auth state drops every in-flight rating and the previous identity's blocks.
    pendingRef.current = new Set();
    setPendingKeys(new Set());
    setBlocks(null);
    setOverviewFailed(false);
    if (nextToken === null) {
      setBlocks([]);
      return;
    }
    void (async () => {
      const overview = await fetchTeamsOverview(nextToken);
      if (!isCurrentGeneration(generation)) return;
      if (overview.status !== "ok") {
        setOverviewFailed(true);
        setBlocks([]);
        return;
      }
      const member = overview.teams.filter((team) => team.isMember);
      const loaded = await Promise.all(
        member.map(async (team): Promise<TeamBlock> => ({
          teamId: team.teamId,
          name: team.name,
          list: await fetchTeamSkills(nextToken, team.teamId),
          error: null,
        })),
      );
      if (!isCurrentGeneration(generation)) return;
      setBlocks(loaded);
    })();
  }, []);

  /** Re-reads one team with the identity that is current when called. A result from a superseded generation is dropped. */
  async function reloadTeam(teamId: string, error: string | null) {
    const { token, generation, isCurrent } = current.current;
    if (token === null) return;
    const list = await fetchTeamSkills(token, teamId);
    if (!isCurrent(generation)) return;
    setBlocks((existing) => existing?.map((block) => (block.teamId === teamId ? { ...block, list, error } : block)) ?? null);
  }

  async function rate(teamId: string, skillId: string, level: TeamSkillLevel | null) {
    const key = `${teamId}:${skillId}`;
    const { token, generation, isCurrent } = current.current;
    if (token === null || pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    setPendingKeys(new Set(pendingRef.current));
    try {
      const outcome =
        level === null
          ? await clearOwnTeamSkillRating(token, teamId, skillId)
          : await setOwnTeamSkillRating(token, teamId, skillId, level);
      if (!isCurrent(generation)) {
        // The auth state changed mid-write: no success or failure is shown; the team is re-read for the current identity.
        await reloadTeam(teamId, null);
        return;
      }
      if (outcome.status === "ok") {
        await reloadTeam(teamId, null);
        return;
      }
      const message = (teamSkillsCopy.errors as Record<string, string>)[outcome.status] ?? teamSkillsCopy.errors.write_failed;
      await reloadTeam(teamId, message);
    } finally {
      pendingRef.current.delete(key);
      setPendingKeys(new Set(pendingRef.current));
    }
  }

  if (blocks === null) return <OwnTeamSkillsSkeleton label={teamSkillsCopy.loading} />;
  if (overviewFailed) return <Alert variant="error">{teamSkillsCopy.errors.read_failed}</Alert>;
  if (blocks.length === 0) return <EmptyState>{teamSkillsCopy.own.emptyTeam}</EmptyState>;

  // Every team block owns its search, filter and category state, so one team's controls never change another team.
  return (
    <div className="flex flex-col gap-6">
      {blocks.map((block) => (
        <TeamBlockView
          key={block.teamId}
          block={block}
          pendingKeys={pendingKeys}
          onRate={(skillId, level) => void rate(block.teamId, skillId, level)}
        />
      ))}
    </div>
  );
}

/**
 * Assessment-status filter of one team block. Its name names the team, so a screen reader hears which team it changes.
 * `aria-pressed` on each option carries the selected state, not colour alone.
 */
function StatusFilter({ label, value, onChange }: { label: string; value: Filter; onChange: (next: Filter) => void }) {
  const options: Array<{ key: Filter; label: string }> = [
    { key: "all", label: teamSkillsCopy.own.filterAll },
    { key: "assessed", label: teamSkillsCopy.own.filterAssessed },
    { key: "notAssessed", label: teamSkillsCopy.own.filterNotAssessed },
  ];
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={
            "min-h-9 rounded-full border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary " +
            (value === option.key ? "border-primary bg-primary text-primary-text" : "border-border-strong bg-surface text-text-primary")
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Placeholder with the final layout: heading, filter row, one team card with skill rows. Decorative; the region announces once. */
function OwnTeamSkillsSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-4">
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="flex flex-col gap-3 rounded-surface border border-border-subtle bg-surface p-4">
          <Skeleton className="h-5 w-1/4" />
          <ul className="flex flex-col divide-y divide-border-subtle">
            {[0, 1, 2].map((index) => (
              <li key={index} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-8 w-48 md:shrink-0" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </LoadingRegion>
  );
}

function TeamBlockView({
  block,
  pendingKeys,
  onRate,
}: {
  block: TeamBlock;
  pendingKeys: ReadonlySet<string>;
  onRate: (skillId: string, level: TeamSkillLevel | null) => void;
}) {
  const heading = teamSkillsCopy.own.teamHeading(block.name);
  if (block.list.status !== "ok") {
    return (
      <Card as="section" padding="sm" variant="bordered" aria-label={heading} className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-text-primary">{heading}</h3>
        <Alert variant="error">{(teamSkillsCopy.errors as Record<string, string>)[block.list.status] ?? teamSkillsCopy.errors.read_failed}</Alert>
      </Card>
    );
  }
  return <LoadedTeamBlock block={block} list={block.list} pendingKeys={pendingKeys} onRate={onRate} heading={heading} />;
}

/**
 * One team's workspace: its progress, search, status filter, level explanation and category groups. Every one of these is
 * local to the team, so the controls visibly apply to the team they sit in. Search and the category disclosures follow the
 * same rule as before: while a query is active, every category with a match is open, and clearing the query restores the
 * person's own open/closed choices, which searching never overwrites.
 */
function LoadedTeamBlock({
  block,
  list,
  pendingKeys,
  onRate,
  heading,
}: {
  block: TeamBlock;
  list: Extract<TeamSkillsListResult, { status: "ok" }>;
  pendingKeys: ReadonlySet<string>;
  onRate: (skillId: string, level: TeamSkillLevel | null) => void;
  heading: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openCategories, setOpenCategories] = useState<ReadonlySet<string>>(() => new Set());
  const active = list.skills.filter((skill) => skill.active);
  const inactive = list.skills.filter((skill) => !skill.active);
  const assessed = active.filter((skill) => ratingFor(list, skill.skillId) !== undefined).length;
  const searching = query.trim().length > 0;
  const categoryKeys = groupTeamSkillsByCategory(active).map((group) => group.category ?? "");
  const percent = assessmentPercent(assessed, active.length);
  const controlsId = `team-${block.teamId}-category-controls-note`;

  const groups = groupTeamSkillsByCategory(active).flatMap((group) => {
    const items = group.items.filter((skill) => {
      const rated = ratingFor(list, skill.skillId) !== undefined;
      const statusOk = filter === "all" || (filter === "assessed" ? rated : !rated);
      return statusOk && matchesSearchQuery(query, [skill.name]);
    });
    // "" is the state key of the uncategorized group; no real category can be empty (see team-skill-groups.ts).
    const key = group.category ?? "";
    const label = group.category ?? teamSkillsCopy.own.uncategorized;
    return items.length === 0 ? [] : [{ key, label, items }];
  });
  const shownCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const categoryIsOpen = (key: string) => (searching ? true : openCategories.has(key));

  function toggleCategory(key: string) {
    setOpenCategories((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Opens or closes every category of this team. Only the team's own categories are touched. */
  function setAllCategories(open: boolean) {
    setOpenCategories(open ? new Set(categoryKeys) : new Set());
  }

  return (
    <Card as="section" padding="sm" variant="bordered" aria-label={heading} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-text-primary">{heading}</h3>
        <p className="text-sm text-text-secondary">{teamSkillsCopy.own.teamCounts(active.length, assessed)}</p>
        {active.length > 0 ? (
          <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-border-subtle">
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </div>
      {block.error ? <Alert variant="error">{block.error}</Alert> : null}
      {active.length === 0 ? <EmptyState>{teamSkillsCopy.own.emptyTeam}</EmptyState> : null}
      {active.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <SearchField
              id={`team-skill-search-${block.teamId}`}
              label={teamSkillsCopy.own.searchLabel(block.name)}
              placeholder={teamSkillsCopy.own.searchPlaceholder}
              value={query}
              onChange={setQuery}
              clearLabel={teamSkillsCopy.own.searchClear}
            />
            <p className="text-xs text-text-secondary">
              {teamSkillsCopy.own.resultCount(shownCount, active.length)}
            </p>
          </div>
          <StatusFilter label={teamSkillsCopy.own.filterLegendForTeam(block.name)} value={filter} onChange={setFilter} />
          <LevelLegend />
          <div role="group" aria-label={teamSkillsCopy.own.categoryGroupLabel(block.name)} className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="tertiary" size="sm" disabled={searching} aria-describedby={searching ? controlsId : undefined} onClick={() => setAllCategories(true)}>
              {teamSkillsCopy.own.showAllCategories}
            </Button>
            <Button type="button" variant="tertiary" size="sm" disabled={searching} aria-describedby={searching ? controlsId : undefined} onClick={() => setAllCategories(false)}>
              {teamSkillsCopy.own.hideAllCategories}
            </Button>
            {searching ? (
              <p id={controlsId} className="text-xs text-text-secondary">
                {teamSkillsCopy.own.categoryControlsSearchNote}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {active.length > 0 && groups.length === 0 ? (
        <p className="text-sm text-text-secondary">{teamSkillsCopy.own.noSearchMatches}</p>
      ) : null}
      <div className="flex flex-col gap-2">
        {groups.map((group, index) => {
          const groupAssessed = group.items.filter((skill) => ratingFor(list, skill.skillId) !== undefined).length;
          const open = categoryIsOpen(group.key);
          // Index-based DOM id: category names can contain spaces or characters that are not valid in an id.
          const panelId = `team-${block.teamId}-category-${index}`;
          return (
            <div key={group.key} className="rounded-md border border-border-subtle">
              <h4 className="m-0">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggleCategory(group.key)}
                  className="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="text-sm font-semibold text-text-primary">{group.label}</span>
                  <span className="text-xs text-text-secondary">
                    {teamSkillsCopy.own.categoryCounts(group.items.length, groupAssessed)}
                  </span>
                </button>
              </h4>
              {open ? (
                <ul id={panelId} className="flex flex-col divide-y divide-border-subtle border-t border-border-subtle px-3">
                  {group.items.map((skill) => (
                    <SkillRatingRow
                      key={skill.skillId}
                      skill={skill}
                      rating={ratingFor(list, skill.skillId)}
                      pending={pendingKeys.has(`${block.teamId}:${skill.skillId}`)}
                      onRate={(level) => onRate(skill.skillId, level)}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
      {inactive.length > 0 ? (
        <details className="rounded-md border border-border-subtle p-3">
          <summary className="cursor-pointer text-sm font-medium text-text-primary">{teamSkillsCopy.own.inactiveHeading}</summary>
          <p className="mt-2 text-sm text-text-secondary">{teamSkillsCopy.own.inactiveDescription}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {inactive.map((skill) => {
              const rating = ratingFor(list, skill.skillId);
              return (
                <li key={skill.skillId} className="text-sm text-text-secondary">
                  {skill.name}: {rating ? `${rating.level}. ${SELF_ASSESSED_LEVEL_COPY[rating.level].name}` : teamSkillsCopy.own.notSet}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function SkillRatingRow({
  skill,
  rating,
  pending,
  onRate,
}: {
  skill: TeamSkillView;
  rating: OwnTeamSkillRating | undefined;
  /** True while this skill's write is in flight: only this row's controls are disabled. */
  pending: boolean;
  onRate: (level: TeamSkillLevel | null) => void;
}) {
  const guidanceLevels = ([1, 2, 3, 4] as const).flatMap((level) => {
    const text = skill.guidance[String(level) as "1" | "2" | "3" | "4"];
    return text === undefined ? [] : [{ level, text }];
  });
  return (
    <li className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium text-text-primary">
          {skill.name}
          {rating ? (
            <span className="ml-2 text-sm font-normal text-text-secondary">
              {teamSkillsCopy.own.levelShort(rating.level, SELF_ASSESSED_LEVEL_COPY[rating.level].name)}
            </span>
          ) : (
            <span className="ml-2 text-sm font-normal text-text-secondary">{teamSkillsCopy.own.notSet}</span>
          )}
        </p>
        {rating?.outdated ? <p className="text-xs font-medium text-text-primary">{teamSkillsCopy.own.outdated}</p> : null}
        {/* Shown only when the team wrote guidance for this competency; the shared level legend explains the scale. */}
        {guidanceLevels.length > 0 ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs font-medium text-text-secondary">{teamSkillsCopy.own.guidanceLabel}</summary>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-text-secondary">
              {guidanceLevels.map(({ level, text }) => (
                <li key={level}>
                  <span className="font-medium">
                    {level}. {SELF_ASSESSED_LEVEL_COPY[level].name}:
                  </span>{" "}
                  {text}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <TeamSkillRatingControl skillName={skill.name} value={rating?.level ?? null} disabled={pending} onSelect={(level) => onRate(level)} />
        {rating ? (
          <Button size="sm" variant="tertiary" disabled={pending} onClick={() => onRate(null)}>
            {teamSkillsCopy.own.clearButton}
          </Button>
        ) : null}
        {pending ? <span className="text-xs text-text-secondary">{teamSkillsCopy.savingButton}</span> : null}
      </div>
    </li>
  );
}
