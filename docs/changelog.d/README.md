# CHANGELOG Fragment Directory

This directory holds **changelog fragment files** — one per pull request or issue.
Fragments eliminate merge conflicts on `docs/CHANGELOG.md` by letting each PR deposit
its own file here instead of editing the shared changelog directly. The compile script
consolidates all fragments into `CHANGELOG.md` during the `/pm sweep`.

---

## Naming Convention

Name each fragment file after the issue or PR number it describes:

```
<issue-number>.md
<issue-number>-<pr-number>.md
```

**Examples:**
```
369.md
369-370.md
```

Only `.md` files are treated as fragments. `.keep` and `README.md` (this file)
are ignored by the compile script.

---

## Fragment File Format

A fragment contains one or more section headers from the canonical list, each
followed by one or more Markdown bullet points. Sections must appear in the
canonical order listed below if multiple sections are included.

**Canonical section order:**

1. `### Added`
2. `### Changed`
3. `### Deprecated`
4. `### Removed`
5. `### Fixed`
6. `### Security`

**Example fragment (`369.md`):**

```markdown
### Added

- Changelog fragment infrastructure: `scripts/compile_changelog.sh` consolidates
  fragments from `docs/changelog.d/` into `docs/CHANGELOG.md`.
- `docs/changelog.d/README.md` documents the fragment naming and format.

### Changed

- Changelog is now maintained via fragments instead of direct edits.
```

**Rules for authors:**

- At least one section header is required. Empty fragments cause the compile script
  to exit non-zero.
- Bullets must start with `- ` (hyphen + space). Multi-line bullets may continue on
  the next line with a leading space (standard Markdown continuation).
- Do not add a `## YYYY-MM-DD` date heading — the compile script inserts that.
- Section headers must be exactly `### Added`, `### Changed`, `### Deprecated`,
  `### Removed`, `### Fixed`, or `### Security`. Any other `###` header causes the
  compile script to exit non-zero and name the offending file and header.
- Sections must appear in the canonical order shown above. The compile script does
  not enforce ordering within a fragment (it re-sorts into canonical order during
  consolidation), but keeping your fragment in order makes diffs easier to read.

---

## How Compilation Works

Run `bash scripts/compile_changelog.sh` to consolidate all fragments into
`docs/CHANGELOG.md`:

1. If no fragment files exist (only `.keep` and `README.md`), the script exits 0
   without any modification.
2. All fragment files are parsed and their bullets are grouped by section header.
3. Bullets are written into `docs/CHANGELOG.md` under a `## YYYY-MM-DD` dated block
   (today's date). If a block for today already exists, bullets are merged into it.
4. Fragment files are deleted from `docs/changelog.d/`. `.keep` and `README.md`
   remain untouched.
5. All changes are staged via `git add docs/CHANGELOG.md docs/changelog.d/` — the
   script does **not** commit.

The script runs automatically during the `/pm sweep` before a release. You can
also run it manually at any time:

```bash
bash scripts/compile_changelog.sh
```
