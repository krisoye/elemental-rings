#!/usr/bin/env bash
# compile_changelog.sh — consolidate docs/changelog.d/ fragment files into docs/CHANGELOG.md
#
# Usage: bash scripts/compile_changelog.sh
#
# Behavior:
#   1. If changelog.d/ has no fragment files (only .keep / README.md), exit 0 silently.
#   2. Parse all fragment .md files (except README.md), validate section headers.
#   3. Group bullets into the six canonical sections.
#   4. Merge grouped bullets into docs/CHANGELOG.md under today's ## YYYY-MM-DD block.
#      - If today's block exists: merge bullets into matching sections; add missing sections.
#      - If no today's block: insert one before the first dated ## YYYY-MM-DD heading,
#        preserving any ## [Unreleased] block above it.
#   5. Delete processed fragment files (not .keep / README.md).
#   6. Stage docs/CHANGELOG.md and docs/changelog.d/ via git add.
#
# Canonical section order: Added, Changed, Deprecated, Removed, Fixed, Security
# All other ### headers within fragments are rejected with a non-zero exit.
#
# Does NOT commit. Safe to run multiple times on an empty changelog.d/.
#
# Compatibility: POSIX awk (mawk, gawk, nawk). No gawk extensions used.

set -eu

# ---------------------------------------------------------------------------
# Paths — resolved relative to the repository root (parent of scripts/)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CHANGELOG_DIR="${REPO_ROOT}/docs/changelog.d"
CHANGELOG_FILE="${REPO_ROOT}/docs/CHANGELOG.md"

# ---------------------------------------------------------------------------
# Canonical section headers in order
# ---------------------------------------------------------------------------
SECTIONS="Added Changed Deprecated Removed Fixed Security"

# ---------------------------------------------------------------------------
# Helper: check whether a string is in the canonical list
# ---------------------------------------------------------------------------
is_canonical_section() {
    local header="$1"
    local sec
    for sec in $SECTIONS; do
        [ "$header" = "$sec" ] && return 0
    done
    return 1
}

# ---------------------------------------------------------------------------
# Step 1: Collect fragment files (*.md except README.md)
# ---------------------------------------------------------------------------
fragment_files=()
for f in "${CHANGELOG_DIR}"/*.md; do
    [ -e "$f" ] || continue
    basename_f="$(basename "$f")"
    [ "$basename_f" = "README.md" ] && continue
    fragment_files+=("$f")
done

if [ "${#fragment_files[@]}" -eq 0 ]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# Validate CHANGELOG.md exists and has the expected header
# ---------------------------------------------------------------------------
if [ ! -f "${CHANGELOG_FILE}" ]; then
    echo "ERROR: ${CHANGELOG_FILE} not found." >&2
    exit 1
fi

if ! grep -qi "^# changelog" "${CHANGELOG_FILE}"; then
    echo "ERROR: ${CHANGELOG_FILE} is missing the '# Changelog' header line." >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 2 & 3: Parse fragments, validate headers, collect bullets per section
# ---------------------------------------------------------------------------
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

for sec in $SECTIONS; do
    : > "${TMP_DIR}/sec_${sec}"
done

for frag in "${fragment_files[@]}"; do
    frag_name="$(basename "$frag")"

    # P1-3 fix: use POSIX character class [^[:space:]] instead of [^ \t]
    if [ ! -s "$frag" ] || ! grep -q '[^[:space:]]' "$frag"; then
        echo "ERROR: Fragment file '${frag_name}' is empty or contains only whitespace." >&2
        exit 1
    fi

    current_section=""
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            "### "*)
                header_word="${line#'### '}"
                if is_canonical_section "$header_word"; then
                    current_section="$header_word"
                else
                    echo "ERROR: Fragment '${frag_name}' contains invalid section header: '${line}'" >&2
                    exit 1
                fi
                ;;
            "")
                # Blank lines inside a section body are kept for readability
                [ -n "$current_section" ] && printf '\n' >> "${TMP_DIR}/sec_${current_section}"
                ;;
            *)
                if [ -n "$current_section" ]; then
                    printf '%s\n' "$line" >> "${TMP_DIR}/sec_${current_section}"
                fi
                ;;
        esac
    done < "$frag"
done

# Strip leading and trailing blank lines from each section file, then verify
# at least one section has real bullet content.
#
# The check must come AFTER trimming: a fragment containing only "### Added\n\n"
# (header + blank, no bullets) produces a section file of "\n" which is non-empty
# before trimming but empty after — so checking before trimming produces a false
# positive and exits 0 instead of the required non-zero.
has_content=0
for sec in $SECTIONS; do
    sec_file="${TMP_DIR}/sec_${sec}"
    if [ -s "$sec_file" ]; then
        awk '
            BEGIN { n = 0; last_nf = 0; started = 0 }
            !started && /^$/ { next }
            { started = 1; lines[++n] = $0; if (NF) last_nf = n }
            END { for (i = 1; i <= last_nf; i++) print lines[i] }
        ' "$sec_file" > "${TMP_DIR}/sec_${sec}_trimmed"
        mv "${TMP_DIR}/sec_${sec}_trimmed" "$sec_file"
    fi
    # After trimming, check whether this section has any real content
    [ -s "${TMP_DIR}/sec_${sec}" ] && has_content=1
done

if [ "$has_content" -eq 0 ]; then
    echo "ERROR: Fragment files exist but contain no valid section bullets." >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 4: Determine today's date
# ---------------------------------------------------------------------------
TODAY="$(date +%Y-%m-%d)"
DATED_HEADING="## ${TODAY}"

# ---------------------------------------------------------------------------
# Helper: emit all canonical sections that have new content, in order.
# Each section is preceded by its ### header and followed by a blank line.
# ---------------------------------------------------------------------------
emit_new_sections_to_file() {
    local output_file="$1"
    for sec in $SECTIONS; do
        if [ -s "${TMP_DIR}/sec_${sec}" ]; then
            printf '### %s\n' "$sec" >> "$output_file"
            printf '\n' >> "$output_file"
            cat "${TMP_DIR}/sec_${sec}" >> "$output_file"
            printf '\n' >> "$output_file"
        fi
    done
}

# ---------------------------------------------------------------------------
# Build the new CHANGELOG.md
# ---------------------------------------------------------------------------
MERGED_CHANGELOG="${TMP_DIR}/changelog_new"

if grep -qF "${DATED_HEADING}" "${CHANGELOG_FILE}"; then
    # -----------------------------------------------------------------------
    # Merge path: today's dated block already exists in CHANGELOG.md.
    #
    # Strategy (three focused awk passes + reassembly):
    #   Pass A: Extract everything BEFORE the ## YYYY-MM-DD line → before.txt
    #   Pass B: Extract the block BODY (lines after the heading up to the next
    #           ## heading or EOF, heading line excluded) → block.txt
    #   Pass C: Extract everything FROM the next ## heading onward → after.txt
    #   Pass D: Merge new section bullets into block.txt → block_merged.txt
    #   Reassemble: before.txt + heading + block_merged.txt + after.txt
    # -----------------------------------------------------------------------
    BEFORE="${TMP_DIR}/before.txt"
    BLOCK="${TMP_DIR}/block.txt"
    AFTER="${TMP_DIR}/after.txt"

    awk -v heading="${DATED_HEADING}" '
    BEGIN { in_block = 0; past_block = 0 }
    !in_block && !past_block && $0 == heading { in_block = 1; next }
    in_block && /^## / { in_block = 0; past_block = 1 }
    !in_block && !past_block { print }
    ' "${CHANGELOG_FILE}" > "${BEFORE}"

    awk -v heading="${DATED_HEADING}" '
    BEGIN { in_block = 0; past_block = 0 }
    !in_block && !past_block && $0 == heading { in_block = 1; next }
    in_block && /^## / { in_block = 0; past_block = 1 }
    in_block { print }
    ' "${CHANGELOG_FILE}" > "${BLOCK}"

    awk -v heading="${DATED_HEADING}" '
    BEGIN { in_block = 0; past_block = 0 }
    !in_block && !past_block && $0 == heading { in_block = 1; next }
    in_block && /^## / { in_block = 0; past_block = 1 }
    past_block { print }
    ' "${CHANGELOG_FILE}" > "${AFTER}"

    # Pass D: Merge new bullets into block body.
    #
    # For each canonical section already in the block: append new bullets
    # at the end of that section's existing bullets (before the next ### or EOF).
    # For canonical sections not yet in the block: append them in canonical
    # order at the end of the block body.
    #
    # P0-2 fix: use flat POSIX-compatible keys (sec SUBSEP j) instead of
    # two-dimensional arrays (new_bullets[sec][j]), which are a gawk extension
    # not supported by mawk or POSIX awk.
    #
    # P1-2 fix: flush_section trims trailing blank lines from the buffer before
    # appending new bullets, preventing doubled blank lines between existing
    # bullets and newly injected ones.
    BLOCK_MERGED="${TMP_DIR}/block_merged.txt"

    awk -v sections_order="${SECTIONS}" -v tmp_dir="${TMP_DIR}" '
    BEGIN {
        n_secs = split(sections_order, secs, " ")

        # Load new bullets for each section into flat arrays.
        # Key: sec SUBSEP j  (POSIX-compatible, no gawk 2D arrays)
        # Note: increment n before building the key in a separate statement —
        # using ++n inside string concatenation has undefined behaviour in some
        # POSIX awk implementations (mawk, nawk) where operator precedence
        # causes the pre-increment to be evaluated as a string "0".
        for (i = 1; i <= n_secs; i++) {
            sec = secs[i]
            path = tmp_dir "/sec_" sec
            n = 0
            while ((getline bline < path) > 0) {
                n++
                new_bullets[sec SUBSEP n] = bline
            }
            close(path)
            new_count[sec] = n
            written[sec] = 0
        }
        current_sec = ""
        buf_count = 0
    }

    # flush_section: emit the buffered lines for the current section,
    # trimming trailing blank lines, then append any new bullets for it.
    function flush_section(   i, last_nf) {
        if (current_sec == "") return

        # P1-2 fix: find last non-blank line in buffer to trim trailing blanks
        last_nf = 0
        for (i = 1; i <= buf_count; i++) {
            if (buf[i] != "") last_nf = i
        }
        for (i = 1; i <= last_nf; i++) print buf[i]

        # Append new bullets for this section if any
        if (new_count[current_sec] > 0 && !written[current_sec]) {
            for (i = 1; i <= new_count[current_sec]; i++) {
                print new_bullets[current_sec SUBSEP i]
            }
            written[current_sec] = 1
        }
        # Restore one trailing blank line to separate sections
        print ""
        buf_count = 0
        current_sec = ""
    }

    /^### / {
        flush_section()
        sec_name = substr($0, 5)
        current_sec = sec_name
        buf_count = 0
        print
        next
    }

    current_sec != "" {
        buf[++buf_count] = $0
        next
    }

    { print }

    END {
        flush_section()

        # Append any canonical sections not yet written, in canonical order
        for (i = 1; i <= n_secs; i++) {
            sec = secs[i]
            if (new_count[sec] > 0 && !written[sec]) {
                print ""
                print "### " sec
                print ""
                for (j = 1; j <= new_count[sec]; j++) {
                    print new_bullets[sec SUBSEP j]
                }
                print ""
            }
        }
    }
    ' "${BLOCK}" > "${BLOCK_MERGED}"

    # Reassemble
    {
        cat "${BEFORE}"
        printf '%s\n' "${DATED_HEADING}"
        cat "${BLOCK_MERGED}"
        cat "${AFTER}"
    } > "${MERGED_CHANGELOG}"

else
    # -----------------------------------------------------------------------
    # Prepend path: no dated block for today exists yet.
    #
    # P0-1 fix: the new ## YYYY-MM-DD block must be inserted AFTER the
    # ## [Unreleased] block (if one exists), not before it.
    #
    # "## [Unreleased]" is the one special heading (exact text) that sits
    # above all dated entries. Every other ## heading — including bracket-dated
    # entries like "## [2026-04-20] — ..." — is treated as dated content and
    # is a valid insertion point; the new block goes before the first of them.
    #
    # Insertion logic:
    #   1. Skip "## [Unreleased]" (exact match) when scanning for insertion point.
    #   2. Insert before the first ## heading that is not "## [Unreleased]".
    #   3. If the only ## heading is "## [Unreleased]", insert after its block.
    #   4. If no ## headings at all, append at EOF.
    # -----------------------------------------------------------------------

    # Build new dated block content (sections only, no heading line)
    DATED_BLOCK_CONTENT="${TMP_DIR}/dated_block_content"
    : > "${DATED_BLOCK_CONTENT}"
    emit_new_sections_to_file "${DATED_BLOCK_CONTENT}"

    # Find the first ## heading that is NOT exactly "## [Unreleased]".
    FIRST_NON_UNRELEASED_H2_LINE="$(grep -n "^## " "${CHANGELOG_FILE}" \
        | grep -v "^[0-9]*:## \[Unreleased\]" \
        | head -1 \
        | cut -d: -f1)"

    if [ -n "${FIRST_NON_UNRELEASED_H2_LINE}" ]; then
        # Insert the new dated block immediately before that heading.
        awk -v insert_before="${FIRST_NON_UNRELEASED_H2_LINE}" \
            -v today="${TODAY}" \
            -v block_content="${DATED_BLOCK_CONTENT}" \
            '
        NR == insert_before {
            print "## " today
            print ""
            while ((getline bline < block_content) > 0) {
                print bline
            }
            close(block_content)
        }
        { print }
        ' "${CHANGELOG_FILE}" > "${MERGED_CHANGELOG}"
    else
        # Only "## [Unreleased]" exists (or no ## headings at all).
        # Find where the [Unreleased] block ends and insert the dated block there.
        UNRELEASED_LINE="$(grep -n "^## \[Unreleased\]" "${CHANGELOG_FILE}" \
            | head -1 | cut -d: -f1)"

        if [ -n "${UNRELEASED_LINE}" ]; then
            INSERT_AFTER_LINE="$(awk -v start="${UNRELEASED_LINE}" '
                NR > start && /^## / { print NR - 1; exit }
                END { print NR }
            ' "${CHANGELOG_FILE}")"

            awk -v insert_after="${INSERT_AFTER_LINE}" \
                -v today="${TODAY}" \
                -v block_content="${DATED_BLOCK_CONTENT}" \
                '
            { print }
            NR == insert_after {
                print ""
                print "## " today
                print ""
                while ((getline bline < block_content) > 0) {
                    print bline
                }
                close(block_content)
            }
            ' "${CHANGELOG_FILE}" > "${MERGED_CHANGELOG}"
        else
            # No ## headings at all — append dated block at end of file.
            {
                cat "${CHANGELOG_FILE}"
                printf '\n## %s\n\n' "${TODAY}"
                cat "${DATED_BLOCK_CONTENT}"
            } > "${MERGED_CHANGELOG}"
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Step 5: Replace CHANGELOG.md
# ---------------------------------------------------------------------------
cp "${MERGED_CHANGELOG}" "${CHANGELOG_FILE}"

# ---------------------------------------------------------------------------
# Step 6: Delete processed fragment files (not .keep / README.md)
# ---------------------------------------------------------------------------
for frag in "${fragment_files[@]}"; do
    rm -f "$frag"
done

# ---------------------------------------------------------------------------
# Step 7: Stage changes
# ---------------------------------------------------------------------------
git -C "${REPO_ROOT}" add "${CHANGELOG_FILE}" "${CHANGELOG_DIR}"

echo "Compiled changelog fragments for ${TODAY} and staged changes."
exit 0
