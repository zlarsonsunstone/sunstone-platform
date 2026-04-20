#!/usr/bin/env bash
# ============================================================================
# Sunstone platform — pre-deploy grep checks (PRD v1.4 PV-6, P9)
# ============================================================================
# Block the deploy if:
#   1. Any tenant company name appears in code
#   2. Any inline prompt exists outside the variant library
#   3. Any hardcoded dollar or score threshold is present
# ============================================================================

set -e

FAILED=0

echo "Running grep checks..."

# 1 — Tenant names in code (PV-6)
if grep -rnE "GoliathData|Manifold\\W|WickedBionic|wicked-bionic|Renco\\W|Smith.?Wesson" src/ 2>/dev/null; then
  echo "❌ FAIL: Tenant name found in source code. Remove hardcoded tenant references."
  FAILED=1
fi

# 2 — Inline prompts outside renderPrompt / prompt_variants
INLINE_PROMPTS=$(grep -rnE "(You are|Analyze the following|You're an expert)" src/ 2>/dev/null | grep -v "prompt_variants" | grep -v "renderPrompt" || true)
if [ -n "$INLINE_PROMPTS" ]; then
  echo "❌ FAIL: Inline prompt text found. All prompts must live in v2.prompt_variants."
  echo "$INLINE_PROMPTS"
  FAILED=1
fi

# 3 — Hardcoded dollar thresholds in logic (CT-4)
if grep -rnE "obligated\\s*>\\s*[0-9]{5,}" src/ 2>/dev/null; then
  echo "❌ FAIL: Hardcoded dollar threshold. Use tenant.value_threshold."
  FAILED=1
fi

if [ $FAILED -eq 0 ]; then
  echo "✅ All grep checks passed."
else
  exit 1
fi
