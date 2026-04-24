# Sunstone Platform — Session Journal

*The making-of record. Chronological narrative of how the platform came to be what it is, told session by session. Companion to PLAYBOOK.md, which describes what the platform IS; this document describes how we ARRIVED at it.*

*Every architectural decision, every moment of insight, every pivot, every course correction. Entries are kept in chronological order, most recent last. Each entry is attributable — who noticed what, who reframed what, what led to what.*

*This is the raw material the client-facing Methodology Report will eventually draw from. It is also the onboarding document for anyone who joins Sunstone and needs to understand why things are the way they are.*

---

## Session 1 — Platform Foundations (earlier months, before April 2026)

**Period:** Late 2025 through Q1 2026

**Participants:** Zack Larson, Claude, Hector Caro (occasional reviewer)

### What we set out to do

Build a federal market intelligence platform that lets Sunstone move beyond "just another advisory firm with AI." Initial scope: multi-tenant Supabase + Netlify stack, onboard clients, ingest commercial profiles, generate federal entry frameworks.

### What we built

- Supabase project `acvbqfrpiusjiawotrsm` with v2 schema supporting multi-tenancy
- Netlify deploy at `lighthearted-piroshki-26c96b.netlify.app` (later consolidated)
- Core tables: tenants, users, commercial_profile, federal_entry_framework, strategic_profile, enrichment_sessions, enrichment_records, scope_sessions, keyword_bank, prompt_variants
- Admin panel with tenant/user management, prompt variant versioning, audit logging
- 17-source commercial profile ingestion with synthesis via Claude
- First-pass Federal Entry Framework (v1 prompt) with NAICS/PSC suggestions
- Strategic profile commit flow with client approval gate
- Round 1 Search Scopes generation
- CSV upload + Haiku batch keyword extraction (8 concurrent, 200 records/batch)
- Noise floor filtering ($500K minimum or ≥2 batch appearances)
- Keyword analysis panel with sortable table, selection checkboxes, save-to-bank
- Manifold Labs onboarded as second tenant (after Sunstone itself as first)

### Three core mission goals codified

During this period, the three Sunstone mission goals were committed to platform architecture — not as marketing but as what the system must actually produce:

1. **EXPOSE THE LIE** — federal buyers mislabel/obfuscate what they buy; platform surfaces truth beneath the coded labels
2. **TRIBAL DECODER RING** — every agency has its own language; platform maps client capability to every agency's tribal vocabulary
3. **INVISIBLE AWARDS VIA DOPPELGANGER VENDORS** — if a company structurally identical to the client keeps winning work coded as "engineering services," those are probably the client's market too

These goals became the design constraints for everything downstream.

### What ended Session 1

The foundation was solid but the Federal Entry Framework kept suggesting outdated PSC codes (D3xx/7030 codes retired in the GSA April 2025 PSC Manual). Claude's training-data knowledge was being used instead of authoritative reference. This became the first major architecture issue to resolve in Session 2.

---

## Session 2 — Reference Grounding & Framework Versioning (early-to-mid April 2026)

**Participants:** Zack, Claude

### What we set out to do

Fix the outdated PSC code problem. Ground the Federal Entry Framework in authoritative data.

### What we discovered along the way

Two files Zack had on hand became the authoritative sources:
- `PSC_April_2025__1_.xlsx` — GSA PSC Manual April 2025 edition, 874K rows, 2,540 active codes after extraction
- `6-digit_2022_Codes.xlsx` — Census Bureau 2022 NAICS revision, 1,012 codes

**Zack noticed:** fetching the full PSC/NAICS tables from Supabase was returning only 1,000 rows because of the default pagination limit. That bug was masking incomplete data from the prompts. Fixed by paginating past the default.

### Design decision: prompt template versioning

Rather than just update the prompt and call it a day, we introduced a `prompt_variants` table with versioning. Each generated framework gets tagged with the prompt version that produced it. If the prompt changes later, stale outputs are invalidated automatically.

This felt like over-engineering at the time. In hindsight it was essential — multiple times in later sessions we needed to know "was this produced by the v1 prompt or the v2 prompt" and the answer was in the data.

### What shipped

- Migration 0013-0015 sequence: PSC + NAICS seed tables, `prompt_template_version` column on reconciliation
- Framework prompt v2 grounded in 2,540 PSC + 1,012 NAICS reference codes
- UI gate: "Create strategic profile" button disabled with yellow warning banner when current framework was built on prompt v1 (stale taxonomy)
- Methodology log began capturing reconciliation events with framework version

### Key insight (Zack)

> "If the sausage recipe changes, the sausage from before that change can't pretend the new recipe made it."

This principle — versioning every AI-generated artifact against the prompt that made it — became foundational across the platform.

---

## Session 3 — Per-PIID Forensic Analysis (mid-April 2026)

**Participants:** Zack, Claude

### What Zack wanted

> "This is where I want individual PIIDs interrogated."

The keyword analysis was producing 600+ phrases, but each phrase was just a score and a count. Zack wanted to click a phrase and see the actual contracts that matched, with full analysis per contract.

### The architectural decision

Zack originally requested **eager analysis** — run PIID analysis on every phrase automatically after keyword extraction completes. Cost estimate: ~$7 per session, 12+ minutes added to the 45-second keyword analysis.

Claude pushed back: "build Lazy first, validate, then add Eager toggle." Three arguments:
1. User controls cost per-phrase
2. Iteration is cheap during development (15 sec/phrase, not 15 min)
3. Most phrases never get expanded

**Zack initially said "Build what I said — Eager, all PIIDs, no cap."**

Then, one message later: "I meant build what YOU said lol. Lazy now, eager eventually."

This became a pattern worth noting: Zack's instinct is often to go big, Claude's instinct is often to validate smaller first. When they converge, the result is usually right. Zack's self-correction here prevented a likely-to-fail eager build.

### What shipped

- Migration 0018: `sam_registry`, `vendor_intel`, `piid_analysis` tables with race-safe upserts
- `callClaudeBrowser` extended with web_search tool support (SAM registry would be empty at first, web fallback needed)
- `vendorIntel.ts`: SAM lookup → web search fallback service with 24hr cache per UEI
- `piidAnalysis.ts`: per-PIID forensic pipeline, 8 concurrent Haiku calls, dedupe by PIID (highest dollar wins)
- UI: keyword row with expand chevron, auto-triggers analysis on first expand, progress bar, forensic drawer with 3 score badges (per-PIID relevance, NAICS alignment, PSC alignment)
- Vendor intel cached per UEI, shared across all PIIDs from that vendor

### Key moment

Zack uploaded a SAM monthly extract (460K vendors with websites). The SQL paste-into-editor approach couldn't handle it (92 separate 440KB files). Claude scoped building a bulk-upload admin UI. Zack said "skip for now, use web search fallback" — wise call, avoided a 30-min detour. The SAM seed remains empty and web fallback carries the weight. This is documented in the PLAYBOOK as a design decision but the journal captures why we skipped the ideal solution.

---

## Session 4 — The PIID Count Discrepancy (late April 2026, the "15 vs 1" incident)

**Participants:** Zack, Claude

### What Zack caught

First test of PIID forensic analysis, Zack's screenshot:

> Phrase: "GPU compute" — count 15 — **PER-PIID FORENSIC ANALYSIS: 1 PIIDs analyzed**

Zack's response: *"Its working, and the analysis is ROCK solid! Now, why do I only have the option of reviewing one PIID if there were 15 in the dataset?"*

### Claude's initial diagnosis — wrong

Claude's first hypothesis: the display count (15) came from Haiku's semantic aggregation, the PIID analysis count (1) came from strict SQL `ilike '%gpu compute%'`. Haiku's semantic count was catching fuzzy matches like "GPU-accelerated compute workloads" that the literal substring missed.

Fix: switch to token-based matching — require every word of the phrase to appear somewhere in the description, any order.

### Claude's second diagnosis — also incomplete

After token matching shipped, Zack tested again. This time "confidential computing" showed count=4 in the display but **0 PIIDs matched** when expanded.

The new bug was the opposite direction: Haiku's count was *too high* compared to token matching.

Claude traced this to Haiku's prompt behavior: with the commercial profile in context, Haiku would sometimes extract phrases *relevant to the client* even when they didn't literally appear in the data. Haiku then assigned a semantic count based on fuzzy matches (confidential environment, secure computing, etc.) that strict tokens wouldn't match.

### The fix that became a feature

Rather than just fixing the bug, we introduced **count reconciliation**: after noise floor filtering, re-query the DB with the same token matcher the PIID analysis uses, and overwrite Haiku's semantic count with the deterministic count. Phrases with literal count = 0 get flagged as `proactive: true`.

**This is where PROACTIVE was born.**

Zack's reaction when he first saw the PROACTIVE badge appear:

> "Whoa...where did the 'PROACTIVE' come from - is that the system providing intelligent insights from what was provided - relevant hypothesis?"

Claude walked through the origin: Haiku was recognizing Manifold's commercial capability (confidential computing via TDX/TVM) and noting when federal SOW writers used DIFFERENT language for the same work (secure enclaves, hardware-based isolation). The PROACTIVE flag was the system admitting: "this phrase is relevant to your capability but does NOT literally appear in your data — likely a tribal language gap."

### Key insight (Zack)

> "I think it's a GREAT thing! It gives me the ability to transition FROM code dominance to language dominance, and find opps hidden in inappropriate code selections. I further think if the system can stack these observations and continue to evaluate the full descriptions of both the contracts and core capabilities of the awarded vendors, we can LITERALLY find the hidden gems!"

**This moment reframed what PROACTIVE was for.** Not a bug-fix artifact. A core platform capability — the tribal language gap detector. The feature that lets Sunstone claim to do what no other federal advisory firm does.

### What shipped

- Token-based matching replacing literal substring (commit `b9754e5`)
- Count reconciliation with token matcher as Step 5.5 of keyword analysis
- PROACTIVE flag on phrases with literal count = 0
- UI badge rendering for proactive phrases with tooltip explanation

---

## Session 5 — Trap Phrases & Wrong-Room Diagnosis (late April 2026)

**Participants:** Zack, Claude

### What Zack asked

After the PROACTIVE badges were visible, Zack looked at the expanded view of "AI infrastructure":

- Relevance: 10/10 (perfect Manifold capability match)
- $ volume: $302M
- Count: 84 contracts
- PER-PIID FORENSIC ANALYSIS: all 1/10 or 2/10 scores

The maximum per-PIID fit score across the entire 84 contracts was a single 2/10 (Camgian at $10.3M). Everything else was 1/10.

Zack's question:

> "What is to be derived from a keyword with high surface relevance, high density, low PIID relevance?"

### Claude's analysis — and the insight

This pattern — relevance ≥7, count ≥10, average per-PIID score ≤3 — got named a **trap phrase**. Meaning: the phrase is a boundary object (multiple communities use it to mean different things), and the federal buyers in the dataset mean something different by this phrase than Manifold does.

Awardees for "AI infrastructure": Camgian, IBM, Four Points Tech, LECOR, DECISIVEINSTINCTS, GDIT, Booz Allen, NTT Data, SAIC, Peraton, Reston Consulting, Colossal Contracting... every traditional federal IT prime.

**The implication:** Manifold should NOT pursue public bids on these contracts. They will lose to Booz Allen every time because Booz has already captured what "AI infrastructure" means to these buyers. The phrase became a trap for the unwary.

### Zack looked at the whole 604-phrase list

Then Zack asked the harder question:

> "What do we do when NOTHING is even remotely close?"

Claude walked through the data: 604 phrases, MAX per-PIID score across the entire analysis was 2/10. 47 phrases came back as PROACTIVE with 0 literal matches. This wasn't a bug or a data issue — this was **the federal market telling Manifold something**.

### The "wrong room" diagnosis

This became the third platform pattern:

> *Round 1 Turn 1 analyzed 14,882 federal contracts across $32.1B in obligated spending through 2026-04-22. The analysis conclusively shows your capability — decentralized GPU compute with confidential computing primitives — does not exist in traditional federal IT services procurement (NAICS 541511/541512/541519). Forty-seven phrases describing your capability returned zero literal matches. This is a strategic finding, not an analytical failure.*

The insight: **a "wrong room" result is a successful finding, not a failed analysis.** Most firms don't have the tools (or the honesty) to tell a client "the market you're searching for isn't here, we need to pivot." Sunstone does both.

Zack's framing:

> "If we'd hired Deloitte instead, they would have given you a 200-page report with 50 'opportunities' in 541511 that you would have bid and lost. We just saved you 18 months and half a million in proposal costs. Here's the real play."

This became the template for how wrong-room diagnoses are communicated to clients going forward.

---

## Session 6 — The Vendor Pivot (late April 2026)

**Participants:** Zack, Claude

### Zack's pivot proposal

After the wrong-room diagnosis, Zack made a proposal that changed the platform architecture:

> "We pivot. We analyze websites of companies based on PRIMARY NAICS. We go 'logically broad'. In other words, we only eliminate CLEARLY bad fits (Agriculture, Mining, Construction, etc.) - but we KEEP all the 54's we keep all the 61 (education)...we put a fence around, but don't choke.
> 
> Then, we analyze their websites in terms of alignment with Manifold. Same idea - full 0-10 match score, with full analysis write-up. Those that have match scores 7 or better, we run their UIEDs to see if they have direct or sub award history.
> 
> THIS will tell us unequivocally whether the market is (a) hidden or (b) non-existent."

### Why this was a watershed insight

Up to this point, the platform had one research path: NAICS → contracts → language → analysis. That path assumed the federal market was at least partially visible under the codes the client's capability mapped to.

Zack's insight: **start with vendors, reverse-engineer the codes.** If companies commercially identical to Manifold exist, they're doppelgangers. If those doppelgangers have won federal contracts (under any code, not just what we'd naively search), then the federal market for Manifold's work exists — just hidden under codes we didn't look at.

If doppelgangers exist commercially but have NO federal history, the market is genuinely pre-commercial (not hidden, just not procured yet).

**Either answer is actionable.** "Hidden" = use the doppelgangers' actual codes for the next NAICS Path run. "Pre-commercial" = pivot to Gate 3 (Steptoe influence) dominant strategy.

### The confidence layer Zack added

Then Zack added another dimension:

> "For confidence - Case studies, use cases, legit testimonials, federal past performance - any real performance signals."

This became the **Capability × Evidence matrix**. Not just "does this vendor claim to do what Manifold does" but also "is their claim backed by evidence the work has actually been delivered." A website can claim anything. Evidence separates aspiration from delivery.

Seven-tier classification matrix emerged:
- TRUE DOPPELGANGER (capability ≥8, evidence ≥7) — deep analysis targets
- UNPROVEN DOPPELGANGER (capability ≥8, evidence 4-6) — check federal history; if present, promote
- LOUD CLAIMANT (capability ≥8, evidence <4) — skeptical, deprioritize
- PROVEN ADJACENT (capability 5-7, evidence ≥7) — teaming partners
- ADJACENT CAPABILITY (capability 5-7, evidence 4-6) — watchlist
- Plus two false-positive categories for low capability

### Zack's routing insight

Zack then codified the dual-path routing:

> "We can run all the UEIs against USASpending Prime and Sub Awards, and eliminate everyone that has no award history. This is a good down-select method, but it kills our insights into which other 'Manifold Labs' are lying in wait, and simply haven't broken through yet.
> 
> Alternatively, we can run quick scans on all the sites, eliminate all those below a match score of let's say 5, and do a deeper analysis on what remains.
> 
> I think this is better. Keeps the integrity of our mission intact - we don't miss anything."

**Integrity over efficiency.** This decision preserves the signal about pre-commercial doppelgangers ("Manifolds lying in wait"). A client who finds out 50 commercial competitors exist but none have broken into federal is in a very different strategic position than a client who finds 3 commercial competitors with mature federal pipelines.

### The NAICS fence

Claude generated a vendor candidate list. Starting pool: 293,995 SAM-registered vendors with websites and primary NAICS. After the "logically broad" fence applied:

- **KEPT: 119,378 vendors across 109 NAICS codes**
- Fence keeps: 54 (IT/consulting/R&D), 51 (information), 33 partial (tech mfg only), 61 (higher ed + tech training), 62 partial (diagnostic labs), 92 (public admin), 55 (holdcos), 56 partial (doc prep, security systems), 52 partial (fintech)
- Fence kills: 11, 21, 22, 23, 31-32, 42, 44-45, 48-49, 53, 71, 72, 81, plus sub-sector kills

### What shipped

- Migration 0019: `vendor_universe`, `vendor_capability_analysis`, `research_route`, `capability_signal_tokens` tables
- SuperAdmin "Vendor Universe" tab with CSV import and stats dashboard
- Dual-path architecture documented in PLAYBOOK.md Section 3.B-C

### Still pending

Zack needed to run migration 0019 and import the 119,378 vendor CSV. The stats panel after import would show total vendors, count with capability signal, and sector breakdown — which would inform whether to tighten or widen the Tier 1 name-signal token list before committing Tier 2 Haiku cost.

---

## Session 7 — Memorialization (THIS session, late April 2026)

**Participants:** Zack, Claude

### Zack's prompt

> "Remember - you are memorializing our evolved thought for the playbook that explains to the user how we do what we do, right?"

### Claude's honest admission

No, Claude wasn't. The PLAYBOOK was being built but the making-of record wasn't. That's what led to Zack's Option A decision: "Author the full Playbook now in one pass based on everything we've built."

### What shipped (PLAYBOOK.md v1.0)

756 lines, ~7,650 words, 8 sections:
1. Philosophy (what Sunstone is, three mission goals, soft digital twin framing)
2. Customer Journey (5 stages, 3 parallel gates inside Stage 4)
3. Research Engine Mechanics (dual-path architecture, NAICS path, Vendor path, PROACTIVE flag, trap phrases, wrong-room diagnosis, capability × evidence matrix)
4. Intelligence Layers (HigherGov, Leadership Connect, OnFrontiers)
5. The Ecosystem (six tools, shared nervous system, methodology log)
6. Design Decisions (non-obvious choices with preserved reasoning)
7. Playbook in Practice (canonical engagement flow, common patterns, report structure)
8. Evolution and Maintenance

### The three-analysis insight

Mid-session Zack articulated a product vision that transforms Sunstone from "federal market analysis" to "federal capture operating system with forecasting":

> "Once a dataset has been maturely defined...you run analysis on the solicitations in the following ways:
> 
> #1 - What percentage of these were solicited, and for those that were - where? This means checking if they were SAM.gov (many were not!), and tracking down where they were...
> 
> #2 - Gathering the SOW details - tied to the Agency/Customer, tied to the VENDOR, tied to the NAICS and PSC choices, and obviously the contract description - more data enhancement!
> 
> #3 - We are able to examine the notice types, and titles, and frequency of publication to create a predictive frame work for what language agencies use for titling this type of work, how often they put it out...we can model future solicitation postings."

Three analyses, building on each other, each transformative on its own and together definitive.

### What shipped (PLAYBOOK.md v1.1)

Section 8 added: "Roadmap: Solicitation-Side Intelligence (Planned)." Captures:
- Posting venue intelligence (SAM is 1 of ~12 venues; clients typically see 40-60% of their market)
- SOW extraction + multi-dimensional enrichment (turn 200-char descriptions into 40-200 page intelligence dossiers)
- Predictive solicitation modeling (language patterns, notice-type sequences, timing cadence, next-posting prediction)
- Commercial implications: shifts from $150K one-time engagements to $25-50K/month subscriptions, path to 9-figure business

### Zack's second catch

> "Are you adding this to the archive of how we make the sausage?"

Claude admitted the gap again. The PLAYBOOK captures the method. The journal — this document — captures how we arrived at the method. Zack said: yes, build SESSION_JOURNAL.md now, retroactively fill from this session's thread.

### What shipped (this document)

SESSION_JOURNAL.md v1.0. Retroactive reconstruction across 7 sessions covering ~6 months of platform evolution. Going forward, maintained in real time alongside the PLAYBOOK at each architectural moment.

---

## Emerging Patterns (across sessions)

Looking back across these 7 sessions, certain patterns in how we work together have emerged:

**Pattern 1 — Zack goes big, Claude wants to validate small, convergence is usually right.**
Example: Eager PIID analysis (Zack said do it; Claude pushed back; Zack reversed to Lazy first).

**Pattern 2 — Bug-fixes become features.**
Example: PROACTIVE flag originated as a bug-fix for count divergence, became a first-class platform capability (tribal language gap detector).

**Pattern 3 — Zack's questions become architecture.**
Example: "Why do I only see 1 PIID when there were 15?" → token matching → reconciliation → PROACTIVE → dual-path architecture → entire research engine redesign.

**Pattern 4 — Claude builds, Zack reframes.**
Example: Zack's "AI infrastructure" observation turned a data point into the trap phrase pattern. Zack's vendor pivot turned a wrong-room finding into a new research path. Zack's three-analysis insight turned the platform from analysis tool into forecasting operating system.

**Pattern 5 — We preserve reasoning, not just outputs.**
Every design decision gets documented with its "why" so future maintenance doesn't regress. The reconciliation step, the dual-axis scoring, the hard CBP approval gate — all have their reasoning preserved because they could easily be simplified to their detriment.

**Pattern 6 — Integrity over efficiency.**
Zack's repeated instinct to prioritize signal preservation over computational cost. Keep commercial-only doppelgangers. Keep proactive phrases. Keep all PIIDs per phrase. Never let efficiency compromise the mission.

**Pattern 7 — External reviewers sharpen the framing.**
Jonathan Sweetser's "soft digital twin" observation reframed the product positioning mid-build. Matt Flynn's Steptoe partnership shaped the Gate 3 architecture. Hector Caro's technology reviews inform continuous direction. The platform benefits from voices that aren't in it every day.

---

## Journal Maintenance Going Forward

**Update triggers:** same as the PLAYBOOK, plus any moment of insight, any bug that reveals a structural pattern, any client reaction that reframes what we thought we were building, any external voice (Jonathan, Matt, Hector, client advisors, etc.) that sharpens the thinking.

**Format:** chronological entries, most recent last. Each entry captures:
- Session dates and participants
- What we set out to do
- What we discovered along the way
- Key insights (with attribution — who said what)
- What shipped
- What's pending for next session

**Migration path:** this document is currently a markdown file in the repo root. Future state: migrates into the live in-platform Methodology tab alongside the PLAYBOOK, where the Methodology Report generator reads from both plus the per-engagement methodology log to produce the client-facing deliverable.

### Changelog

- **v1.0 — April 24 2026.** Initial authoring with retroactive reconstruction of 7 sessions spanning platform foundation through the vendor pivot and playbook memorialization. Author: Claude, in session with Zack, with Zack's explicit direction to build this document separately from the PLAYBOOK.

---

*End of Session Journal v1.0*
