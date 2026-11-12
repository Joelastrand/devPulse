# Team Survey Builder — Tasks

| ID | Task | State |
| --- | --- | --- |
| TSB-001 | Spec amendment and question-definition domain (types, validation, answer validation) | Done |
| TSB-002 | Built-in templates as editable copies (four Norwegian templates) | Done |
| TSB-003 | Persistence and compatibility: validated `questions` stored on new surveys; legacy surveys read as Team Pulse; versioned v2 payload; legacy payload unchanged | Done |
| TSB-004 | Creation from blank or template; duplication as an editable draft (admin-only) | Done |
| TSB-005 | Draft editing (title, description, dates, questions, options, required, order); frozen once opened | Done |
| TSB-006 | Workspace at `/teams/[teamId]/surveys`, grouped draft / open / closed / archived, with create, edit, duplicate, preview, open, close, archive, results | Done |
| TSB-007 | Respondent UI for all four question types, required-answer gating, free-text warning; participation modes and one-response-per-participant unchanged | Done |
| TSB-008 | Per-question statistics with per-question suppression; team results page section for closed configurable surveys | Done for per-question results and the team results section. Cross-version trend not implemented (out of scope). |
| TSB-009 | Scheduled opening | Decided: manual only (no automatic scheduling). `startAt` is informational. |
| TSB-010 | Free-text access: team membership, decided independently of app-admin status (SECURITY invariant 17). Members see text after the publication gate; a non-member app admin sees `restricted`. | Done (approved in session; see SPEC "Privacy contract for free text") |
| TSB-011 | Draft deletion: app admin, unpublished, never-opened drafts with zero responses; confirmation in the UI | Done |
| TSB-012 | Published metadata: title and description editable after publication; questions, dates, access mode and threshold stay frozen | Done |
