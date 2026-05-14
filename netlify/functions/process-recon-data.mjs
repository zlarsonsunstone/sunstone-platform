// process-recon-data: parse uploaded HigherGov contract + IDV CSVs,
// cluster the awards (L1 capability + L2 agency), write recon_clusters
// and tenant_recon_awards rows, populate prospect_context.discovery stats.
//
// Designed to run as a background job triggered after wizard submit.
// Tracks status in v2.intake_jobs.
//
// Request body:
// {
//   tenant_id: "wicked-bionic-llc",
//   contracts_csv: "<text>",   // HigherGov contract export CSV content
//   idvs_csv: "<text>",        // HigherGov IDV export CSV content
//   tenant_profile: {
//     core_naics: ["541810","541613",...],
//     core_psc:   ["R701","R708",...],
//     core_capabilities: [...],
//     tier_strong: [...]
//   }
// }
//
// Response: { job_id, status, progress }

import { createClient } from '@supabase/supabase-js'
import { json } from './_shared-claude.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const STOPWORDS = new Set("the a an and or but for to of in on at by with from as is are was were be been being have has had this that these those it its their there they them you your we our us will shall may can should would could might must do does did has have had not no all any some each every both either neither nor so such than then thus also only more most other such same first second third one two three four five fy contract order task pop performance period base year option price firm fixed plus fee cost services service support work shall provide period of performance idv idiq bpa".split(/\s+/))
const BOILERPLATE = new Set("contract contracts services service work order task order period performance date option base year contractor provide pursuant accordance requirement requirements follows following descriptions description scope sow pws idiq gsa bpa schedule see attached attachment addendum modification mod various related naics psc idv call specifically particularly general specific fixed price firm obligated fund funds funded funding new additional existing current previous subsequent continue continuation support administrative one two three four five six seven eight nine ten will shall provide must include includes including approximately approximate total value amount dollar dollars total".split(/\s+/))
const ALL_STOP = new Set([...STOPWORDS, ...BOILERPLATE])

const L1_NAME_MAP = {
  'Recruiting & Retention Marketing': 'Recruiting & Retention Marketing',
  'Public Health Awareness Campaigns': 'Public Health Awareness Campaigns',
  'Public Safety & Behavior Change Campaigns': 'Public Safety & Behavior Change Campaigns',
  'Public Affairs & Strategic Communications': 'Public Affairs & Strategic Communications',
  'Outreach & Engagement Campaigns': 'Outreach & Engagement Campaigns',
  'Media Buying & Placement': 'Media Buying & Placement',
  'Creative Services & Content Production': 'Creative Services & Content Production',
  'Digital & Social Media Marketing': 'Digital & Social Media Marketing',
  'Field Events & Experiential Marketing': 'Field Events & Experiential Marketing',
  'Sports & Sponsorship Marketing': 'Sports & Sponsorship Marketing',
  'Multicultural / Multilingual Marketing': 'Multicultural / Multilingual Marketing',
  'Research & Audience Analysis': 'Research & Audience Analysis',
  'Integrated Marketing Services': 'Integrated Marketing Services',
  'Public Information & PSA': 'Public Information & Public Service Announcements',
  'Generic Marketing & Advertising Services': 'General Marketing & Advertising',
  'Uncategorized': 'Specialty Marketing Services',
}

const L1_DESCRIPTIONS = {
  'Recruiting & Retention Marketing': 'Marketing campaigns to attract and retain personnel for federal service organizations.',
  'Public Health Awareness Campaigns': 'Federal public-health communications designed to inform behavior, disease prevention, and access to care.',
  'Public Safety & Behavior Change Campaigns': 'Behavioral-change campaigns addressing public safety, prevention, and protective behaviors.',
  'Public Affairs & Strategic Communications': 'High-touch strategic communications, public affairs, and crisis-comms support for federal stakeholders.',
  'Outreach & Engagement Campaigns': 'Multi-channel outreach building awareness with target communities, often national in scope.',
  'Media Buying & Placement': 'Paid media planning, buying, and placement across broadcast, print, digital, and out-of-home.',
  'Creative Services & Content Production': 'Creative development, content production, design, and video for federal campaigns.',
  'Digital & Social Media Marketing': 'Digital advertising, social platform campaigns, and influencer-driven engagement.',
  'Field Events & Experiential Marketing': 'On-site activations, sponsorships, branded events, and experiential marketing.',
  'Sports & Sponsorship Marketing': 'Sports team and venue partnerships, branded sponsorship integrations.',
  'Multicultural / Multilingual Marketing': 'In-language and culturally tailored marketing reaching diverse audience segments.',
  'Research & Audience Analysis': 'Audience research, segmentation, and analytics supporting campaign development.',
  'Integrated Marketing Services': 'Full-service agency-of-record engagements integrating strategy, creative, and media.',
  'Public Information & PSA': 'Public service announcements and federal public-information campaigns.',
  'Generic Marketing & Advertising Services': 'General marketing and advertising work without a single dominant capability lane.',
  'Uncategorized': 'Specialty awards that did not cluster cleanly into a primary capability.',
}

// ============================================================================
// CSV PARSING
// ============================================================================

function parseCsv(text) {
  // Robust CSV: handles quoted fields with embedded commas + newlines
  const out = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++ }
      else if (c === '"') { inQuotes = false }
      else { field += c }
    } else {
      if (c === '"') { inQuotes = true }
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n' || c === '\r') {
        if (field !== '' || row.length > 0) { row.push(field); out.push(row); row = []; field = '' }
        if (c === '\r' && text[i+1] === '\n') i++
      } else { field += c }
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); out.push(row) }
  if (out.length === 0) return []
  // Strip BOM from first cell
  out[0][0] = out[0][0].replace(/^\uFEFF/, '')
  const headers = out[0].map(h => h.trim())
  const rows = []
  for (let r = 1; r < out.length; r++) {
    if (out[r].length === 1 && out[r][0] === '') continue
    const obj = {}
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = (out[r][c] || '').trim()
    rows.push(obj)
  }
  return rows
}

function parseAmount(v) {
  if (!v) return 0
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? 0 : n
}

// ============================================================================
// CAPABILITY BUCKETING
// Maps NAICS/PSC + description signals to capability bucket
// ============================================================================

const CAPABILITY_KEYWORDS = [
  { bucket: 'Recruiting & Retention Marketing',         kw: ['recruit','retention','enlistment','workforce attraction','talent acquisition'] },
  { bucket: 'Public Health Awareness Campaigns',         kw: ['public health','health awareness','vaccine','disease','prevention','immunization','wellness','smok','tobacco','opioid','mental health'] },
  { bucket: 'Public Safety & Behavior Change Campaigns', kw: ['safety campaign','behavior change','impaired driving','seat belt','drug prevention','crime prevention','suicide prevention','firearm safety'] },
  { bucket: 'Public Affairs & Strategic Communications', kw: ['public affairs','strategic communic','crisis comm','spokesperson','press relations','media relations','reputation','stakeholder engagement'] },
  { bucket: 'Outreach & Engagement Campaigns',           kw: ['outreach','engagement','awareness campaign','community engagement','public engagement','public information campaign'] },
  { bucket: 'Media Buying & Placement',                  kw: ['media buy','media placement','media planning','paid media','broadcast media','radio advertising','television advertising','out-of-home','ooh','print advertising'] },
  { bucket: 'Creative Services & Content Production',    kw: ['creative services','content production','video production','graphic design','copywriting','print production','illustration','animation','production services'] },
  { bucket: 'Digital & Social Media Marketing',          kw: ['digital marketing','social media','search marketing','online advertising','programmatic','seo','sem','influencer','content marketing'] },
  { bucket: 'Field Events & Experiential Marketing',     kw: ['experiential','event marketing','activation','sponsorship integration','booth','expo','field marketing','live event'] },
  { bucket: 'Sports & Sponsorship Marketing',            kw: ['sports marketing','sports sponsorship','venue sponsorship','team sponsorship','athletic event'] },
  { bucket: 'Multicultural / Multilingual Marketing',    kw: ['multicultural','multilingual','hispanic marketing','spanish language','asian american','african american','minority outreach','language access','translation services','interpretation services'] },
  { bucket: 'Research & Audience Analysis',              kw: ['audience research','audience analysis','market research','segmentation','focus group','polling','survey research'] },
  { bucket: 'Integrated Marketing Services',             kw: ['integrated marketing','agency of record','full service','full-service advertising','marketing services'] },
  { bucket: 'Public Information & PSA',                  kw: ['public service announcement','psa','public information','public affairs broadcasting'] },
  { bucket: 'Generic Marketing & Advertising Services',  kw: ['marketing','advertising','communications'] },
]

function classifyCapability(row) {
  const text = `${row.description || ''} ${row.naicsTitle || ''} ${row.pscTitle || ''}`.toLowerCase()
  for (const { bucket, kw } of CAPABILITY_KEYWORDS) {
    for (const k of kw) {
      if (text.includes(k)) return bucket
    }
  }
  return 'Uncategorized'
}

// ============================================================================
// AWARD NORMALIZATION
// Convert raw CSV row -> normalized award object
// ============================================================================

function normalizeAward(row, kind, tenantId) {
  // HigherGov column mappings - may vary slightly between contract and idv exports
  const awardId = row['Award ID'] || row['Award Id'] || ''
  const parentId = row['Parent Award ID'] || row['Parent Award Id'] || ''

  return {
    award_id: awardId,
    tenant_id: tenantId,
    kind, // 'contract' or 'idv'
    idv_type: kind === 'idv' ? (row['IDV Type'] || row['Vehicle Name'] || null) : null,
    description: row['Original Description'] || row['Description'] || row['Award Description'] || null,
    naics: row['NAICS'] || row['Naics'] || null,
    naicsTitle: row['NAICS Title'] || null,
    psc: row['PSC'] || null,
    pscTitle: row['PSC Title'] || null,
    awardee: row['Awardee Name'] || null,
    awardee_uei: row['Awardee UEI'] || null,
    awardee_cage: row['Awardee Cage Code'] || row['Awardee CAGE Code'] || null,
    dollarsObligated: kind === 'contract' ? parseAmount(row['Obligated Amount'] || row['Total Dollars Obligated'] || row['Current Total Value']) : null,
    vehicleCeiling: kind === 'idv' ? parseAmount(row['Vehicle Ceiling'] || row['Potential Total Value']) : null,
    agencyDept: row['Top Level Awarding Agency'] || row['Awarding Agency'] || null,
    agencyRaw: row['Awarding Agency'] || null,
    popStart: row['Period Of Performance Start Date'] || row['POP Start'] || null,
    popEnd: row['Ordering Period End Date'] || row['Period Of Performance Current End Date'] || row['POP End'] || null,
    actionDate: row['Most Recent Action Date'] || row['Award Date'] || null,
    fss: row['Federal Supply Schedule'] || null,
    parentAwardId: parentId,
  }
}

function deriveParentIdvPiid(awardId, parentAwardIdRaw) {
  // For compound award_id (PARENT-CHILD), extract parent prefix
  if (awardId && awardId.includes('-')) return awardId.split('-')[0]
  // Otherwise use the Parent Award ID column if set
  if (parentAwardIdRaw && parentAwardIdRaw.trim()) {
    const p = parentAwardIdRaw.trim()
    if (p.includes('-')) return p.split('-')[0]
    return p
  }
  return null
}

function assignRing(award, profile) {
  // Ring 1 (Core): NAICS in core_naics AND capability in tier_strong
  // Ring 2 (Near): NAICS in core_naics OR capability in tier_strong
  // Ring 3 (Adjacent): capability in core_capabilities
  // Ring 4 (Outer): everything else
  const coreNaics = new Set(profile.core_naics || [])
  const corePsc   = new Set(profile.core_psc || [])
  const tierStrong = new Set(profile.tier_strong || [])
  const coreCaps  = new Set(profile.core_capabilities || [])
  const naicsHit = award.naics && coreNaics.has(award.naics)
  const pscHit = award.psc && corePsc.has(award.psc)
  const strongHit = tierStrong.has(award.capability)
  const coreCapHit = coreCaps.has(award.capability)

  if ((naicsHit || pscHit) && strongHit) return 1
  if (naicsHit || pscHit || strongHit) return 2
  if (coreCapHit) return 3
  return 4
}

// ============================================================================
// CLUSTERING (port of cluster.py)
// ============================================================================

function extractPhrases(awards, minCount = 3) {
  const uni = new Map(), bi = new Map(), tri = new Map()
  for (const a of awards) {
    const desc = (a.description || '').toLowerCase().replace(/[^a-z0-9\s\-]/g, ' ')
    const words = desc.split(/\s+/).filter(w => w.length > 2 && !ALL_STOP.has(w))
    for (const w of words) uni.set(w, (uni.get(w) || 0) + 1)
    for (let i = 0; i < words.length - 1; i++) {
      const p = words.slice(i, i+2).join(' ')
      bi.set(p, (bi.get(p) || 0) + 1)
    }
    for (let i = 0; i < words.length - 2; i++) {
      const p = words.slice(i, i+3).join(' ')
      tri.set(p, (tri.get(p) || 0) + 1)
    }
  }
  const sortedDesc = (m) => Array.from(m.entries()).sort((a,b) => b[1] - a[1])
  const out = []
  for (const [phrase, count] of sortedDesc(tri).slice(0, 8)) {
    if (count >= minCount) out.push({ phrase, count })
  }
  for (const [phrase, count] of sortedDesc(bi).slice(0, 8)) {
    if (count >= minCount && !out.some(x => x.phrase.includes(phrase))) out.push({ phrase, count })
  }
  for (const [phrase, count] of sortedDesc(uni).slice(0, 6)) {
    if (count >= Math.max(minCount, 5) && phrase.length > 4) out.push({ phrase, count })
  }
  out.sort((a,b) => b.count - a.count)
  return out.slice(0, 12)
}

function computeCodePattern(awards) {
  const naicsCt = new Map(), pscCt = new Map()
  for (const a of awards) {
    if (a.naics) naicsCt.set(a.naics, (naicsCt.get(a.naics) || 0) + 1)
    if (a.psc) pscCt.set(a.psc, (pscCt.get(a.psc) || 0) + 1)
  }
  const total = Math.max(1, awards.length)
  const toDict = (m) => {
    const o = {}
    for (const [code, count] of m.entries()) {
      const share = count / total
      const highlight = share >= 0.6 ? 'green' : share >= 0.2 ? 'black' : 'yellow'
      o[code] = { count, share: Math.round(share * 1000) / 1000, highlight }
    }
    return o
  }
  return { naics: toDict(naicsCt), psc: toDict(pscCt) }
}

function computeMatchScore(capability, awards, profile) {
  let s = 1.0
  if ((profile.tier_strong || []).includes(capability)) s = 4.5
  else if ((profile.core_capabilities || []).includes(capability)) s = 3.5
  else if (capability && capability !== 'Uncategorized') s = 2.0
  const n = awards.length
  if (n >= 100) s = Math.min(5.0, s + 0.5)
  else if (n >= 40) s = Math.min(5.0, s + 0.3)
  else if (n >= 15) s = Math.min(5.0, s + 0.1)
  const naicsSet = new Set(awards.map(a => a.naics).filter(Boolean))
  const pscSet = new Set(awards.map(a => a.psc).filter(Boolean))
  const coreNaics = new Set(profile.core_naics || [])
  const corePsc = new Set(profile.core_psc || [])
  for (const x of naicsSet) if (coreNaics.has(x)) { s = Math.min(5.0, s + 0.2); break }
  for (const x of pscSet) if (corePsc.has(x)) { s = Math.min(5.0, s + 0.2); break }
  return Math.round(s * 10) / 10
}

function matchReasoning(awards, score, profile) {
  const n = awards.length
  let total = 0
  for (const a of awards) total += (a.dollarsObligated || 0) + (a.vehicleCeiling || 0)
  const naicsHit = awards.some(a => (profile.core_naics || []).includes(a.naics))
  let s1
  const M = (total / 1e6).toFixed(0)
  if (score >= 4.5) s1 = `Direct fit with ${n} awards totaling $${M}M obligated/ceiling.`
  else if (score >= 3.5) s1 = `Strong capability alignment with ${n} awards ($${M}M total).`
  else if (score >= 2.5) s1 = `Adjacent capability with proven federal demand: ${n} awards, $${M}M.`
  else s1 = `Loose capability adjacency. ${n} awards observed ($${M}M).`
  const s2 = naicsHit
    ? "Core NAICS bands match the tenant's registration."
    : "NAICS bands fall outside the tenant's primary registration; opportunity-by-opportunity assessment recommended."
  return s1 + ' ' + s2
}

function clusterAwards(awards, profile) {
  // Level 1: by capability
  const byCap = new Map()
  for (const a of awards) {
    const cap = a.capability || 'Uncategorized'
    if (!byCap.has(cap)) byCap.set(cap, [])
    byCap.get(cap).push(a)
  }
  const sortedCaps = Array.from(byCap.entries()).sort((a,b) => b[1].length - a[1].length)

  const clusters = []
  const awardToCluster = new Map()  // award_id -> cluster index in clusters[]

  let l1Idx = 0
  for (const [cap, rows] of sortedCaps) {
    // L2: group by agency_dept, only keep dept buckets >= 3
    const byDept = new Map()
    for (const a of rows) {
      const dept = a.agencyDept || 'Unspecified Federal Agency'
      if (!byDept.has(dept)) byDept.set(dept, [])
      byDept.get(dept).push(a)
    }
    const l2Eligible = new Map()
    for (const [dept, deptRows] of byDept.entries()) {
      if (deptRows.length >= 3) l2Eligible.set(dept, deptRows)
    }
    const l2GroupedIds = new Set()
    for (const deptRows of l2Eligible.values()) for (const r of deptRows) l2GroupedIds.add(r.award_id)
    const l1OnlyRows = rows.filter(r => !l2GroupedIds.has(r.award_id))

    const matchScore = computeMatchScore(cap, rows, profile)
    const l1 = {
      level: 1,
      placeholder_id: `L1_${l1Idx}`,
      parent_placeholder: null,
      name: L1_NAME_MAP[cap] || cap,
      description: L1_DESCRIPTIONS[cap] || '',
      capability_kind: cap,
      agency_dept: null,
      sort_order: l1Idx,
      vocabulary: extractPhrases(rows),
      code_pattern: computeCodePattern(rows),
      match_score: matchScore,
      match_reasoning: matchReasoning(rows, matchScore, profile),
      award_count: rows.length,
      contract_count: rows.filter(r => r.kind === 'contract').length,
      idv_count: rows.filter(r => r.kind === 'idv').length,
      total_obligated: rows.filter(r => r.kind === 'contract').reduce((s, r) => s + (r.dollarsObligated || 0), 0),
      total_ceiling: rows.filter(r => r.kind === 'idv').reduce((s, r) => s + (r.vehicleCeiling || 0), 0),
      distinct_awardees: new Set(rows.map(r => r.awardee).filter(Boolean)).size,
    }
    clusters.push(l1)
    for (const r of l1OnlyRows) awardToCluster.set(r.award_id, l1.placeholder_id)

    // L2 clusters
    const sortedDepts = Array.from(l2Eligible.entries()).sort((a,b) => b[1].length - a[1].length)
    let l2Idx = 0
    for (const [dept, deptRows] of sortedDepts) {
      const l2 = {
        level: 2,
        placeholder_id: `L2_${l1Idx}_${l2Idx}`,
        parent_placeholder: l1.placeholder_id,
        name: `${L1_NAME_MAP[cap] || cap}  -  ${dept}`,
        description: `${dept} awards within ${(L1_NAME_MAP[cap] || cap).toLowerCase()}.`,
        capability_kind: cap,
        agency_dept: dept,
        sort_order: l2Idx,
        vocabulary: extractPhrases(deptRows),
        code_pattern: computeCodePattern(deptRows),
        match_score: matchScore,
        match_reasoning: `${deptRows.length} awards within ${dept}. ` + l1.match_reasoning,
        award_count: deptRows.length,
        contract_count: deptRows.filter(r => r.kind === 'contract').length,
        idv_count: deptRows.filter(r => r.kind === 'idv').length,
        total_obligated: deptRows.filter(r => r.kind === 'contract').reduce((s, r) => s + (r.dollarsObligated || 0), 0),
        total_ceiling: deptRows.filter(r => r.kind === 'idv').reduce((s, r) => s + (r.vehicleCeiling || 0), 0),
        distinct_awardees: new Set(deptRows.map(r => r.awardee).filter(Boolean)).size,
      }
      clusters.push(l2)
      for (const r of deptRows) awardToCluster.set(r.award_id, l2.placeholder_id)
      l2Idx++
    }

    l1Idx++
  }

  return { clusters, awardToCluster }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })
  if (!SERVICE_KEY || !SUPABASE_URL) return json(500, { error: 'Server not configured' })

  let body
  try { body = JSON.parse(event.body || '{}') }
  catch { return json(400, { error: 'Invalid JSON' }) }

  const { tenant_id, contracts_csv = '', idvs_csv = '', tenant_profile = {} } = body
  if (!tenant_id) return json(400, { error: 'tenant_id required' })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Create the intake_job row to track progress
  let jobId = null
  try {
    const { data, error } = await admin
      .schema('v2').from('intake_jobs')
      .insert({
        tenant_id,
        job_kind: 'recon_load',
        status: 'running',
        started_at: new Date().toISOString(),
        payload: { has_contracts: !!contracts_csv, has_idvs: !!idvs_csv },
        progress: { stage: 'parsing' },
      })
      .select()
      .single()
    if (error) throw error
    jobId = data.id
  } catch (e) {
    return json(500, { error: 'Could not create intake job: ' + e.message })
  }

  const updateJob = async (patch) => {
    try {
      await admin.schema('v2').from('intake_jobs').update(patch).eq('id', jobId)
    } catch {}
  }

  try {
    // 1. Parse CSVs
    const idvRows = parseCsv(idvs_csv).map(r => normalizeAward(r, 'idv', tenant_id))
    const contractRows = parseCsv(contracts_csv).map(r => normalizeAward(r, 'contract', tenant_id))
    // Filter empty award_ids
    const allRows = [...idvRows, ...contractRows].filter(r => r.award_id)

    await updateJob({ progress: { stage: 'classifying', parsed: allRows.length } })

    // 2. Classify capability per row, derive parent_idv_piid, assign ring
    for (const r of allRows) {
      r.capability = classifyCapability(r)
      r.parent_idv_piid = deriveParentIdvPiid(r.award_id, r.parentAwardId)
      r.ring = assignRing(r, tenant_profile)
    }

    await updateJob({ progress: { stage: 'clustering', parsed: allRows.length } })

    // 3. Cluster
    const { clusters, awardToCluster } = clusterAwards(allRows, tenant_profile)
    const l1Count = clusters.filter(c => c.level === 1).length
    const l2Count = clusters.filter(c => c.level === 2).length

    await updateJob({ progress: { stage: 'writing', clusters_l1: l1Count, clusters_l2: l2Count } })

    // 4. Wipe existing clusters + awards for this tenant
    await admin.schema('v2').from('recon_clusters').delete().eq('tenant_id', tenant_id)
    await admin.schema('v2').from('tenant_recon_awards').delete().eq('tenant_id', tenant_id)

    // 5. Insert L1 clusters, capture UUID mapping
    const placeholderToUuid = new Map()
    const l1ToInsert = clusters.filter(c => c.level === 1).map(c => ({
      tenant_id, level: 1, parent_cluster_id: null,
      name: c.name, description: c.description, capability_kind: c.capability_kind,
      agency_dept: null, campaign_signature: null, sort_order: c.sort_order,
      match_score: c.match_score, match_reasoning: c.match_reasoning,
      vocabulary: c.vocabulary, code_pattern: c.code_pattern,
      award_count: c.award_count, contract_count: c.contract_count, idv_count: c.idv_count,
      total_obligated: c.total_obligated, total_ceiling: c.total_ceiling, distinct_awardees: c.distinct_awardees,
    }))
    const { data: insertedL1, error: l1Err } = await admin.schema('v2').from('recon_clusters').insert(l1ToInsert).select('id, capability_kind, sort_order')
    if (l1Err) throw new Error('L1 insert: ' + l1Err.message)
    for (const row of insertedL1) {
      const ph = `L1_${row.sort_order}`
      placeholderToUuid.set(ph, row.id)
    }

    // 6. Insert L2 clusters with parent_cluster_id resolved
    const l2ToInsert = clusters.filter(c => c.level === 2).map(c => ({
      tenant_id, level: 2,
      parent_cluster_id: placeholderToUuid.get(c.parent_placeholder),
      name: c.name, description: c.description, capability_kind: c.capability_kind,
      agency_dept: c.agency_dept, campaign_signature: null, sort_order: c.sort_order,
      match_score: c.match_score, match_reasoning: c.match_reasoning,
      vocabulary: c.vocabulary, code_pattern: c.code_pattern,
      award_count: c.award_count, contract_count: c.contract_count, idv_count: c.idv_count,
      total_obligated: c.total_obligated, total_ceiling: c.total_ceiling, distinct_awardees: c.distinct_awardees,
    }))
    let insertedL2 = []
    if (l2ToInsert.length > 0) {
      const { data, error: l2Err } = await admin.schema('v2').from('recon_clusters').insert(l2ToInsert).select('id, capability_kind, agency_dept, sort_order')
      if (l2Err) throw new Error('L2 insert: ' + l2Err.message)
      insertedL2 = data
      // Match each inserted L2 back to its placeholder by capability + dept + sort_order
      // We need to look up which L1 sort_order it belongs to first
      const l2Originals = clusters.filter(c => c.level === 2)
      for (const orig of l2Originals) {
        const match = insertedL2.find(r =>
          r.capability_kind === orig.capability_kind &&
          r.agency_dept === orig.agency_dept &&
          r.sort_order === orig.sort_order
        )
        if (match) placeholderToUuid.set(orig.placeholder_id, match.id)
      }
    }

    // 7. Insert tenant_recon_awards (with cluster_id and parent_idv_piid set)
    const awardRows = allRows.map(a => ({
      tenant_id, award_id: a.award_id, award_kind: a.kind,
      idv_type: a.idv_type, ring: a.ring, description: a.description,
      naics: a.naics, naics_title: a.naicsTitle, psc: a.psc, psc_title: a.pscTitle,
      awardee_name: a.awardee, awardee_uei: a.awardee_uei, awardee_cage: a.awardee_cage,
      dollars_obligated: a.dollarsObligated, vehicle_ceiling: a.vehicleCeiling,
      agency_dept: a.agencyDept, agency_raw: a.agencyRaw,
      capability: a.capability,
      pop_start: a.popStart || null, pop_end: a.popEnd || null, action_date: a.actionDate || null,
      fss: a.fss,
      cluster_id: placeholderToUuid.get(awardToCluster.get(a.award_id)) || null,
      parent_idv_piid: a.parent_idv_piid,
    }))
    // Bulk insert in chunks of 500 to stay under PostgREST limits
    for (let i = 0; i < awardRows.length; i += 500) {
      const chunk = awardRows.slice(i, i + 500)
      const { error: aErr } = await admin.schema('v2').from('tenant_recon_awards').insert(chunk)
      if (aErr) throw new Error(`Awards insert chunk ${i}: ` + aErr.message)
    }

    // 8. Compute discovery stats and update prospect_context
    const totalDollars = awardRows.reduce((s, r) => s + (r.dollars_obligated || 0) + (r.vehicle_ceiling || 0), 0)
    const ring1Count = awardRows.filter(r => r.ring === 1).length
    const ring1Cluster = clusters.filter(c => c.level === 1).sort((a, b) => b.match_score - a.match_score)[0]
    await admin.schema('v2').from('prospect_context').upsert({
      tenant_id,
      discovery_awards_count: awardRows.length,
      discovery_total_obligated: totalDollars,
      discovery_capability_rings: 4,
      discovery_ring_1_label: ring1Cluster?.name || 'Top capability',
      discovery_ring_1_count: ring1Count,
      active_stage: 6,  // discovery is now ready
    }, { onConflict: 'tenant_id' })

    await updateJob({
      status: 'completed',
      completed_at: new Date().toISOString(),
      progress: {
        stage: 'done', parsed: allRows.length,
        clusters_l1: l1Count, clusters_l2: l2Count,
        awards_loaded: awardRows.length,
      },
    })

    return json(200, {
      job_id: jobId,
      status: 'completed',
      tenant_id,
      summary: { awards: awardRows.length, clusters_l1: l1Count, clusters_l2: l2Count },
    })
  } catch (e) {
    await updateJob({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: e.message,
    })
    return json(500, { job_id: jobId, error: e.message })
  }
}
