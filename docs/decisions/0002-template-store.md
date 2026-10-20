---
title: Store fill-in label templates on disk
status: accepted
supersedes: the "never write files" part of 0001's consequences and the CLAUDE.md rule
---

## Context

The user wants to recreate a label once (for example from a photo), save it, and reprint it later
with new values such as a batch number or an expiry date. They also want to edit a label they made
in NiimBlue. Until 1.1.0 the server wrote no files, and the link carried only `{dt}` fields.

## Decision

- `render_label` gains `rows`: values for `{key}` fields. With 1 row the server fills the text before
  it builds the link, so the user's open CSV in NiimBlue stays as it is. With more rows the link
  carries the rows as NiimBlue's own CSV (`csv.data`, d3-dsv format) and NiimBlue prints one label
  per row.
- `save_as` writes `<slug>.args.json` (the render args) and `<slug>.niimblue.json` (an export that
  NiimBlue's Saved labels can import) to `NIIMBLUE_TEMPLATES_DIR`, default
  `~/Documents/NiimBlue Templates`. An existing template is refused unless `overwrite: true`.
- The slug keeps Unicode letters, marks and digits and nothing else, so a name can't leave the folder.
  A name with no letter or digit is `BAD_INPUT`, not a shared fallback name.
- `list_templates` and `get_template` read the folder. `get_template` also converts a NiimBlue
  `.json` export to args. It refuses images, ArUco markers, paths and groups instead of dropping them,
  which keeps the page's no-external-load rule.

## Rationale

Saved args are the format the agent already writes, so reprinting a template is one `render_label`
call. The `.niimblue.json` beside it lets the user open the same template in NiimBlue without the
agent. Writing only on `save_as`, into one folder and never over a file without `overwrite`, keeps
the write surface small enough for an unattended agent.

## Consequences

- `render_label` is no longer read-only (`readOnlyHint: false`); `destructiveHint` stays false because
  overwriting is gated.
- With more than one row, opening the link replaces the CSV the user has open in NiimBlue. The skill
  tells the agent to say so.
- NiimBlue's `$times` column is not supported: each row prints once.
- Names that differ only in punctuation or case share a file (`Flour!` and `flour`). The second save
  is refused, so nothing is lost silently.
