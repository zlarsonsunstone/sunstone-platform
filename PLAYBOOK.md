# The Sunstone Platform Playbook

*Version 1.0 · April 2026 · Living document*

---

## BLUF

Sunstone operates a **soft digital twin of a client's federal capture posture**. The platform isn't a search engine, a CRM, or a proposal generator — it's a living virtual replica of the client's federal reality that ingests signals, reasons about them, runs simulations, and tells the client where their actual market lives, who's winning it, who they can reach, and how to compete.

This playbook explains how we do what we do — the philosophy, the architecture, the workflow, and the design decisions that make Sunstone a category unto itself rather than "another federal advisory firm with AI."

Every section of this document was earned through real engagement work, specifically the Manifold Labs engagement where the platform's analytical core was stress-tested against genuinely novel capability (decentralized GPU compute with confidential computing primitives). Patterns that emerged during that work — trap phrases, proactive keywords, wrong-room diagnosis, the dual-path routing decision — are now first-class platform features.

---

## Section 1 — Philosophy

### What Sunstone actually is

Most federal advisory firms sell you one of two things: **pursuit support** (find opportunities, write proposals, capture) or **influence** (lobbying, government affairs, relationship work). Deloitte/Booz/PwC do the first at consultant-hour scale. Steptoe/K&L Gates/Holland & Knight do the second at partner-hour scale. Very few integrate them. None of them operate a living model of the client's federal posture.

Sunstone does both, integrated, at AI scale, with a shared intelligence layer underneath.

The product isn't the tools. The product is the **twin** — the continuously-updated virtual replica of the client's federal reality. The tools (CBP Builder, Intelligence Engine, Opps Finder, Defined AI Go/No-Go, Ericson Teaming, SAM Scorecard) are organs of the twin. Each does one thing well. They share a nervous system (the methodology log), a skeleton (the unified data model), and a cognitive layer (the AI reasoning grounded in authoritative data sources).

### The three mission goals

These are not marketing taglines. They're the three distinctive things the platform does that competitors cannot.

**Mission 1 — Expose the lie.**

Federal agencies mis-code, hide, and obfuscate what they buy. Not maliciously — procurement systems are old, labels drift, and program offices use internal shorthand. The result: 350K SAM opportunities per year vs. 5.5M USASpending awards = 94% visibility gap. Most firms search SAM and declare "that's the market." Sunstone surfaces what's beneath the coded labels using AI language analysis + USASpending cross-reference + vendor doppelganger detection. The platform makes the hidden 94% visible. This is not a keyword tool. It's a data forensics operation.

**Mission 2 — Tribal decoder ring.**

Every federal agency has its own dialect. What one calls "enterprise AI infrastructure" another calls "model deployment fabric." What one buys under NAICS 541511 another buys under 541715 R&D. Language-to-code-to-agency mappings are tribal — the kind of knowledge that takes 20 years in the building to acquire. Sunstone systematizes this. When a client walks into a meeting, Steptoe walks in sounding like they've been in that agency's tribal language for a decade. That is not accidental. That is the decoder ring output.

**Mission 3 — Doppelganger vendors, invisible awards.**

If a company that looks structurally identical to the client keeps winning awards coded as "engineering services" or "management support," those are probably the client's market too — mis-coded. Vendor DNA analysis, using commercial sources only (no government data), finds the shadow market the client cannot see by searching codes alone. This is the single most valuable analytical move the platform makes. Competitors don't do it. They can't — they're priced to bill hours, not mine signals.

### The "soft digital twin" framing

The phrase comes from Jonathan Sweetser's observation while reviewing the architecture. In industrial engineering, a digital twin is a live virtual replica of a physical asset (a jet engine, a factory, a power plant) — it mirrors the real thing, updates continuously, and lets operators run simulations without touching the real asset.

Sunstone is a soft digital twin because:
- It mirrors meaning, not matter (strategy, relationships, capability)
- It updates continuously as the client's commercial state changes, as federal procurement moves, and as our analysis learns
- It lets clients run simulations — what-if pursuits, what-if teaming decisions, what-if agency pivots
- It can predict — "if you chase this market with these codes, here's the expected win rate"

This framing is not a marketing gloss. It's the design principle. Every feature of the platform either increases twin fidelity, extends twin behaviors, improves twin predictions, or makes the twin more actionable. Anything that doesn't do one of those four things doesn't belong in the platform.

### What we are explicitly not

- **Not a search engine.** SAM search is a commodity. Everyone has it. Searching faster doesn't create value.
- **Not a proposal generator.** Language models can write proposals. Language models cannot tell a client whether a pursuit is winnable — that requires intelligence.
- **Not a CRM.** Salesforce is a fine CRM. We don't compete with Salesforce.
- **Not a bolted-on "AI feature" on top of existing tools.** The AI is the architecture. Remove it and the platform has nothing distinctive.

---

## Section 2 — Customer Journey

The client journey has five stages, plus three parallel gates inside Stage 4. Each stage has a specific deliverable, a specific handoff, and a specific commercial trigger.

### Stage 1 — Surface-Level Assessment (pre-engagement)

**Context:** The prospect has confirmed nothing. They're curious, or referred, or kicking tires. We know only what we can see of them from public signals.

**Goal A — Gaps Analysis.** Identify anything incomplete or red-flagged in the prospect's federal or adjacent commercial presence. Missing SAM registration data. Out-of-date NAICS codes. Website vs. capability statement mismatches. Federal past performance gaps. Clearance/certification absence. Team depth concerns. Anything the platform can detect that the prospect either knows (and should fix) or doesn't know (and now will).

**Goal B — External Interpretation.** Based solely on public digital artifacts, derive what the company actually is and does. This is the "mirror" move — we tell the prospect what the internet says about them, stripped of their own marketing voice. It's often jarring. "Here's what your website, LinkedIn, press coverage, and capability statement combine to say. Does that match your internal understanding?"

**Why this matters commercially:** Stage 1 is closing theater. When a prospect sees the mirror — when they see the gaps, the misalignments, the external interpretation that doesn't match their own self-image — they understand immediately that nobody else has shown them this. The sale is half-closed before the formal discovery call. Most firms start with a discovery call and a polite questionnaire. We start with an unsolicited forensic audit. That is the differentiator.

**Deliverable:** Stage 1 Mirror Report. Pre-engagement. No client data required. Derived entirely from external signal.

**Commercial handoff:** Sunstone Intelligence → introductory call → CBP engagement agreement → Stage 2.

### Stage 2 — Comprehensive Business Profile (CBP)

**Tool:** CBP Builder (`comprehensivebusinessprofile.abacusai.app`)

**What happens:** We build a 100% cited, evaluated profile of the client's business — capabilities, technology, differentiators, customers, team, financials, federal history, commercial traction. Every claim has a source. Every source has a rating (primary vs. secondary, authoritative vs. marketing).

**Critical gate:** The client must edit and/or approve the CBP before anything downstream runs. This is not a bureaucratic step. It is the **commitment lever.**

Why the approval gate matters:

1. **Psychological ownership.** Once a client edits their own profile, they own it. Every downstream recommendation references "your approved profile." They cannot later dispute the analysis on grounds of input data — they approved the input.

2. **Data hygiene.** We don't build downstream analysis on garbage. If the profile is wrong, fixing it now is cheap. Fixing it after 60 hours of Round 1/2/3 work is expensive.

3. **Partnership signaling.** A client who edits thoughtfully is a client who will be a partner in the work. A client who rubber-stamps signals a future problem. Approval behavior is itself intelligence.

**Role:** Foundation for every system downstream. The CBP is the canonical description of the client. Every tool in the ecosystem references it.

**Deliverable:** Client-approved CBP.

**Commercial handoff:** CBP approval triggers Stage 3 engagement.

### Stage 3 — Research Engine (Sunstone Intelligence Engine)

This is the heart and brains of the platform. Section 3 below details the mechanics exhaustively. At the journey level:

**Goal:** Move from surface-level opportunity indicators and SAM full-and-open gladiator sport to intelligent clustering, pattern-matching, myth-and-lies busting, and tribal language/tendency mapping. Find the multi-dimensional fit between client and customer — budget, solution alignment, small-business friendliness, first-time-contractor friendliness, buying preferences, language preferences, vendor preferences. Full-stack analysis.

**Outputs:**
- Prime targets for subcontracting (large vendors whose work overlaps client capability where sub-relationships make sense)
- Teaming partners for teaming or JV (peer-scale vendors with complementary capability)
- Top 2-5 Direct Federal Clients (Agency, Office, Base, Command, Program — ranked by fit, accessibility, and budget)
- Key "top-down" POCs and Steptoe relationship paths
- SAM engagement method recommendations — Industry Days, BAAs, CSOs, Sources Sought, RFIs, expiring contracts, and even low-ROI-but-strategic "rapport opportunities" (bids that won't win but establish target-customer relationship)

**Critical architecture decision:** Stage 3 has **two research paths** (NAICS and Vendor). The platform routes to one or both based on market maturity signals. Section 3.C details the routing logic.

**Deliverable:** Round 3 Intelligence Package — the full strategic intelligence output that feeds Stage 4's three gates.

**Commercial handoff:** Stage 3 completion triggers Stage 4 gate activation.

### Stage 4 — Execution (Three Parallel Gates)

Stage 4 is where intelligence becomes action. Three gates run in parallel, coordinated by the capture orchestration layer.

**Gate 1 — Bottom-Up Pursuit.**

Tools: Opps Finder → Defined AI Fed Opps Go/No-Go → Proposal Response Team

The client pursues public opportunities identified through Round 1/2 scope-based searches and Round 3 prime-target analysis. Opps Finder surfaces live opportunities weighted by Round 1 keyword bank. Defined AI Fed Opps runs deep Go/No-Go analysis on each promising opportunity. Winners go to the proposal response team for execution.

Deliverables: Capture memos, bid/no-bid decisions, proposal submissions.

**Gate 2 — Strategic Teaming / Subcontracting.**

Tools: Ericson Teaming Platform → OnFrontiers (for competitive intel on primes)

Find the right primes and teaming partners for subcontracting, JV, or supporting roles. Position the client's capability as a value-add that helps a prime win — not as competition to the prime. OnFrontiers experts provide inside views on prime behavior, CO preferences, and incumbent vulnerabilities.

Deliverables: Teaming engagement plans, sub-letter requests, capability differentiator one-pagers for primes.

**Gate 3 — Top-Down Influence (Steptoe + Flynn War Room).**

Tools: Leadership Connect + Steptoe's internal relationship networks + OnFrontiers

The war room strategy for Matt Flynn at Steptoe. Platform identifies primary, secondary, and tertiary targets — specific agencies, offices, programs, and people — for lobbying and influence efforts. Leadership Connect maps the relationship graph. OnFrontiers provides former-agency expertise to inform the positioning. Steptoe executes.

Deliverables: Influence target list with rationale, pre-meeting briefings, relationship activation requests, policy/language reclassification pitches at OMB/OFPP level when appropriate.

**Why three gates instead of one:** Federal capture works through multiple channels simultaneously. A pure Gate 1 strategy (public pursuits only) fails when the market is incumbent-captured. A pure Gate 3 strategy (influence only) fails without execution capability. A pure Gate 2 strategy (teaming only) relegates the client to sub-prime dependency forever. Running all three in parallel, informed by the same upstream intelligence, is what creates compounding advantage.

### Stage 5 — Deliverable Suite + Ongoing Operations

Output artifacts and ongoing operation of the twin.

**One-time deliverables (per engagement):**
- SBA SBS Capabilities Narrative (<1K chars)
- Capabilities Statement (trifold + long-form)
- Pitch deck (investor + federal variants)
- Explainer video storyboard
- RFI response template
- Methodology Report — **the $150K-justifying deliverable** that explains how Sunstone arrived at its recommendations, with full audit trail from methodology log

**Ongoing operations:**
- Continuous market monitoring (new opps, new vendors, new codes)
- Quarterly posture review (twin state assessment)
- Quarterly Round 2/3 refresh (keywords, scopes, primes, POCs)
- Gate-level tactical support as needed

**Commercial model:** Initial engagement pricing ($150K Sunstone + $175K/mo Steptoe + referral splits as applicable) converts into subscription continuity for the ongoing operations tier after the first twelve months.

### Stage 1 through Stage 5 at a glance

| Stage | Tool(s) | Output | Handoff |
|---|---|---|---|
| 1. Surface Mirror | External signal analysis (no tools, just research) | Mirror report | → CBP engagement |
| 2. CBP | CBP Builder | Approved profile | → Intelligence Engine |
| 3. Research Engine | Sunstone Intelligence Engine (this platform) | Round 3 Intelligence Package | → Three gates |
| 4.G1 Bottom-Up | Opps Finder → Defined AI → Proposal team | Bids, wins | Ongoing |
| 4.G2 Teaming | Ericson Teaming + OnFrontiers | Sub/JV agreements | Ongoing |
| 4.G3 Influence | Leadership Connect + OnFrontiers + Steptoe execution | Relationship activation, policy change | Ongoing |
| 5. Deliverables | All of the above converge | Methodology Report + client deliverable suite | Subscription continuity |

---

## Section 3 — Research Engine Mechanics (Stage 3 Deep Dive)

This is the most detailed section of the playbook because it describes the platform's core analytical capability.

### 3.A — What the Research Engine Actually Does

The Research Engine takes an approved CBP and produces a full intelligence package for federal market pursuit. It operates in **rounds**:

- **Round 1 — Discovery.** What does the federal market look like for this client? What language does it use? Where are the dollar flows? Who wins what? Are the codes aligned with the work?
- **Round 2 — Targeted.** For the promising scopes/agencies from Round 1, go deep. Agency-specific buying behavior, tribal language, contract vehicles, incumbent mapping.
- **Round 3 — Convergence.** Synthesize everything into actionable intelligence: prime targets, teaming candidates, direct federal clients, top-down POCs, SAM engagement method recommendations.

Each round has **turns** — parallel investigations within the round. A Round 1 Turn 1 might be one NAICS scope; Round 1 Turn 2 might be a different scope or a pivot. Keywords accumulate in a shared bank across turns. The methodology log captures every decision.

**Vocabulary note — Rounds/Turns vs. Tiers.** Two different terms with different meanings:

- **Rounds and Turns** belong to the **client-facing research workflow**. Round 1 Discovery → Round 2 Targeted → Round 3 Convergence. Within each Round, Turns are specific investigations (a CSV upload, a scope combination). This is the unit of work the client understands and pays for. Applies to both research paths.
- **Tiers** belong to the **Vendor Path internal pipeline**. Tier 0 structural fence → Tier 1 name-signal filter → Tier 2 quick-scan analysis → Tier 3 deep analysis → Tier 4 federal history reverse-lookup. This is an implementation funnel the client doesn't need to understand.

The two vocabularies intersect: one complete Vendor Path Tier 0-4 run produces a baseline doppelganger dataset whose Tier 4 federal-history output can then feed a NAICS Path Round 1 Turn 2 (now armed with accurate codes). The Vendor Path feeds back into the NAICS Path. That architectural loop is described in Section 3.C.

### 3.B — The Dual-Path Architecture

A foundational platform insight: **not every client's federal market is discoverable the same way.** Some clients have capabilities the federal government actively buys under clear codes — those map cleanly to NAICS/PSC-based analysis. Other clients have capabilities that are either pre-federal, hidden under mis-coded contracts, or classified under "tribal" language unrelated to their commercial vocabulary — those require an inverted investigation.

The platform supports two research paths for Round 1:

**NAICS Path.** Starts with codes, ends with language.
- Input: Known or inferred NAICS/PSC codes + date range + dollar threshold
- Process: Pull USASpending contracts in fence → extract language patterns → run per-PIID forensic analysis → map tribal vocabulary
- Output: Keyword bank, PIID forensics, tribal dictionary, incumbent analysis

**Vendor Path.** Starts with vendors, reverse-engineers codes.
- Input: Broad structural fence on vendor universe (kept NAICS sectors) + client CBP
- Process: Filter vendor universe to capability doppelgangers → score capability + evidence → pull doppelgangers' federal contract history → reverse-engineer the NAICS/PSC codes and language patterns that describe work like the client's
- Output: Doppelganger list, hidden-market verdict (HIDDEN vs. PRE-COMMERCIAL), revised search scopes for NAICS path

### 3.C — How the Platform Routes (NAICS vs. Vendor)

Three modes are supported:

**Automatic routing via market-maturity probe.** The platform:
1. Queries USASpending with plausible NAICS codes from the CBP
2. If >N relevant contracts exist at reasonable dollar volumes and per-PIID fit scores are healthy → HIGH confidence → NAICS Path
3. If <N contracts, or all contracts score low per-PIID fit, or >X% of phrases come back as PROACTIVE (see Section 3.F) → LOW confidence → Vendor Path

**Manual override via client/advisor signal.** During CBP approval or onboarding, the client or Sunstone team can force a path. Useful when:
- The client already knows their federal market (force NAICS)
- The client is pre-federal and knows they are (force Vendor)
- We want to run both paths for a comprehensive engagement (BOTH — higher cost, higher confidence)

**Mid-engagement pivot.** If a Round 1 NAICS pull produces a "wrong room" diagnosis (Section 3.H), the platform automatically recommends spawning a parallel Round 1 Vendor Path turn. The client can approve or defer.

**The Manifold Labs lesson:** Manifold was initially routed to NAICS Path based on plausible codes (541511/541512/541519). The pull produced 604 phrases across 14,882 records with a MAXIMUM per-PIID fit score of 2/10. Forty-seven phrases came back as PROACTIVE (Manifold's capability vocabulary did not literally appear in the dataset). This is a textbook "wrong room" signal. The engagement correctly pivoted to Vendor Path. This case is now the canonical routing-decision training example.

### 3.D — The NAICS Path in Detail

The NAICS Path is a six-step pipeline:

**Step 1: Record fetch.** Pull all USASpending records matching the NAICS/PSC fence, date range, and dollar threshold. Typical volumes: 5K-50K records per scope.

**Step 2: Batch splitting.** Split into batches of 200 records. Typical session: 50-100 batches.

**Step 3: Haiku extraction (per batch, 8 concurrent).** For each batch, send Haiku the client's CBP + 200 contract descriptions. Ask Haiku to extract 15-30 candidate search keywords — SOW-language phrases that a contracting officer would actually write. For each phrase, Haiku returns: dollar_volume, count (semantic — records Haiku thinks contain the phrase), avg_contract, context, relevance_score (0-10 to client), relevance_rationale.

**Step 4: Merge.** Combine phrases across batches. Same phrase appearing in multiple batches has its counts/dollars summed. Highest relevance wins. Deduplicate case-insensitively.

**Step 5: Noise floor.** Drop phrases appearing in <2 batches unless their aggregate dollar volume is ≥$500K. This eliminates one-off junk while preserving legitimately high-value singletons.

**Step 5.5: Count reconciliation with token matcher.** For each surviving phrase, query the DB with strict token matching (every word of the phrase must literally appear in the description). Overwrite Haiku's semantic count with deterministic count. Phrases with literal count = 0 get flagged as PROACTIVE (Section 3.F). This reconciliation is critical — without it, the displayed count diverges from the count the PIID analysis actually produces.

**Step 6: Per-PIID forensic analysis (on-demand, per phrase).** When the user expands a phrase in the UI, the platform runs Haiku against each matching contract to produce: system interpretation (what is the contract actually for, beyond keyword match), NAICS alignment (0-10), PSC alignment (0-10), per-PIID relevance to client (0-10), vendor intel (cached per UEI — shared across PIIDs).

**The PIID forensic drawer is where the intelligence operation becomes visible.** Each PIID gets a full forensic card with narrative rationale. A human analyst would take 30 minutes per PIID to produce this. The platform does it in 2 seconds at $0.002 cost.

### 3.E — The Vendor Path in Detail (Doppelganger Investigation)

The Vendor Path is a five-tier pipeline:

**Tier 0 — Structural fence (free, instant).** Filter vendor universe by:
- Must have a website (can't analyze otherwise)
- Must fall in kept NAICS sectors (see Section 3.G for the fence logic)
- Not on SAM exclusion list

Starting pool ~300K → after fence ~120K for a sector-appropriate fence.

**Tier 1 — Name-signal filter (free, instant).** Filter by: vendor legal name contains any capability-signal token. Token list is tenant-specific (derived from CBP) but ships with defaults for technology/compute/AI clients. Typical reduction: 120K → 5-15K.

**Tier 2 — Quick-scan capability + evidence analysis (cheap, fast).** For each survivor:
- Fetch homepage + about page (2-3 URLs max)
- Truncate content to first ~2000 tokens
- Haiku analyzes on two axes: capability_score (0-10 similarity to client) AND evidence_score (0-10 confidence based on real proof markers — named case studies, federal past performance, certifications, team credentials, media coverage, testimonials)
- Store in vendor_capability_analysis with tier=2

Typical reduction: 5K-15K → 500-2K with capability_score ≥ 5.

**Tier 3 — Deep analysis on survivors.** For vendors scoring ≥5 on capability:
- Fetch more pages (home, about, products, services, technology, leadership)
- Richer Haiku prompt with capability mapping, differentiation, market positioning, federal posture
- Store with tier=3

Typical reduction: 500-2K → 100-300 true doppelgangers (capability ≥7, evidence varies).

**Tier 4 — Federal history reverse-lookup.** For true doppelgangers:
- Query USASpending by UEI for prime + sub award history
- Cluster the NAICS codes they win under
- Cluster the PSC codes
- Extract language patterns from their contract descriptions
- Identify which agencies they sell to

**Output: Hidden vs. Pre-Commercial Verdict.**
- If doppelgangers have significant federal history → HIDDEN MARKET. The federal market exists; it's just labeled under codes/language we didn't originally search. The reverse-lookup IS the tribal dictionary. Feed these codes/language back to the NAICS Path for Round 2.
- If doppelgangers have no federal history → PRE-COMMERCIAL. Commercial market is real (doppelgangers exist) but federal procurement hasn't caught up yet. Strategy pivots to Gate 3 (Steptoe influence to create the market), OTA/CSO/SBIR vehicles, and direct program-office engagement.
- Mixed → typically signals an emerging market where some doppelgangers have broken through. Study those breakthrough cases — they're the model.

### 3.F — The PROACTIVE Flag and What It Means

The PROACTIVE flag is one of the platform's most valuable diagnostics, and it emerged from a bug fix that revealed something structural about how AI extraction interacts with deterministic search.

**Origin.** In the NAICS Path, Haiku's per-batch extraction is **semantic** — it counts records with "GPU-accelerated compute workloads" toward the "GPU compute" phrase bucket. The PIID forensic analysis uses **strict token matching** — every word of the phrase must literally appear in the description. When these two counts diverge (displayed 15, analyzed 1), users can't trust the numbers.

**The reconciliation step fixes the divergence by overwriting Haiku's semantic count with the deterministic count.** Phrases with literal count = 0 get tagged PROACTIVE.

**What PROACTIVE actually means:** Haiku extracted this phrase because it's relevant to the client's capability (per the CBP), but the phrase does not literally appear in the federal contract data we analyzed. Two interpretations:

1. **Tribal language gap.** The client's commercial vocabulary doesn't match the federal SOW vocabulary for the same work. "Confidential computing" (client language) is "secure enclaves" or "hardware-based isolation" (federal language). The PROACTIVE phrase is a SEARCH TERM, not a statistic.

2. **Genuine market absence.** The capability isn't federally procured under these codes yet. The PROACTIVE phrase IS evidence of pre-commercial status.

**What to do with a PROACTIVE phrase:**
- **Do not** use as a filter criterion in Opps Finder (will match nothing)
- **Do** use as a search term in commercial databases and federal adjacent channels (SBIR, OTA, CSO solicitations often use emerging language)
- **Do** feed into Vendor Path as a signal to search for doppelgangers using this exact term
- **Do** include in the client deliverable as "federal market gap" intelligence

**When a phrase cluster is ALL proactive:** The client's entire capability vocabulary is absent from the federal data. This is the "wrong room" signal (Section 3.H). Route to Vendor Path.

### 3.G — The Trap Phrase Pattern

A trap phrase is a phrase that looks perfect on surface analysis but costs money to pursue. The Manifold engagement surfaced the canonical example: **"AI infrastructure."**

Pattern signature:
- Relevance score: 10/10 (perfect capability match)
- Count: high (84 contracts)
- Dollar volume: huge ($302M)
- Per-PIID forensic scores: uniformly low (1-2/10)
- Awardees: traditional federal primes (Booz, GDIT, IBM, Deloitte) — NOT doppelgangers

What it means: The phrase is a **boundary object** — multiple communities use it to mean different things. The federal buyers in this market mean something different by "AI infrastructure" than the client does. The phrase has been captured by incumbents who have defined its meaning in their favor. Pursuing these contracts via public bidding means:
- Losing to Booz every time
- Spending proposal capital on dead-end pursuits
- Potentially damaging the client's federal past performance via losses

**Detection rule:** If a phrase has relevance ≥7, count ≥10, and average per-PIID relevance score ≤3, flag as trap.

**What to do with a trap phrase:**
- Mark in keyword bank with visible trap indicator
- Do NOT export to Opps Finder as a search term
- Use for agency-level intel (which agencies use this language means)
- Use as a teaming signal (the primes winning trap-phrase contracts are potential teaming partners — the client supplies the specialty layer inside their "AI infrastructure" prime contract)
- Use for Gate 3 influence (argue for code/language reclassification at OMB level)

**The "wrong room" diagnostic emerges when most or all high-relevance phrases are trap phrases.** That's a structural signal to pivot paths.

### 3.H — Wrong Room Diagnosis

A "wrong room" diagnosis is not a failure. It's a successful finding that saves the client months of mis-directed effort.

**Signature:**
- Max per-PIID forensic score across all analyzed phrases is ≤3
- >30% of surviving phrases flagged PROACTIVE
- Top phrases by $ volume are all trap phrases (Section 3.G)
- Vendor distribution is dominated by traditional federal primes, not capability doppelgangers

**Interpretation:** The NAICS/PSC scope searched does not contain the client's federal market. The market exists somewhere else — different codes, different vehicles, different language.

**What to do:**
1. Surface the diagnosis as a first-class finding (NOT a silent low-scoring report)
2. Platform auto-recommends next scopes based on CBP + industry heuristics
3. Platform auto-proposes Vendor Path as an alternative route
4. Client approves next turn or Vendor Path pivot
5. Methodology log captures the wrong-room finding as a successful diagnosis

**The client deliverable language:**

> *"Round 1 Turn 1 analyzed 14,882 federal contracts across $32.1B in obligated spending through 2026-04-22. The analysis conclusively shows your capability — decentralized GPU compute with confidential computing primitives — does not exist in traditional federal IT services procurement (NAICS 541511/541512/541519). Forty-seven phrases describing your capability returned zero literal matches in the data. The phrases that did appear with high volume (like 'AI infrastructure') are captured by incumbents who mean something different by that language than you do. This is a strategic finding, not an analytical failure: pursuing public bids in this market would result in 80+ losing proposals against incumbents with 5-10× your federal past performance history. The recommended pivot is [Vendor Path analysis / SBIR-STTR vehicles / Gate 3 dominant strategy / specific agency direct-engagement at DARPA/CDAO/DOE labs]."*

This is a $500K engagement output. Deloitte would have spent 300 hours producing a list of 50 opportunities in 541511 that the client would have bid and lost. We saved them proposal capital + gave them the correct strategy.

### 3.I — The Capability × Evidence Matrix

In Vendor Path analysis, every vendor gets scored on two independent axes:

**Capability (0-10):** How similar are the vendor's stated capabilities to the client's?

**Evidence (0-10):** How strongly proven are those claims?

Evidence scoring looks for:
- Named case studies with specific outcomes (+3)
- Third-party attestations (testimonials, reviews, certifications) (+2)
- Federal past performance explicitly named (+2)
- Team bios with domain credentials (+1)
- Media coverage / industry recognition (+1)
- Marketing-only, no proof markers (0-2 cap)

**Evidence citations** — Haiku returns direct quotes from the page that support the score. Makes hallucination much harder.

**The 2D matrix produces seven doppelganger tiers:**

| | High Evidence (≥7) | Medium Evidence (4-6) | Low Evidence (<4) |
|---|---|---|---|
| **High Cap (≥8)** | TRUE DOPPELGANGER — deep analysis, reverse-lookup | UNPROVEN DOPPELGANGER — check USASpending for federal history; if present, promote | LOUD CLAIMANT — skeptical, deprioritize |
| **Mid Cap (5-7)** | PROVEN ADJACENT — potential teaming partner | ADJACENT CAPABILITY — watchlist | INCONCLUSIVE — archive |
| **Low Cap (<5)** | WELL-RUN BUT IRRELEVANT — kill | FALSE POSITIVE — kill | FALSE POSITIVE — kill |

**Why dual scoring matters:** A website can claim anything. The evidence layer separates aspiration from delivery. A vendor with capability 9 and evidence 2 is a loud marketing claim, not a real doppelganger. A vendor with capability 8 and evidence 9 is exactly who the client needs to study, team with, or compete against.

### 3.J — Keyword Bank

Every phrase the user selects during Round 1 review gets saved to the **keyword bank** — the tenant's curated list of search terms with full provenance (which scope, which session, which round, which turn, which selection date, which relevance rationale).

The keyword bank is the **output API** that feeds downstream tools:
- Opps Finder reads the bank to filter live opportunities
- Defined AI Go/No-Go uses bank phrases as fit criteria weights
- Ericson Teaming uses the bank to find partners with matching capability descriptions

Keywords in the bank can be tagged with flags:
- PROACTIVE (tribal language signal)
- TRAP (high relevance but incumbent-captured — do NOT filter on this)
- CORE (highest-confidence keywords — filter strongly on these)
- ADJACENT (include for teaming searches, not for client direct-pursuit)

The bank is the bridge between Stage 3 intelligence and Stage 4 execution.

---

## Section 4 — Intelligence Layers

Three external systems integrate as intelligence amplifiers across every stage.

### HigherGov — Opportunity Data

**Role:** Continuous feed of federal opportunity data. More comprehensive than SAM alone. Captures Forecasts, Presolicitations, Sources Sought, Industry Days, RFIs — the early-signal opportunities that SAM doesn't always surface clearly.

**Where it integrates:**
- Stage 1: External signal source for mirror report
- Stage 3 Round 1: Fuels the scope-based opportunity pulls as alternative to direct USASpending queries
- Stage 4 Gate 1: Opps Finder uses HigherGov as primary data source
- Stage 5 ongoing operations: Daily monitoring for new opportunities matching client bank

### Leadership Connect — Relationship Intelligence

**Role:** Verified government contact data, organizational charts, relationship maps, legislative tracking.

**Specific value:**
- Org charts for every federal agency (who holds which role, reports-to structure)
- Relationship maps (Steptoe partner X has DOJ career history 2012-2017 = viable path to current DOJ role Y)
- Contact info for named decision-makers
- Recent org changes and transitions

**Where it integrates:**
- Stage 3 Round 3: Top-Down POC identification — LC surfaces specific names at target agencies
- Stage 4 Gate 3: War room relationship graph — who in the alliance (Steptoe + Life Force + client's own network) has the shortest path to each target
- Stage 4 Gate 2: Team composition intel — who's at which prime, what are their backgrounds

**Example:** During the FBI BAA DJF-23-1200 investigation, Leadership Connect surfaced that Steptoe has 20+ partners with DOJ career history, with multiple viable paths to FBI leadership through shared career overlap. Key node identified: Jolene Lauria (CJIS Advisory Policy Board) appears as a "both attended" or "both worked" node across ~10 Steptoe partners. That level of relationship map is what turns the Steptoe alliance from a brochure promise into an actionable capture plan.

### OnFrontiers — Vetted SME Network

**Role:** On-demand access to 17,000+ vetted federal subject matter experts. Former CO's, SES, program managers, technical leads, GS-14/15, retired military. Credit-based or hourly consultation model.

**Specific value:**
- Ground-truth intelligence on specific programs, agencies, incumbents
- Former-insider perspectives that shape proposal positioning
- OCI-cleared so engagements don't create conflicts
- Typical rate: $250-$500/hr, credit-based packages available

**Where it integrates:**
- Stage 3 Round 3: Pre-pursuit briefings from domain experts
- Stage 4 Gate 1: "Get expert eyes on this PIID" — pre-composed request from PIID forensic data
- Stage 4 Gate 2: Inside view on incumbent behavior, CO preferences
- Stage 4 Gate 3: Program-office tribal knowledge to inform Steptoe engagement

**Example:** During the FBI BAA pursuit, OnFrontiers surfaced Margaret "Peggy" Buckley — 25+ years federal, including FBI Section Chief, with recent (2018-2023) FBI IMD/OCIO modernization consulting experience via Deloitte. She's exactly the expert who can tell you how to write a competitive BAA response. The platform surfaces this match automatically from the opportunity + capability context.

---

## Section 5 — The Ecosystem

Six tools, each with a specialized role, all reading from and writing to a shared data model.

### The Six Tools

| Tool | URL | Role | Data direction |
|---|---|---|---|
| **CBP Builder** | `comprehensivebusinessprofile.abacusai.app` | Build client profile from sources | Writes to Sunstone |
| **SAM Scorecard** | `sam.govconaccelerator.co` | Federal readiness assessment | Reads + writes Sunstone |
| **Sunstone Intelligence Engine** | `sunstoneplatform.netlify.app` | Research Engine (Stage 3) | Canonical store |
| **Opps Finder** | `opportunitypipelinegca.lovable.app` | Live opportunity surfacing | Reads keyword bank, writes interactions |
| **Defined AI Fed Opps** | `definedaifedopps.com` | Go/No-Go deep analysis | Reads profile + bank, writes decisions |
| **Ericson Teaming** | `ericsonteaming.com` | Teaming partner discovery | Reads prime targets, writes engagements |

### The Shared Nervous System

Sunstone Intelligence Engine holds the **canonical data model**:
- Tenant profiles (commercial profile, strategic profile, synthesized text)
- Keyword bank (tagged by round, scope, session)
- PIID forensic analyses
- Vendor capability analyses (Vendor Path output)
- Methodology log (every action, every decision)
- Research route decisions (NAICS vs. Vendor path per round)

Other tools either read from this canonical store or write back to it:
- CBP Builder writes the approved profile
- SAM Scorecard writes the readiness score
- Opps Finder reads the keyword bank + writes which opps were clicked
- Defined AI Go/No-Go reads everything upstream + writes the decision + capture memo
- Ericson Teaming reads prime targets + writes teaming engagements

### The Methodology Log as Nervous System

Every significant event across every tool writes to the methodology log:

| Event type | Source tool | Captured |
|---|---|---|
| `profile_ingested` | CBP Builder | Sources used, dates, client approval |
| `readiness_scored` | SAM Scorecard | Score, component breakdown |
| `framework_generated` | Sunstone IE | Prompt version, PSC/NAICS reference counts |
| `strategic_profile_committed` | Sunstone IE | Client approval, version |
| `scopes_generated` | Sunstone IE | Scope count, correlation scores |
| `session_uploaded` | Sunstone IE | File, record count, NAICS/PSC/date/threshold |
| `analysis_started` / `analysis_complete` | Sunstone IE | Runtime, batches, phrase counts |
| `reconciliation_complete` | Sunstone IE | Proactive count, trap-phrase count |
| `piid_analyzed` | Sunstone IE | PIID, scores, rationale |
| `vendor_analyzed` | Sunstone IE (Vendor Path) | Vendor UEI, tier, cap + evidence scores |
| `keyword_saved_to_bank` | Sunstone IE | Phrase, round, scope, rationale |
| `route_decided` | Sunstone IE | NAICS / VENDOR / BOTH, rationale, signals |
| `opportunity_viewed` | Opps Finder | Opp ID, user, timestamp |
| `opportunity_analyzed` | Defined AI | Opp ID, go/no-go, rationale |
| `expert_requested` | OnFrontiers | Context, match, decision |
| `teaming_engagement` | Ericson | Partner, stage, outcome |
| `influence_activation` | Gate 3 | Target, Steptoe partner, action |

This unified log is the foundation of the Methodology Report — the client-facing document that explains, with full traceability, how the engagement produced its recommendations.

### Why This Architecture Works

**Organisms with shared nervous system.** Each tool specializes in what it does best (a CRM-like tool tries to do everything; our tools each do one thing well). They share the client data model so context flows automatically. They share the methodology log so the audit trail is complete. The client never experiences handoffs — they experience one coherent system.

**Upgrade path preserved.** Each tool can be independently upgraded, replaced, or rebuilt without breaking the ecosystem. If Ericson Teaming gets obsoleted, we swap in a replacement that reads the same data model. If SAM Scorecard becomes a Sunstone-native feature, we migrate and retire the standalone.

**Data ownership is Sunstone's.** The canonical model lives in our database. Other tools are participants, not gatekeepers. This is a commercial advantage as well as an architectural one.

---

## Section 6 — Design Decisions (and the Reasoning Behind Them)

These are non-obvious decisions made during platform development, with the reasoning preserved so future maintenance doesn't regress.

### Why token-based matching, not literal substring

Original implementation used PostgreSQL `ilike '%phrase%'` — requires the exact literal substring. Caused the PIID analysis count to badly underfetch vs. the displayed count (Haiku's semantic count caught fuzzy matches that literal substring missed). Fixed by switching to token-based: every token of the phrase must appear somewhere in the description, case-insensitive, any order. Matches the semantic intent without requiring full Claude re-analysis.

Trade-off accepted: occasional spurious match where all tokens appear but not as a coherent phrase. The per-PIID relevance scoring catches these and assigns low scores, so the noise is bounded.

### Why reconciliation between semantic and deterministic counts

After switching to token matching, displayed counts (semantic, from Haiku aggregation) still diverged from analyzable counts (deterministic, from token matcher) — just in the opposite direction. Confidential computing: Haiku counted 4, token matcher found 0.

Reconciliation step overwrites Haiku's semantic count with the deterministic count, so the displayed number IS the number the analysis produces. Phrases with deterministic count 0 but relevant to client get the PROACTIVE flag. No more user surprise. Deterministic count IS the count.

### Why lazy PIID analysis over eager

First design was eager — run PIID analysis automatically after keyword analysis for all phrases, all PIIDs. Cost estimate for a 14K record session: ~$7 and 12+ minutes on top of the 45-second keyword analysis. Decided to go lazy — expand-on-demand — because:

1. User controls cost per-phrase
2. Iteration is cheap during development (expensive bugs are ~15 sec each, not 15 min)
3. Most phrases never get expanded
4. PIID analysis is valuable per-phrase, not in aggregate

Eager mode is deferred for future — post-ship of lazy mode, after the output quality is validated, we can add an eager toggle for "analyze everything in this round" batch runs. Not a first-ship feature.

### Why PROACTIVE badge exists

See Section 3.F for full treatment. Short version: removing it would mean users can't tell the difference between "we found 4 contracts matching this phrase" and "Claude suggested this phrase is relevant to your capability but it's not literally in the data." Those are wildly different claims. The badge preserves honesty in the UI.

### Why dual-axis capability/evidence scoring (Vendor Path)

Single-axis capability scoring treats a loud marketing website the same as a proven vendor with named case studies. The dual-axis separates aspiration from delivery. A vendor with capability 9, evidence 2 is a loud claim. A vendor with capability 8, evidence 9 is a real competitor or teaming candidate. Seven-tier doppelganger classification gives downstream workflow nuance.

Also serves the hidden-vs-pre-commercial verdict: pre-commercial markets are characterized by many capability-high-evidence-low vendors (aspirational stage). Mature markets are characterized by more evidence-high vendors with proven federal delivery.

### Why the CBP approval gate is hard (not soft)

Early versions considered letting clients skip CBP approval to accelerate time-to-value. Decided against because:

1. Without approval, downstream recommendations are vulnerable to "we never agreed the profile was correct"
2. Commitment lever: clients who edit thoughtfully become partners; clients who rubber-stamp signal future problems
3. Data quality: garbage profile = garbage analysis; fixing late is expensive

Non-negotiable for any engagement at any price point.

### Why NAICS/PSC reference tables were seeded

Early prompts used Claude's training-data knowledge of NAICS/PSC codes. Result: Claude suggested D3xx/7030 PSC codes (retired from the GSA April 2025 PSC Manual). Fixed by seeding authoritative reference tables (2,540 active PSC codes + 1,012 2022 NAICS codes) and grounding every prompt in them. Prompt template versioning tracks which prompt version produced which framework, so stale outputs can be invalidated.

### Why methodology_log ingests events from every tool

Client deliverable: the Methodology Report. Justification for the price. Only works if every decision across the engagement has a traceable audit trail in one place. Methodology log is that place. Must be populated by every tool, not just Sunstone. Cross-tool event writing is a Phase 2 platform build.

### Why the research_route table exists as a first-class entity

Early thinking treated NAICS vs. Vendor path choice as a runtime toggle. Testing with Manifold surfaced that the choice is a **strategic decision** — it deserves its own audit trail, rationale, signals, and outcome tracking. Dedicating a table makes the routing decision visible in the methodology log, enables mid-engagement pivots with full history, and supports future ML-driven routing refinement based on accumulated outcomes.

---

## Section 7 — Playbook in Practice

Synthesizing the above into a working engagement template.

### Canonical Engagement Flow

**Week 0 — Prospect Development**

- Stage 1 Mirror Report delivered to prospect (pre-engagement, no cost, no commitment)
- Sunstone + Steptoe + Life Force intro call
- Engagement agreement signed (typical structure: Sunstone Foundation $150K + Steptoe $175K/month + alliance fees)

**Week 1 — CBP**

- CBP Builder session with client (working session, not just form-fill)
- Sources compiled: website, LinkedIn, press, capability statements, SAM registration, federal past performance, investor materials, customer case studies
- Profile synthesized with citations
- Client review and editing cycle (~3-5 days)
- CBP approval → commitment lever pulled

**Week 2 — Stage 3 Round 1**

- Platform probes market maturity → routes NAICS or Vendor Path (or BOTH)
- Round 1 executes: scopes, extractions, reconciliation, keyword bank
- Per-PIID forensics on priority phrases
- Round 1 findings presentation to client (what did we learn, what's next)

**Week 3-4 — Stage 3 Round 2 & Round 3**

- Round 2: agency-specific targeting from Round 1 keyword bank + tribal language mapping
- Round 3: prime targets, teaming candidates, direct federal clients, top-down POCs, SAM engagement method recommendations
- Intelligence package delivered to client
- Three-gate activation plan presented

**Week 5+ — Stage 4 Execution**

- Gate 1 (Bottom-up): Opps Finder + Go/No-Go monitoring, first pursuits selected
- Gate 2 (Teaming): Ericson Teaming engagements initiated
- Gate 3 (Influence): Steptoe + Flynn war room active, primary targets engaged
- OnFrontiers consultations triggered as needed per gate
- Leadership Connect relationship activation

**Ongoing — Stage 5**

- Quarterly posture review
- Methodology Report generation (first version at week 12)
- Deliverable suite completion
- Transition to subscription continuity after 12 months

### Common Patterns and Their Playbook Responses

**Pattern: "Wrong room" Round 1 diagnosis**
Response: Surface finding, pivot to Vendor Path, reset client expectations, reposition the engagement toward the Gate 3-dominant strategy the diagnosis implies. This is not a failure, it's the highest-value finding.

**Pattern: Trap phrase dominates top relevance results**
Response: Flag trap phrases, exclude from client-facing keyword bank filter, use for teaming-target analysis instead, and consider Gate 3 influence play to force code reclassification.

**Pattern: All high-relevance phrases return as PROACTIVE**
Response: Strong signal of tribal language gap. Route to Vendor Path immediately. Don't waste further NAICS-Path cycles.

**Pattern: Strong Round 1 fit, clear primes, high dollar flows**
Response: Execute standard three-gate activation. Gate 1 gets proportionally more weight. Steptoe focuses on agency-level relationship rather than lobbying.

**Pattern: Mid-range Round 1 fit with some good PIIDs and some wrong-room signals**
Response: Dual-path approach — continue NAICS-based tactical pursuit of the good PIIDs while running Vendor Path to diagnose what's missing. Common outcome.

**Pattern: Client has prior federal past performance in the space**
Response: Weight Round 3 top-down POC identification toward agencies/programs the client has existing relationships with. Leadership Connect surfaces those paths.

**Pattern: Client is pre-federal**
Response: Vendor Path first. If PRE-COMMERCIAL verdict, Gate 3 dominant with Steptoe market-creation play. If HIDDEN verdict, pivot back to NAICS Path with newly-discovered codes. In both cases, SBIR/STTR and OTA vehicles get early attention — those are the paths by which pre-federal capabilities enter federal procurement.

### When to Pivot vs. Hold

Pivot triggers (strong):
- Wrong-room diagnosis (Section 3.H)
- Trap phrase dominance (Section 3.G)
- Capability-doppelganger reverse-lookup shows market concentrated at agencies we haven't explored
- Client priority shift (new buyer discovered, new capability emphasis)

Hold triggers (strong):
- Round 1 shows real per-PIID fit at 7+ scores with identifiable primes
- Clear tribal dictionary emerges from NAICS Path
- Client has existing federal relationships aligned with Round 1 findings
- Gate 3 has active traction (Steptoe movement) — don't disrupt

Mixed or ambiguous signals: Default to continuing but adding investigative depth. Cheap to add a Round 2 turn; expensive to pivot mid-Gate-3.

### Client Report Structure Template

Every engagement produces **three audience-tuned reports from the same source data**:

- **The CEO Report** — strategic narrative for executive decision-makers (4-8 pages)
- **The Federal BD Report** — operational playbook for capture/BD operators (15-25 pages)
- **The Engineering Report** — technical deep-dive with full data and methodology (20-40 pages with appendices)

Each is a complete deliverable suited to its audience. The CEO doesn't read the Engineering Report. The engineer doesn't read the CEO Report. The BD operator doesn't read either — they want a working playbook with target lists, agency-specific intelligence, and 30/60/90 day actions.

The same source synthesis artifacts feed all three. View generators produce each audience-specific output from the shared source. Update findings once, regenerate all three. New audience needed in the future (Steptoe Brief, Investor Update)? Add a new generator. The architecture scales.

### The Source-of-Truth Layer: Synthesis Artifacts

Every major analytical milestone produces a written synthesis artifact at the time the analysis happens. These are the raw source-of-truth documents — captured while context is fresh, before they get lost in chat history. The audience reports are composed from these.

Examples per engagement:

- *synthesis_round_1_diagnosis.md* — Round 1 NAICS Path findings (e.g., wrong-room diagnosis)
- *synthesis_tier_2_findings.md* — Vendor Path Tier 2 scan results (e.g., the Manifold "Pre-Commercial Market signal")
- *synthesis_tier_4_market_verdict.md* — Hidden vs. Pre-Commercial verdict from Tier 4 federal history reverse-lookup
- *synthesis_round_2_targeted.md* — agency-specific deep findings
- *synthesis_round_3_intelligence.md* — converged intelligence package
- *synthesis_gate_3_lobbying_strategy.md* — Steptoe war-room targeting

Each synthesis is 5-15 pages of substantive analytical prose. Each cites its source data (vendor counts, PIID identifiers, score distributions, etc.). Stored at `/syntheses/<tenant>/YYYY-MM-DD_<milestone>.md`.

### Visual Identity for the Three Reports

Each report has a persona icon used on covers, page headers, in-platform deliverable cards, and the future Methodology tab. The three icons share a visual grammar — same gray silhouette base, same Sunstone-orange accent, same head-and-shoulders crop — so they read as a coherent set. The accent color matches `var(--color-accent)` in the platform UI, so icons feel native.

Icons live at `/public/report-icons/`:
- `ceo-icon.png` — suit and tie silhouette (executive/decision-maker)
- `federal-bd-icon.png` — blazer with subtle insignia (procurement/government professional)
- `engineering-icon.png` — glasses and gear-pin silhouette (technical lead)
- `three-audiences-source.png` — original source image, all three together (used for marketing collateral, deliverable suite covers)

Future enhancements: SVG vector versions for crisp PDF embedding at any size; size variants (icon-sm, icon-md, icon-lg) for different surfaces.

### The CEO Report (4-8 pages)

For: founders, CEOs, board members, investors. Decision-makers at the engagement budget level.

Structure:

1. **One-page BLUF** — single paragraph + 3 bullet decisions
2. **The Strategic Story** — 3-4 pages narrative of what we found and what it means
3. **Capital Allocation Implications** — where to spend, where to cut, where to grow
4. **The Asks** — specific commitments needed from leadership (budget, hires, board sign-off, advisor activation)
5. **Risk and Confidence** — what could be wrong, how confident we are, what would change the verdict

Tone: confident, narrative, decisive. Big claims backed by single-line proofs. Reads on a flight. Fits in a board packet.

### The Federal BD Report (15-25 pages)

For: VP BD, Federal Sales Lead, Capture Manager. Operators who run pursuit. Often former government employees. Read SAM.gov daily. Have won federal contracts.

Structure:

1. **The Pursuit Pipeline** — specific opportunities, ranked, with go/no-go signals
2. **The Target Map** — agencies/offices/programs/COs with relationship paths
3. **The Teaming Playbook** — specific primes, sub-letter templates, value-prop one-pagers
4. **The Influence Plan** — Gate 3 targets for Steptoe with primary/secondary/tertiary tiers
5. **The 30/60/90 Day Action Plan** — what to do this month, next month, next quarter
6. **The Tribal Dictionary** — agency-specific language, code conventions, buying preferences
7. **The Substitution Map** — which vendors currently get the work, how to displace or sub-to

Tone: operational, specific, tactical. Tables of agencies/PIIDs/dollar volumes/expiring dates. Named contracting officers. Pre-drafted teaming letters and intro requests. A working document that gets marked up during pursuit reviews.

### The Engineering Report (20-40 pages with appendices)

For: CTO, Chief Architect, Lead Engineer, Technical Co-Founder. Built the actual product. Skeptical of marketing claims. Wants raw data and reasoning.

Structure:

1. **The Technical Landscape Map** — what competitors actually do, architectures, tech stacks, deltas
2. **The Methodology Mechanics** — every analytical pipeline, every prompt, every data source
3. **The Raw Findings Tables** — top-N rankings with full Haiku rationales, score distributions, fetch error rates, confidence calibrations
4. **The Capability Mapping** — technical features → federal needs → existing solutions → client differentiation
5. **The Federal Tribal Translation** — technical terms ↔ SOW language ↔ NAICS codes
6. **Limitations and Honest Disclosures** — what the analysis can't tell us, where we're guessing, where confidence is high vs. low
7. **Appendices** — full vendor tables, prompt texts, data source descriptions, schema documentation, audit log excerpts

Tone: forensic, technical, transparent. Includes raw rationales. Shows the analytical pipeline. Discusses limitations honestly. Reference document, not bedtime reading.

### View Generator Architecture

Each milestone produces ONE source synthesis artifact. Each audience report is composed by a view generator that reads the source(s):

```
syntheses/manifold/2026-04-25_tier_2_findings.md       (source-of-truth)
       │
       ├─→ composeCEOReport(syntheses) ─────→ CEO_Report.pdf
       ├─→ composeFederalBDReport(syntheses) → BD_Report.pdf  
       └─→ composeEngineeringReport(syntheses) → Engineering_Report.pdf
```

Code lives at `src/lib/composeReport.ts` with audience as a parameter, or three separate files (`composeCEO.ts`, `composeBD.ts`, `composeEng.ts`) for clarity. Each takes the synthesis artifacts plus engagement metadata and produces the audience-specific deliverable.

Regeneration is cheap. Client returns 3 months later asking for an updated CEO Report? Re-run the generator on existing synthesis artifacts. New synthesis from a Tier 4 follow-up? Generators consume the new artifact alongside existing ones and re-output all three reports.

### The Deliverable Suite (separate from the three reports)

In addition to the three reports, every engagement produces:

- Capabilities statement (trifold + long-form)
- SBA SBS Capabilities Narrative
- Pitch deck
- Explainer video storyboard
- RFI response template
- One-pagers per differentiator

---

## Section 8 — Roadmap: Solicitation-Side Intelligence (Planned)

This section is forward-looking. It describes capability the platform does not yet have, but which will move Sunstone from "federal market analysis" to "federal capture operating system with forecasting." The design below is captured at v1.0 time so that future implementation preserves the vision.

Once the Round 1/2/3 intelligence pipeline matures, three additional analytical layers will be added, each building on the previous.

### 8.A — Analysis #1: Solicitation Source Intelligence

**The insight:** SAM.gov is one of about a dozen federal procurement posting venues. For many kinds of work, SAM is not the primary venue. A client watching only SAM sees 40-60% of their market — the rest flows through NITAAC, eBuy, SEWP, CIO-SP4, OTA consortiums (Tradewinds, DIU, NSC), agency-specific portals, and GSA Schedule task-order channels.

**What the platform does:**

For every PIID in the analyzed set, determine:
1. Was this award competitively solicited at all? (USASpending `extent_competed` field)
2. If solicited, where was the solicitation posted?
3. If on SAM — what notice type and when in the lifecycle?
4. If elsewhere — which specific portal/consortium/vehicle?

**Deliverable to client:** Posting-venue map. "In your analyzed market, 42% of awards were solicited on SAM, 23% on NITAAC, 18% through Tradewinds OTA, 11% on eBuy task orders, 6% sole-source. Your current SAM-only monitoring covers 42% of visible market. The other 58% requires separate monitoring infrastructure."

This alone is worth the engagement. Nobody tells clients this.

### 8.B — Analysis #2: SOW Extraction and Multi-Dimensional Enrichment

**The insight:** USASpending contract descriptions are 200-character agency shorthand. They don't describe the actual work. The SOW (or PWS/SOO) describes the actual work — often 40-200 pages of specifications. If we can pull every SOW and extract structured intelligence from it, we go from 200-character line items to forensic-grade intelligence dossiers.

**What the platform does:**

For every PIID:

1. **Acquire the SOW document.** From SAM attachments API where available, from other venue APIs where applicable, from mod documents as fallback.
2. **Extract structured intelligence via Haiku/Sonnet.** Schema: technical requirements, deliverables, evaluation criteria, period of performance, dollar sizing, incumbent commentary, security requirements (clearance/CMMC/FedRAMP), performance metrics, small business plan, technologies mentioned, key personnel, program office, CO contact.
3. **Cross-reference enrichment.** Join SOW extraction with vendor_intel (who won and why they matched), LC data (who at the agency), PSC/NAICS reference (was classification correct given actual SOW content?), market pattern comparison (this SOW vs. 500 others in same program).
4. **Cache in piid_sow_extracted table** with JSONB for flexible schema evolution.

**What this unlocks:**

- Keyword extraction moves from description-based (~500 phrases/batch) to SOW-based (~5,000 phrases/batch)
- Teaming analysis becomes real — SOW tells you what specialties the prime needs
- Go/No-Go gets real — fit scoring against full requirements doc instead of 200-character blurb
- Capture positioning gets real — read 20 past SOWs from a CO and the tribal vocabulary surfaces definitively
- Methodology Report gains authority: "analyzed 14,882 SOWs, extracted 500,000+ distinct requirement statements"

**This is the foundation for Analysis #3.** Cannot do predictive modeling on solicitation language without SOW-level corpus.

### 8.C — Analysis #3: Predictive Solicitation Modeling

**The insight:** Once we have historical solicitation data (title, notice type, posting date, SOW, outcome) across thousands of competitions per agency, we can predict:

1. **Language patterns.** How does each agency title this type of work? What phrases do they consistently use? What's the tribal dialect?
2. **Notice-type sequences.** Does the agency go straight to RFP, or do they Sources Sought → RFI → Presolicitation → RFP? What's the typical cadence?
3. **Timing patterns.** How often does this agency post this type of work? 3-year cycles? Continuous BAA? Annual?
4. **Lead time patterns.** From Sources Sought to award, what's the typical timeline?
5. **Next-posting prediction.** When is the next likely solicitation in this cluster, with probability distribution?

**What the platform does:**

1. **Build historical corpus.** Ingest 5 years of SAM.gov + other venue solicitations, link to USASpending award outcomes. Table: `solicitation_history` keyed by PIID with full metadata.
2. **Per-agency pattern extraction.** Cluster historical solicitations by capability within each agency. For each cluster, compute notice-type sequences, typical lead times, cadence, title variation patterns.
3. **Predictive model per cluster.** Fit model on time-since-last-posting, seasonality, budget-cycle alignment. Output: probability distribution over "when is the next posting."
4. **Language prediction.** For each cluster, identify the tribal dictionary — title conventions, required phrases, characteristic phrases. When client targets work at an agency, return the specific vocabulary to use in capability statements and responses.
5. **Forecast delivery.** Client sees forward-looking solicitation forecasts per target agency. "DISA will likely post 4 solicitations in next 6 months matching your capability. Three Sources Sought, one RFP. RFP is for a $30-50M vehicle, typically 14 bidders, last recompete went to Leidos."

**Competitive moat:** Deltek, Bloomberg Government, and GovWin have historical opportunity data. None of them do predictive modeling on language + timing dimensions combined. This would be the first genuinely predictive federal capture platform.

### 8.D — Analysis #4: Cross-Tribe Vocabulary Mapping AND Per-Tribe DNA Sequencing

**The insight:** Each federal agency tribe has its own dialect for the same underlying capability. USDA calls it "secure enclave services" and codes it under NAICS 518210 + a family of PSCs (R702, R799, DB10, DA10, DB01, DC10, DK01, DA01 — eight different classifications even within ONE agency tribe). Census Bureau calls the same thing "FSRDC" (Federal Statistical Research Data Center) and uses entirely different procurement structures. DoD uses "trusted execution environment" or "trusted compute" with classified-environment vehicles. NIH may call it "trusted research environment." Treasury and IRS have their own language for restricted-data computing.

**No single NAICS/PSC combination represents the federal market for any given capability.** The market is fragmented across agency tribes, each with its own classification, vehicle, and procurement language. **Even within ONE tribe, the PSCs vary by sub-agency** (USDA ARS uses different PSCs than USDA NASS, even for similar work).

**The methodological correction this enforces:** The platform cannot treat one agency's codes as universal. Round 1 of every engagement must explicitly avoid the trap of "we found the right codes" — it must instead produce a per-tribe map showing how each agency procures the client's capability.

### Per-Tribe DNA Sequencing — The Architectural Shift

The DNA Strand concept (compounding signals into a compact representation of "what this market looks like") **must be scoped per tribe, not per engagement.**

Each tribe has its own:
- Code patterns (the specific NAICS/PSC combinations it uses)
- Keyword vocabulary (its dialect)
- Vendor base (the contractors it routinely uses)
- Work descriptions (its SOW conventions)
- POCs (its program office personnel)
- Vehicle preferences (Alliant II vs. agency-specific vs. open)
- Award patterns (what % gets awarded vs. canceled, average dollar size, recompete cadence)

When these compound INSIDE a tribe, you get a **per-tribe DNA strand** — a compact representation of how that tribe procures the client's capability.

**The engagement-level question** ("where does the client's federal market live?") **is really N sub-questions**, one per tribe. Each sub-question has its own DNA strand answering it.

**Cross-tribe similarity becomes a first-class analytic.** Once two tribes have DNA strands, the platform can show: "USDA tribe DNA is 73% similar to Census tribe DNA, 41% similar to NIH tribe, 12% similar to DARPA tribe." That tells the client: after cracking USDA, Census is the next-most-accessible tribe. After NIH, DoD is harder. The cross-tribe similarity matrix becomes the engagement's strategic compass.

**Vendors that appear in multiple tribe DNAs become high-priority teaming targets.** If Coleridge Initiative shows up in both USDA NASS DNA AND Census Bureau DNA AND NIH DNA, Coleridge Initiative is a vendor uniquely positioned across statistical agency procurement. They're either Manifold's biggest competitor or Manifold's biggest teaming target — either way, critical intel.

### Schema Implications

The current data model is engagement-scoped. The new model needs:

```
engagement
  └── engagement_tribes (many per engagement)
        ├── tribe_name (e.g., "USDA NASS", "Census Bureau", "DARPA")
        ├── dialect_terms (the agency-specific vocabulary)
        ├── observed_codes (NAICS + PSC combinations used)
        ├── observed_vendors (with frequency counts)
        ├── observed_pocs (named contracting officers, program managers)
        ├── observed_vehicles (Alliant II, MAS, agency-specific, etc.)
        ├── dna_strand (compact representation of the above)
        └── confidence_score (how complete is this tribe's DNA?)
```

The DNA Strand tab on the platform shifts from "show me the engagement's DNA" to "show me each tribe's DNA, plus the cross-tribe similarity matrix."

**What the platform does:**

For each engagement, after Round 1 / Vendor Path / Solicitation analysis surface initial findings:

1. **Build the per-tribe target list.** Identify all agencies that plausibly have demand for the client's capability.
2. **Run agency-specific dialect searches.** For each agency, search its solicitation history using vocabulary native to that agency. Use HigherGov, SAM.gov, agency-specific portals.
3. **Identify per-agency codes.** From matching solicitations, extract the NAICS, PSC, vehicle, and contracting structure each agency uses. These will be different per tribe — and even within one tribe, expect multiple PSCs.
4. **Map to award data.** Pull award history under the per-agency codes. Identify who's winning the work, how much, when contracts recompete. Note award-to-solicitation ratio (low ratio = procurement struggling, opportunity for influence).
5. **Build per-tribe DNA strand.** Compound signals (codes + dialect + vendors + POCs + work patterns) into a compact representation. Store in `engagement_tribes` table.
6. **Compute cross-tribe similarity matrix.** Pairwise comparison of tribe DNAs. Surface: which tribes look like each other, which vendors appear in multiple tribes, which dialect terms cross over.

**Deliverable:** Per-engagement cross-tribe map with DNA strands. A client like Manifold sees not "your federal market is $X" but "your federal market exists at agencies A, B, C, D, E, each with its own DNA. Here's the similarity matrix showing pursuit sequencing. Here are the cross-tribe vendors who already serve multiple of these tribes (your teaming targets). Here are the cross-tribe POCs (your relationship targets)."

**Why this is structurally important:**

The deliverable difference is enormous. Single-tribe finding ("USDA wants this") = single-agency strategy. Cross-tribe finding with DNA strands = multi-agency parallel pursuit strategy with sequencing intelligence.

**Trigger origin:** This capability was identified during the Manifold engagement when Zack:

1. Asked "Just because the award descriptions don't say it doesn't mean it wasn't described correctly in the solicitations themselves, right?" That question led to HigherGov solicitation investigation, which surfaced the USDA Secure Enclave Services finding.

2. Then provided the methodological correction: "Don't fall in love with this NAICS and PSC combo - that's the USDA interpretation. Doesn't mean other tribes have the same teepee." This prevented over-fitting to USDA codes.

3. Then proposed the DNA architectural shift: "Start also re-thinking how we use the DNA sequencing / clustering tool on the site with all this new-found knowledge. I almost feel like the dna sequences should be inside the tribes. the code to keyword to work description to vendor should live inside the USDA tribe for this effort."

**Implementation status:** Defined here as platform capability. Manual execution underway for Manifold engagement (HigherGov searches per agency, codes extraction, vendor reverse-lookup, USDA tribe being characterized first). Automated execution requires Section 8.B (SOW extraction) plus an agency-targeting layer plus the new schema for per-tribe DNA. Estimated: 4-6 sessions for v1 implementation. The DNA Strand tab UI needs significant refactor.

### 8.E — Analysis #5: Per-Opportunity Pursuit Archetype Classification

**The insight:** Tribe-level DNA tells you "this tribe procures the client's capability under these codes, with these dialect terms, from these vendors." But that's still aggregate. The client's actual question is more specific: **"of the N opportunities I now know about in this tribe, which ones do I pursue, and HOW?"**

Every opportunity in a tribe gets classified into one of 13 pursuit archetypes. Each archetype carries a specific recommended action, priority weighting, and time horizon. The result: a per-tribe pursuit pipeline where every line item is decision-ready, not a generic "this looks interesting."

**This is the layer that makes the engagement deliverable actionable.** Tribe DNA gives the strategic picture. Pursuit archetypes give the operational playbook.

### The 13 Pursuit Archetypes

Each archetype is a procurement-state + competitive-context combination that maps to a specific recommended action.

#### Award-Stage Archetypes

**1. Nonprofit-Awarded Teaming Target**
- **Description:** Awardee is academic, research nonprofit, mission-driven org, or federally funded research center
- **Why it matters:** Doesn't compete commercially against the client; likely needs the client's tech to scale or differentiate; shared mission creates partnership rationale
- **Action:** Research awardee's capability gaps → unsolicited subcontract or partnership proposal
- **Time horizon:** Near-term (3-6 months)
- **Priority:** P0 if capability fit is high, P1 otherwise
- **Example (Manifold/USDA):** The Coleridge Initiative ($7.5M USDA Secure Data Enclave award, Sept 2024). Coleridge is academic nonprofit doing federal data enclaves; Manifold can offer operator-supplied confidential GPU compute as a complementary capability they don't have.

**2. Large Prime Generalist Subcontracting Target**
- **Description:** Awardee is one of the major federal IT primes (Booz, GDIT, Leidos, SAIC, ManTech, Accenture, IBM, Northrop, Peraton, CACI, etc.)
- **Why it matters:** They won the work but don't have client-specific niche capability natively; they need tech partners and routinely sub on capability gaps
- **Action:** BD outreach to their capture team; position client as the specialty subcontractor
- **Time horizon:** Near-term to medium (3-12 months, depending on contract phase)
- **Priority:** P1 if specialty fit is clear, P2 if generic
- **Example (Manifold/USDA):** AWS, Microsoft, Google, Oracle Pool 1 task orders at USDA OCFO (2024). Manifold can sub to any of these primes for confidential GPU compute layer.

**3. Specialty Vendor Competitive Threat**
- **Description:** Awardee actually does what client does (commercial doppelganger or near-doppelganger)
- **Why it matters:** Direct competition for recompete; need to understand their performance and weaknesses
- **Action:** Competitive intelligence on their delivery; position for displacement at recompete window
- **Time horizon:** Long-term (12-36 months until recompete)
- **Priority:** P1 (high-value future opportunity), P0 if recompete is imminent
- **Example (Manifold/USDA):** None surfaced yet in USDA tribe — would apply if a true Manifold-doppelganger had won

**4. Niche Vendor with Recompete Window**
- **Description:** Awardee is small specialty firm; contract ending in 12-36 months
- **Why it matters:** They likely won by being first-mover with a narrow capability; client may have superior or expanded offering
- **Action:** Recompete targeting — start positioning 18 months before contract expiry
- **Time horizon:** Long-term (12-36 months)
- **Priority:** P2 unless contract is high-value, then P1

**5. Recently-Awarded Adjacent Work (Watch List)**
- **Description:** Award is in same code family / agency / dollar range but for different specific work
- **Why it matters:** Suggests the agency has budget priority in this space; future related procurements likely
- **Action:** Monitor; flag related solicitations as they emerge
- **Time horizon:** Ongoing
- **Priority:** P3 (intelligence value, not direct pursuit)

#### Solicitation-Stage Archetypes

**6. Active Solicitation, Direct Pursuit**
- **Description:** Open RFP/RFQ; client has vehicle access; high match score
- **Why it matters:** Immediate revenue opportunity
- **Action:** Go decision; mobilize proposal team
- **Time horizon:** Immediate (proposal deadline-driven)
- **Priority:** P0
- **Caveat:** "Vehicle access" is rare for emerging vendors — many clients won't qualify for archetype 6 until they're on a GSA Schedule or join a GWAC

**7. Active Solicitation, Teaming Required**
- **Description:** Open RFP; client lacks vehicle access; high match score
- **Why it matters:** Cannot bid alone but capability is right
- **Action:** Identify qualified prime, propose teaming arrangement, support their proposal
- **Time horizon:** Immediate (proposal deadline + teaming negotiation)
- **Priority:** P0 if prime is identified, P1 during prime-search phase

**8. Active Solicitation, Partial Match**
- **Description:** Open RFP; client can do part of the work but not all
- **Why it matters:** Sub-only opportunity; specific portion of SOW maps to client capability
- **Action:** Subcontract targeting on the relevant portion; coordinate with prime offerors
- **Time horizon:** Immediate
- **Priority:** P1

**9. Closed Solicitation, No Clear Award**
- **Description:** RFP closed; no award visible in databases (could be pending, canceled, or re-solicited)
- **Why it matters:** Procurement disposition is unclear; could indicate failed competition
- **Action:** Investigate disposition (FOIA, agency contact, news monitoring); surface as competitive intel
- **Time horizon:** Investigation-dependent
- **Priority:** P2

#### Market Research / RFI-Stage Archetypes

**10. Active RFI, Submit Response**
- **Description:** RFI is currently open; client capability matches
- **Why it matters:** Direct path to influencing downstream solicitation
- **Action:** Prepare and submit RFI response; request follow-up meeting
- **Time horizon:** Immediate (RFI deadline-driven)
- **Priority:** P0

**11. Closed RFI Without Solicitation, Unsolicited Proposal Target**
- **Description:** Agency conducted market research but never moved to procurement; no follow-on solicitation issued
- **Why it matters:** Requirement was real and budgeted; no presented solution met threshold; opportunity to propose unsolicited
- **Action:** Prepare unsolicited proposal explicitly tied to the prior RFI; demonstrate that client's solution exceeds what was scoped
- **Time horizon:** Near-term (3-6 months for proposal preparation and submission)
- **Priority:** P1 if match is strong, P2 otherwise
- **Example (Manifold/USDA):** USDA NASS Notice ID 1232SA24X did eventually move to procurement (Coleridge won), but the pattern applies broadly. Of USDA's 269 solicitations, 228 had no clear award — many are candidates for this archetype.

**12. Closed RFI With Different Solicitation, Recompete Preparation**
- **Description:** RFI led to a procurement client missed; awardee identified
- **Why it matters:** Client wasn't aware in time, but recompete cycle is predictable
- **Action:** Prepare for the recompete cycle; build relationships with the buyer NOW; position as a recompete contender 18 months out
- **Time horizon:** Long-term (12-48 months)
- **Priority:** P2 unless contract value is large

**13. Sources Sought / Industry Day Notice**
- **Description:** Pre-solicitation engagement — agency invites industry input before formal RFP
- **Why it matters:** Critical positioning window; agencies often let early industry input shape SOW requirements
- **Action:** Submit response, request individual meeting, attend industry day, propose capability briefing
- **Time horizon:** Immediate
- **Priority:** P0 if match is high; P1 otherwise

### Match Analysis Framework

For each opportunity, the match analysis answers five dimensions:

1. **Capability dimension** — which of the client's capabilities apply to this work? Specific match, not generic.
2. **Differentiation dimension** — what does the client do that the awardee/competitor doesn't? Why would the buyer prefer the client?
3. **Risk dimension** — what's missing? Vehicle access? Past performance? Clearances? FedRAMP authorization? Set-aside qualification?
4. **Competitive context** — who else could/should pursue this? Who has historically won similar work?
5. **Time horizon** — immediate / near-term / long-term opportunity?

This makes every opportunity's pursuit recommendation defensible, not vague. **It also makes the engagement's deliverable indefensibly valuable** — every line item has its reasoning trail.

### Schema Implications

```
tribe_opportunities
├── opp_id (HigherGov / SAM notice ID)
├── tribe_id (USDA, Census, NIH, etc.)
├── sub_tribe (USDA-ARS, USDA-NASS, USDA-OCFO, etc.)
├── procurement_state (Award | Solicitation | Market Research | RFI)
├── opp_title
├── opp_synopsis (Haiku-generated plain-English summary, 2-3 sentences)
├── posted_date
├── deadline_or_award_date
├── awardee (if applicable)
├── awardee_archetype (Nonprofit | Large Prime | Specialty | Niche | TBD)
├── codes (NAICS, PSC family, set-aside)
├── vehicle (Alliant II Unrestricted, MAS, agency-specific, OTA, etc.)
├── dollar_value (numeric where available)
├── match_score (0-10, dual-axis like Vendor Path)
├── match_analysis_json (5-dimension structure: capability/differentiation/risk/context/horizon)
├── pursuit_archetype (one of 13, foreign key to pursuit_archetypes table)
├── pursuit_priority (P0 | P1 | P2 | P3)
├── pursuit_rationale (Haiku-generated, 2-3 sentences)
├── action_items (array of specific next steps)
└── source_documents (paths to preserved SOW, RFI, award notice, etc.)

pursuit_archetypes (reference table)
├── archetype_id (1-13)
├── name
├── description
├── recommended_action_template
├── default_time_horizon
├── default_priority_logic
└── example_pattern
```

### UI Implications

Each tribe view gets an **Opportunities tab** (companion to the tribe-level DNA Strand tab):

- All in-scope opportunities for the tribe, sortable and filterable
- Filter by archetype: "show me only nonprofit teaming targets"
- Filter by procurement state: "show me only RFIs that closed without solicitation"
- Filter by match score: "show me only opportunities scoring 7+"
- Sort by priority, value, deadline
- Click any opportunity → drawer with full match analysis + pursuit recommendation + action items + source documents

The Opportunities tab feeds the per-engagement reports:
- **CEO Report:** total opportunities, total potential value, pursuit pipeline summary, top P0 items
- **Federal BD Report:** full pursuit pipeline with action items, target lists, teaming candidates, RFI response queue
- **Engineering Report:** technical match analysis depth, capability mapping, differentiation analysis

### Build Sequencing

This is a **Phase 2 build** that sits ON TOP of the per-tribe DNA work (Phase 1 from Section 8.D).

**Phase 1 (Section 8.D — Per-Tribe DNA):** New schema for engagement_tribes, DNA Strand tab refactor for per-tribe view, cross-tribe similarity matrix. Validates against existing USDA tribe data. Estimated: 4-6 dev sessions.

**Phase 2 (Section 8.E — Pursuit Archetypes):** tribe_opportunities table, archetype classification engine (Haiku-driven), Opportunities tab inside each tribe view, per-opportunity drawer with match analysis. Builds on Phase 1 foundation. Estimated: 4-6 dev sessions.

Both phases ship independently. Each generates immediate engagement value. Together they form the complete tribe-level analytical layer.

**Trigger origin:** This capability was identified during the Manifold engagement when Zack proposed: "I also believe as we dive into a tribe (as we are now with Agricultural Marketing Research Service), we list the aligned or adjacent opps, categorized by award, solicitation, market research, with Manifold match scores, synopsis of the 'thing', match analysis, and pursuit recommendation." Then provided three illustrative archetypes ("This was awarded, non-profit, teaming opp" / "This was awarded, large Prime generalist, subcontracting opp" / "This was never awarded, likely they never found the right solution(s), here's why you meet/exceed what they were seeking, unsolicited proposal tied to previous market research that never manifested opp.") — which Claude expanded into the 13-archetype framework above.

**Implementation status:** Defined as platform capability. Manual execution available now for Manifold engagement (Haiku-classified opportunities in synthesis artifacts). Full UI build deferred to Phase 2.

### 8.F — Implementation Sequence

1. **Foundation** — complete current Round 1/2/3 pipeline, Vendor Path, confidence-layered scoring (v1.0 target: done by end of Manifold engagement)
2. **Analysis #2 first** — SOW extraction pipeline. Becomes new foundation for all PIID analysis. Estimated: 3-4 dev sessions for V1.
3. **Analysis #1 second** — posting venue intelligence. Layers on top of SOW pipeline because we need to know where to fetch SOWs from. Estimated: 2-3 dev sessions.
4. **Analysis #4 third (Phase 1)** — per-tribe DNA + cross-tribe vocabulary mapping. Requires Analysis #2 (SOW corpus) plus agency-targeting layer. Estimated: 4-6 dev sessions for V1.
5. **Analysis #5 fourth (Phase 2)** — per-opportunity pursuit archetype classification. Builds on per-tribe DNA. Estimated: 4-6 dev sessions for V1.
6. **Analysis #3 fifth** — predictive modeling. Requires 6-12 months of SOW corpus accumulation across client engagements to train credibly. Estimated: 4-6 dev sessions + continuous tuning.

### 8.G — Commercial Implications

These five analyses fundamentally change the commercial model. Today's engagements are $150K one-time + Steptoe retainer. With the predictive, cross-tribe, and pursuit-classification capability:

- **Continuous intelligence subscription** becomes viable at $25-50K/month for serious federal pursuers
- **Per-opportunity forecasting reports** as ad-hoc deliverables ($5K-15K each)
- **Agency-specific intelligence packages** as annual subscriptions ($100-200K/year per agency)
- **Platform licensing to other federal advisory firms** becomes possible — white-label the predictive engine for firms that lack AI capability

The ~$150K one-time engagement becomes the entry point to a long-term subscription relationship. This is how Sunstone becomes a 9-figure business rather than a consulting shop with AI tools.

---



This playbook is a **living document.** It is updated whenever the platform's architecture, analytical logic, or commercial model evolves. Every update is timestamped in the changelog below.

### Update triggers

Update the playbook when:
- A new first-class platform feature ships (new tab, new analytical routine, new data model element)
- A new pattern is identified across multiple client engagements
- A design decision is made that contradicts or refines existing guidance
- A commercial model change is made (pricing, packaging, alliance structure)
- A new external intelligence source is integrated
- A new tool joins the ecosystem

### Who maintains it

- Primary: Zack Larson (Sunstone Principal)
- Technical: Claude (via cross-session continuity with Zack)
- Reviewers: Hector Caro (long-term technology partner)
- Client-facing variants: curated by Zack for client delivery

### Migration to live Methodology Tab

This playbook is currently a markdown document in the repo root. Future state: the content migrates into a live "Methodology" tab inside the Sunstone Intelligence Engine, with each section stored in a `playbook` table and auto-updating as the platform makes architectural decisions. At that point, the Methodology Report generator reads from the live tab plus the per-engagement methodology log to produce the client-facing Methodology Report automatically.

---

## Section 9 — Evolution and Maintenance

This playbook is a **living document.** It is updated whenever the platform's architecture, analytical logic, or commercial model evolves. Every update is timestamped in the changelog below.

### Update triggers

Update the playbook when:
- A new first-class platform feature ships (new tab, new analytical routine, new data model element)
- A new pattern is identified across multiple client engagements
- A design decision is made that contradicts or refines existing guidance
- A commercial model change is made (pricing, packaging, alliance structure)
- A new external intelligence source is integrated
- A new tool joins the ecosystem

### Who maintains it

- Primary: Zack Larson (Sunstone Principal)
- Technical: Claude (via cross-session continuity with Zack)
- Reviewers: Hector Caro (long-term technology partner)
- Client-facing variants: curated by Zack for client delivery

### Migration to live Methodology Tab

This playbook is currently a markdown document in the repo root. Future state: the content migrates into a live "Methodology" tab inside the Sunstone Intelligence Engine, with each section stored in a `playbook` table and auto-updating as the platform makes architectural decisions. At that point, the Methodology Report generator reads from the live tab plus the per-engagement methodology log to produce the client-facing Methodology Report automatically.

### Changelog

- **v1.0 — April 2026.** Initial authoring. Captures all platform thinking developed through the Manifold Labs engagement: dual-path architecture, PROACTIVE flag, trap phrase pattern, wrong-room diagnosis, capability × evidence matrix, full customer journey across five stages with three gates. Author: Claude, in session with Zack.
- **v1.1 — April 2026.** Added Section 8 (Solicitation-Side Intelligence Roadmap) capturing the three-analysis vision: posting venue intelligence, SOW extraction and enrichment, predictive solicitation modeling. Commercial implications for subscription pricing and long-term revenue model included. Author: Claude, in session with Zack, following Zack's articulation of the three-analysis insight.
- **v1.2 — April 2026.** Restructured Section 7 client report template to elevate "Strategic Narrative" as the core deliverable, supported by per-milestone "Synthesis Artifacts" written at the time of analysis. Methodology Report becomes the audit trail backing the narrative rather than the primary deliverable. This is the McKinsey-grade synthesis pattern — the analytical narrative IS the product, the methodology IS its backing. Triggered by Zack's recognition during Manifold Tier 2 scan: "This entire write-up - we can do this in the market research report, correct? This is McKinsey-style insights or better!" First synthesis artifact captured: syntheses/manifold/2026-04-25_tier_2_in_progress.md.
- **v1.3 — April 2026.** Replaced single "Strategic Narrative" deliverable with three audience-tuned reports composed from the same source synthesis artifacts: The CEO Report (4-8 pages, strategic), The Federal BD Report (15-25 pages, operational), The Engineering Report (20-40 pages, technical with appendices). Each is a complete deliverable for its audience. View generator architecture: synthesis artifacts as source-of-truth, three composers produce the three reports, regeneration is cheap, new audiences (Steptoe Brief, Investor Update) plug in as new generators. Triggered by Zack's product instinct: "I want the CEO Report. I want the Procurement BD Report. I want the Geek/Engineer Report. Different frames for different audiences." Names finalized as descriptive rather than cute: "The CEO Report. The Federal BD Report. The Engineering Report. Simple. Not cute. Descriptive. Decisive."
- **v1.4 — April 2026.** Established visual identity for the three audience reports. Three persona icons (suit/tie executive, blazer-with-insignia BD professional, glasses-with-gear engineer) sharing visual grammar — same gray silhouette base, same Sunstone-orange accent matching `var(--color-accent)`, same head-and-shoulders crop. Used on report covers, page headers, in-platform deliverable cards, and the future Methodology tab. Icons stored at `/public/report-icons/`. Source image plus three split icon files committed. Triggered by Zack uploading the source image mid-session: "Check THIS shit out for the report icons!!!"
- **v1.5 — April 2026.** Added Section 8.D — Cross-Tribe Vocabulary Mapping as the fourth solicitation-side analytical layer. Captures the methodological insight that each federal agency tribe has its own dialect for the same underlying capability, and that no single NAICS/PSC combination represents a federal market. Sections renumbered (old 8.D → 8.E Implementation Sequence; old 8.E → 8.F Commercial Implications). Triggered by Zack's discovery during Manifold engagement that USDA Secure Enclave Services solicitations exist under NAICS 518210 + PSC R702 (entirely different from Round 1's 541511/541512/541519), AND by Zack's immediate methodological correction: "Don't fall in love with this NAICS and PSC combo - that's the USDA interpretation. Doesn't mean other tribes have the same teepee." This insight elevates tribal-decoder from a subordinate goal to a primary platform capability.
- **v1.6 — April 2026.** Major expansion of Section 8.D to include **Per-Tribe DNA Sequencing**. Establishes that the DNA Strand concept (compounding signals into compact representation) must be scoped per tribe, not per engagement. Each tribe (and even sub-tribes within tribes — USDA ARS uses different PSCs than USDA NASS) has its own DNA: code patterns, dialect vocabulary, vendor base, work patterns, POCs, vehicles, award patterns. Cross-tribe similarity matrix becomes a first-class analytic. Vendors appearing in multiple tribe DNAs become high-priority teaming targets. Schema implications documented (engagement → engagement_tribes table → DNA strand per tribe). Triggered by Zack's architectural insight: "Start also re-thinking how we use the DNA sequencing / clustering tool on the site with all this new-found knowledge. I almost feel like the dna sequences should be inside the tribes. The code to keyword to work description to vendor should live inside the USDA tribe for this effort." First tribe fully characterized: USDA. First major finding from tribe DNA analysis: $7.5M USDA Secure Data Enclave Services award to The Coleridge Initiative on Sept 27 2024 — confirming Manifold's federal market is real (not pre-commercial), with Coleridge as incumbent and ~2027-2029 recompete window.
- **v1.7 — April 2026.** Added Section 8.E — Per-Opportunity Pursuit Archetype Classification. The fifth solicitation-side analytical layer. Establishes that tribe-level DNA tells the strategic picture but client's actual question is operational ("of N opportunities, which to pursue and HOW"). Defines 13 pursuit archetypes covering Award-Stage (5: Nonprofit Teaming, Large Prime Sub, Specialty Threat, Niche Recompete, Adjacent Watch), Solicitation-Stage (4: Direct Pursuit, Teaming Required, Partial Match, No Clear Award), and Market Research/RFI-Stage (4: Active RFI, Closed RFI Unsolicited, Closed RFI Recompete Prep, Sources Sought) categories. Each archetype carries specific recommended action, time horizon, priority weighting. 5-dimension match analysis framework defined (capability, differentiation, risk, competitive context, time horizon). Schema documented (tribe_opportunities + pursuit_archetypes tables + match_analysis_json field). UI documented (Opportunities tab inside each tribe view, per-opportunity drawer). Build sequencing: Phase 2 ON TOP of per-tribe DNA (Section 8.D Phase 1). Sections renumbered: old 8.E Implementation Sequence → 8.F (now 6 phases including new Analysis #5); old 8.F Commercial Implications → 8.G. Triggered by Zack's product instinct during Manifold engagement: "I also believe as we dive into a tribe (as we are now with Agricultural Marketing Research Service), we list the aligned or adjacent opps, categorized by award, solicitation, market research, with Manifold match scores, synopsis of the 'thing', match analysis, and pursuit recommendation." Plus three illustrative archetypes Zack named (Coleridge nonprofit teaming, large prime subcontracting, RFI-without-solicitation unsolicited proposal). First application: Manifold synthesis updated with USDA tribe pursuit pipeline classifying 41 awards + 228 non-awards into pursuit archetypes with priority assignments. P0/P1/P2/P3 distribution and dollar opportunity estimates ($15M-$50M from USDA tribe alone over 3 years; $50M-$200M cross-tribe over 3-5 years).

---

*End of Playbook v1.0*
