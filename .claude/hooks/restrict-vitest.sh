#!/bin/bash
# PreToolUse hook: blocks `vitest run` in subagent contexts.
#
# Problem: /execute subagents (dev, qa, reviewer) each spawning their own
# `vitest run` leave orphaned --pool=threads worker processes that hold 2-4 GB
# of heap each. Eight workers consumed ~24 GB and nearly OOM'd the machine.
#
# Rule: only the /execute orchestrator may invoke `vitest run`. Subagents write
# and commit tests but do NOT execute them. The orchestrator runs a single
# vitest invocation at Step 7A (E2E, orchestrator-direct).
#
# Bypass: prefix the command with ALLOW_VITEST=1 (orchestrator use only):
#   ALLOW_VITEST=1 npx vitest run tests/integration/... --pool=threads

input="$CLAUDE_TOOL_INPUT"

# Only intercept commands containing "vitest run"
if ! echo "$input" | grep -q "vitest run"; then
  exit 0
fi

# Allow if the orchestrator bypass flag is set
if echo "$input" | grep -q "ALLOW_VITEST=1"; then
  exit 0
fi

echo "BLOCKED: 'vitest run' is reserved for the /execute orchestrator (Step 7A)."
echo "Agents: write and commit tests — do not run them."
echo "Orchestrator: prefix with ALLOW_VITEST=1 to bypass:"
echo "  ALLOW_VITEST=1 npx vitest run <test-file> --pool=threads"
exit 2
