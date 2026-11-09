"use client";

import { useId, useState } from "react";
import { SELF_ASSESSED_LEVELS, type SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { COLLABORATIVE_PANEL_COPY } from "../copy";
import { saveCollaborativeLevel, type CollaborativeWriteStatus } from "../client/collaborative-gateway";

export interface LevelEditorRow {
  readonly treeId: string;
  readonly label: string;
  readonly teamLevel: SelfAssessedLevel | null;
}

interface CollaborativeLevelEditorProps {
  readonly teamId: string;
  readonly token: string;
  readonly rows: readonly LevelEditorRow[];
  readonly onSaved: () => void;
}

/** Teamadmin entry of one integer 1–4 (or "not set") per active area. Each row saves on its own button. */
export function CollaborativeLevelEditor({ teamId, token, rows, onSaved }: CollaborativeLevelEditorProps) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold text-text-primary">{COLLABORATIVE_PANEL_COPY.levelsHeading}</h3>
        <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.levelsIntro}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <LevelEditorItem key={row.treeId} teamId={teamId} token={token} row={row} onSaved={onSaved} />
        ))}
      </ul>
    </div>
  );
}

function LevelEditorItem({
  teamId,
  token,
  row,
  onSaved,
}: {
  readonly teamId: string;
  readonly token: string;
  readonly row: LevelEditorRow;
  readonly onSaved: () => void;
}) {
  const selectId = useId();
  const [draft, setDraft] = useState<string>(row.teamLevel === null ? "" : String(row.teamLevel));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | CollaborativeWriteStatus>("idle");
  const dirty = draft !== (row.teamLevel === null ? "" : String(row.teamLevel));

  async function handleSave() {
    const level = draft === "" ? null : (Number(draft) as SelfAssessedLevel);
    setStatus("saving");
    const result = await saveCollaborativeLevel(token, teamId, row.treeId, level);
    if (result.status === "ok") {
      setStatus("saved");
      onSaved();
      return;
    }
    setStatus(result.status);
  }

  const failed = status !== "idle" && status !== "saving" && status !== "saved";

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
      <label htmlFor={selectId} className="font-medium text-text-primary">
        {row.label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={selectId}
          aria-label={COLLABORATIVE_PANEL_COPY.levelLabel(row.label)}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus("idle");
          }}
          disabled={status === "saving"}
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary"
        >
          <option value="">{COLLABORATIVE_PANEL_COPY.levelUnset}</option>
          {SELF_ASSESSED_LEVELS.map((level) => (
            <option key={level} value={String(level)}>
              {level}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || status === "saving"}
          className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-text-primary disabled:opacity-50"
        >
          {COLLABORATIVE_PANEL_COPY.levelSave}
        </button>
        {status === "saved" && !dirty ? (
          <span role="status" className="text-sm text-text-secondary">
            {COLLABORATIVE_PANEL_COPY.saved}
          </span>
        ) : null}
        {failed ? (
          <span role="alert" className="text-sm text-text-primary">
            {status === "conflict" ? COLLABORATIVE_PANEL_COPY.conflict : COLLABORATIVE_PANEL_COPY.saveFailed}
          </span>
        ) : null}
      </div>
    </li>
  );
}
