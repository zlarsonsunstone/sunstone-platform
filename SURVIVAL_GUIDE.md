# Sunstone Platform — Survival Guide

*If you lose everything except this GitHub repo, you can rebuild Sunstone from this document. Keep this updated whenever credentials, infrastructure, or architecture change.*

*Last updated: April 25 2026*

---

## Quick Recovery — "I've lost the chat. What do I do?"

You have not lost anything important. Here is the complete state:

1. **GitHub repo:** github.com/zlarsonsunstone/sunstone-platform — all code, docs, syntheses, icons
2. **Live platform:** sunstoneplatform.netlify.app — auto-deployed from GitHub
3. **Database:** Supabase project `acvbqfrpiusjiawotrsm` — all client data, vendor universe, analytical outputs
4. **Documentation:**
   - `PLAYBOOK.md` — what the platform is and how it works
   - `SESSION_JOURNAL.md` — chronological narrative of how we built it
   - `syntheses/<tenant>/` — per-engagement analytical outputs

To resume work in a new chat: open the GitHub repo, point Claude at `PLAYBOOK.md` and `SESSION_JOURNAL.md`, and you have full context.

---

## The Layered Defense

| Layer | What's stored | Survival guarantee |
|---|---|---|
| GitHub | All code + docs + syntheses + icons | Permanent until GitHub fails |
| Netlify | Deployed running app | Auto-deploys from GitHub commits |
| Supabase | All operational data (vendors, analyses, profiles) | Daily backups + point-in-time recovery |
| Local downloads | Snapshot copies via /mnt/user-data/outputs/ | Until your machine fails |
| Chat history | Working session context | Lost when chat is deleted or compacted |

The first three layers are independent and redundant. As long as GitHub is intact, the platform can be rebuilt.

---

## Critical Credentials

**Credentials must NEVER be committed to GitHub.** GitHub's secret scanning will reject pushes containing them, and rightly so. Store all credentials in a password manager (1Password, Bitwarden, Apple Keychain) or encrypted note app.

This section lists WHAT credentials exist and WHERE to find them, but not the values themselves.

### GitHub
- Repo: `github.com/zlarsonsunstone/sunstone-platform`
- PAT (repo scope, no expiration): stored in your password manager under "GitHub PAT — sunstone-platform"
- The PAT was created with `repo` scope only and never expires (so it doesn't need rotation unless compromised)

### Supabase
- Project ID: `acvbqfrpiusjiawotrsm` (this IS public — it's just an identifier)
- Project URL: `https://acvbqfrpiusjiawotrsm.supabase.co`
- Anon public key: stored in `.env.local` and Netlify environment as `VITE_SUPABASE_ANON_KEY` (this is intentionally public)
- Service role key: stored in your password manager under "Supabase service role — sunstone-platform" — NEVER commit this
- Web dashboard: `https://supabase.com/dashboard/project/acvbqfrpiusjiawotrsm`

### Netlify
- Production URL: `https://sunstoneplatform.netlify.app`
- Anthropic API key: stored as `VITE_ANTHROPIC_API_KEY` environment variable in Netlify (not in code)
- Build settings: vite build → publish dir `dist`

### HigherGov
- API key: stored in your password manager under "HigherGov API key"
- Endpoint: `https://www.highergov.com/api-external/opportunity/`
- Used as query param: `?api_key=<key>&...`

### Anthropic
- API key: stored in Netlify env as `VITE_ANTHROPIC_API_KEY` and locally in `.env.local`
- Generated at: `console.anthropic.com`

---

## If You Lost Your Credentials

If you don't have a password manager backup of the credentials:

1. **GitHub PAT:** revoke the old one at github.com/settings/tokens, generate a new one with `repo` scope
2. **Supabase service key:** rotate at `supabase.com/dashboard/project/acvbqfrpiusjiawotrsm/settings/api` (admin → API → reset service role)
3. **Netlify env vars:** view and update at `app.netlify.com/sites/<site>/settings/env`
4. **Anthropic API key:** generate new at `console.anthropic.com`
5. **HigherGov API key:** contact HigherGov support to reset

After rotation, update local `.env.local`, Netlify environment variables, and any deployed services that consumed the old keys.

---

## Repository Structure

```
sunstone-platform/
├── PLAYBOOK.md                    ← What the platform IS (architecture, design, customer journey)
├── SESSION_JOURNAL.md             ← How we BUILT it (chronological narrative)
├── SURVIVAL_GUIDE.md              ← This file
├── syntheses/                     ← Per-engagement analytical outputs
│   └── manifold/
│       └── 2026-04-25_tier_2_in_progress.md
├── public/
│   └── report-icons/              ← Visual identity for the three reports
│       ├── ceo-icon.png
│       ├── federal-bd-icon.png
│       ├── engineering-icon.png
│       └── three-audiences-source.png
├── supabase/
│   └── migrations/                ← Database schema (everything from 0001 to 0019+)
├── netlify/
│   └── functions/                 ← Edge functions (fetch-website, claude-enrich, etc.)
└── src/
    ├── components/                ← React components (tabs, admin, scanner)
    │   ├── tabs/
    │   ├── admin/
    │   └── DoppelgangerScanner.tsx
    ├── lib/                       ← Core libraries
    │   ├── vendorTier2.ts        ← Tier 2 scan pipeline
    │   ├── piidAnalysis.ts       ← Per-PIID forensic analysis
    │   ├── methodologyLog.ts     ← Cross-tool event log
    │   ├── claude.ts             ← Browser-side Claude API
    │   └── supabase.ts           ← DB client
    └── store/                     ← Zustand state management
```

---

## How to Resume Work

### From a fresh chat with Claude

Tell Claude:

> "I'm Zack Larson at Sunstone Advisory. I'm building the Sunstone Intelligence Engine. The full state is at github.com/zlarsonsunstone/sunstone-platform. Read PLAYBOOK.md, SESSION_JOURNAL.md, and SURVIVAL_GUIDE.md to get up to speed. We were in the middle of [whatever you remember]."

Claude will be able to read the repo state and pick up where the last session left off.

### From a completely lost state

If you've forgotten everything:

1. Go to github.com/zlarsonsunstone/sunstone-platform
2. Read README (if exists) or PLAYBOOK.md (Section 1 — Philosophy)
3. Read SESSION_JOURNAL.md from start to finish
4. The two documents together give you the complete history of the platform

### Verifying database state

```sql
-- Connect to Supabase and run:
SET search_path TO v2, public;

-- How many tenants exist
SELECT id, name FROM tenants ORDER BY created_at;

-- How many vendors imported
SELECT COUNT(*) FROM vendor_universe;

-- Check Tier 2 analysis state
SELECT
  tenant_id,
  COUNT(*) AS analyzed,
  COUNT(*) FILTER (WHERE capability_score >= 5) AS strong_candidates
FROM vendor_capability_analysis
WHERE tier = 2
GROUP BY tenant_id;
```

If those queries succeed, your data is intact.

---

## Engagement Outputs — The Synthesis Artifacts

This is where each client engagement's analytical work gets memorialized. The pattern: every major analytical milestone produces a written synthesis (5-15 pages of analytical prose) at `/syntheses/<tenant>/YYYY-MM-DD_<milestone>.md`.

These synthesis artifacts are the source-of-truth for the three audience reports (CEO, Federal BD, Engineering).

**Current syntheses:**
- `syntheses/manifold/2026-04-25_tier_2_in_progress.md` — Manifold Tier 2 vendor doppelganger scan, in-progress findings at 27% completion. Will be finalized at 100% scan completion.

**Coming syntheses (when generated):**
- `syntheses/manifold/2026-04-25_tier_2_final.md` — final Tier 2 verdict
- `syntheses/manifold/synthesis_tier_3_deep.md` — Tier 3 deep analysis on survivors
- `syntheses/manifold/synthesis_tier_4_federal_history.md` — federal history reverse-lookup
- `syntheses/manifold/synthesis_market_verdict.md` — Hidden vs. Pre-Commercial verdict

---

## Architecture at a Glance (for new readers)

**Sunstone Intelligence Engine** is a multi-tenant federal market intelligence platform. Three core mission goals:

1. **EXPOSE THE LIE** — federal procurement data is misleading; surface the truth
2. **TRIBAL DECODER RING** — translate client capability into agency-specific language
3. **INVISIBLE AWARDS VIA DOPPELGANGER VENDORS** — find hidden markets via vendor reverse-engineering

**Two research paths:**
- **NAICS Path** — start with codes, find contracts, extract language. Works when client capability fits known codes.
- **Vendor Path** — start with vendors, reverse-engineer codes. Works when client is novel/category-creating.

**Customer journey:** 5 stages (Onboard → Profile → Research → Gates → Deliverables). Three gates run in parallel within Stage 4: Gate 1 (public bid pursuit), Gate 2 (teaming), Gate 3 (Steptoe-led influence/market creation).

**Three audience reports per engagement:**
- The CEO Report (4-8 pages, strategic)
- The Federal BD Report (15-25 pages, operational)
- The Engineering Report (20-40 pages, technical)

All composed from the same source synthesis artifacts via view-generator architecture.

---

## What's Active vs. What's Roadmap

**Active (working in production):**
- Multi-tenant onboarding + commercial profile synthesis
- Round 1 NAICS Path (CSV upload → keyword extraction → PIID forensics)
- Vendor Path Tier 0-1 (fence + name signal)
- Vendor Path Tier 2 (in progress for Manifold as of April 25 2026)
- Methodology log
- Synthesis artifact pattern
- Three-audience report architecture (defined, not yet implemented)
- Visual identity (icons committed)

**Built but not yet integrated:**
- Some admin tooling for prompt variant versioning
- HigherGov fetch (Edge Function exists, not yet wired to UI)

**Roadmap (defined but not built):**
- Round 2 + Round 3 deep workflows
- Vendor Path Tier 3 + Tier 4
- Three audience report generators (composeCEOReport.ts, composeFederalBDReport.ts, composeEngineeringReport.ts)
- Methodology Report generator
- Leadership Connect (LC) integration
- OnFrontiers integration
- Solicitation-side intelligence (Section 8 of PLAYBOOK):
  - Posting venue intelligence
  - SOW extraction
  - Predictive solicitation modeling

---

## Backup Instructions for the Future

When something significant ships, the pattern is:

1. **Code:** committed to GitHub via `git commit + git push`
2. **Architectural change:** PLAYBOOK.md updated with changelog entry
3. **How-we-got-here:** SESSION_JOURNAL.md gets a new session entry
4. **Engagement output:** new synthesis artifact at `/syntheses/<tenant>/`
5. **This document:** updated if credentials, infrastructure, or recovery procedures changed

No artifact lives only in chat. Everything important gets pushed to GitHub.

---

## Emergency Contacts

If GitHub is compromised or unreachable:
- Local clones: any machine you've cloned the repo to has a complete copy
- Hector Caro (long-term technology partner) — has access patterns

If Supabase is compromised:
- Migrations in `supabase/migrations/` rebuild the schema from scratch
- Vendor universe CSV at `/mnt/user-data/outputs/manifold_doppelganger_candidates.csv` (when it was generated) re-imports the 118K vendor pool
- Commercial profiles are recoverable from source documents if originals are still on hand

If Netlify is compromised:
- Deploy GitHub repo to Vercel or Cloudflare Pages — same Vite build works

---

*This document is the failsafe. As long as it stays updated with current credentials and architecture, the platform can be rebuilt from this single document plus the GitHub repo.*

### Changelog

- **April 25 2026.** Initial authoring after Zack expressed concern about losing chat continuity. Documents complete recovery procedures, layered defense, repository structure, and resume-from-fresh instructions.
