/**
 * Stones Map Editor — Recon Engine
 *
 * Configures the 4-Stone engagement map for a strategic profile.
 * Each lane carries both cost rings (top half) and award rings (bottom half).
 * Up to 5 sub-categories per ring-type per lane. Click-to-place, nested stacking,
 * per-ring confidence×likelihood, duration pills, cascade across stones.
 *
 * Persists to v2.stones_config (one row per strategic profile).
 * Autosaves with 2-second debounce after changes.
 *
 * Ported from standalone HTML v9 — locked design, do not change behavior here.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { supabase } from '@/lib/supabase'

// =============================================================================
// COLOR FAMILIES (5 shades each, light → deep) — locked from doctrine
// Stay literal regardless of light/dark theme.
// =============================================================================
const PALETTE = {
  sun:    ['#FCE4B6', '#F8C977', '#F0A742', '#C77A0F', '#8C5208'],
  cap:    ['#E5E5E7', '#C7C7CC', '#8E8E93', '#48484A', '#1C1C1E'],
  step:   ['#E5C5C5', '#C97B7B', '#9B3838', '#5E1F1F', '#2D0D0D'],
  award:  ['#C5DCC8', '#94BFA0', '#6FA67C', '#4A8259', '#2E6B3E'],
} as const

type Family = keyof typeof PALETTE
type Kind = 'cost' | 'award'
type StoneStatus = 'active' | 'deferred' | 'not_applicable'

// =============================================================================
// LANE DEFINITIONS — 9 total, all support both cost + award rings
// =============================================================================
interface LaneDef {
  id: string
  label: string
  owner: 'sun' | 'step'
  family: Family
  defaultCostSubs: { label: string; shadeIdx: number }[]
}

const LANES: LaneDef[] = [
  { id: 'sun_setup',     label: 'Sunstone Setup',         owner: 'sun',  family: 'sun',
    defaultCostSubs: [{ label: 'Initial set-up', shadeIdx: 2 }] },
  { id: 'sun_capture',   label: 'Sunstone Capture Work',  owner: 'sun',  family: 'cap',
    defaultCostSubs: [
      { label: 'Capture',    shadeIdx: 1 },
      { label: 'Response',   shadeIdx: 2 },
      { label: 'Management', shadeIdx: 3 },
    ]},
  { id: 'agency_rels',   label: 'Agency Relationships',   owner: 'step', family: 'step',
    defaultCostSubs: [{ label: 'Agency Relationships', shadeIdx: 2 }] },
  { id: 'lobbying',      label: 'Lobbying',               owner: 'step', family: 'step',
    defaultCostSubs: [{ label: 'Lobbying', shadeIdx: 2 }] },
  { id: 'appropriations',label: 'Appropriations Work',    owner: 'step', family: 'step',
    defaultCostSubs: [{ label: 'Appropriations', shadeIdx: 2 }] },
  { id: 'standards',     label: 'Standards Body',         owner: 'step', family: 'step',
    defaultCostSubs: [{ label: 'Standards Body', shadeIdx: 2 }] },
  { id: 'policy',        label: 'Policy / Regulatory',    owner: 'step', family: 'step',
    defaultCostSubs: [{ label: 'Policy', shadeIdx: 2 }] },
  { id: 'legislation',   label: 'Legislation',            owner: 'step', family: 'step',
    defaultCostSubs: [{ label: 'Legislation', shadeIdx: 2 }] },
  { id: 'procurement',   label: 'Procurement',            owner: 'step', family: 'step',
    defaultCostSubs: [{ label: 'Procurement', shadeIdx: 2 }] },
]

const DEFAULT_AWARD_SUBS = [
  { label: 'Pessimistic', shadeIdx: 0 },
  { label: 'Realistic',   shadeIdx: 2 },
  { label: 'Optimistic',  shadeIdx: 4 },
]

interface StoneDef {
  num: number
  key: string
  name: string
  horizonDefault: number
  awardMonth: number
}

const STONES: StoneDef[] = [
  { num: 1, key: 'stone_01', name: 'Maximize Current Market',         horizonDefault: 18, awardMonth: 9 },
  { num: 2, key: 'stone_02', name: 'Upstream Requirements Shaping',   horizonDefault: 24, awardMonth: 18 },
  { num: 3, key: 'stone_03', name: 'Shift Apportioned Dollars',       horizonDefault: 36, awardMonth: 30 },
  { num: 4, key: 'stone_04', name: 'Reshape the Market',              horizonDefault: 60, awardMonth: 54 },
]

const SCALE_ALPHA: Record<number, number> = { 1: 0.30, 2: 0.45, 3: 0.60, 4: 0.78, 5: 1.00 }
const MAX_SUBS = 5

// =============================================================================
// DATA TYPES
// =============================================================================
interface SubCat {
  id: string
  label: string
  shadeIdx: number
}

interface Ring {
  id: string
  month: number
  kind: Kind
  subId: string
  amount: number
  scale: number
  duration?: number
}

interface LaneState {
  active: boolean
  costSubs: SubCat[]
  awardSubs: SubCat[]
  rings: Ring[]
}

interface StoneState {
  status: StoneStatus
  horizonMonths: number
  lanes: Record<string, LaneState>
  awardSuggestionMonth: number
}

interface VisibleRing extends Ring {
  originStone: number
  inherited: boolean
}

interface VisibleSub extends SubCat {
  originStone: number
  inherited: boolean
}

interface StonesPayload {
  stones: StoneState[]
  activeStoneIdx: number
}

// =============================================================================
// FACTORY HELPERS
// =============================================================================
function makeFreshStone(stone: StoneDef): StoneState {
  const lanes: Record<string, LaneState> = {}
  for (const lane of LANES) {
    lanes[lane.id] = {
      active: stone.num === 1 && (lane.id === 'sun_setup' || lane.id === 'sun_capture'),
      costSubs: lane.defaultCostSubs.slice(0, MAX_SUBS).map((s, i) => ({
        id: `cs_${lane.id}_default_${i}`,
        label: s.label,
        shadeIdx: s.shadeIdx,
      })),
      awardSubs: DEFAULT_AWARD_SUBS.map((s, i) => ({
        id: `as_${lane.id}_default_${i}`,
        label: s.label,
        shadeIdx: s.shadeIdx,
      })),
      rings: [],
    }
  }
  return {
    status: 'active',
    horizonMonths: stone.horizonDefault,
    lanes,
    awardSuggestionMonth: stone.awardMonth,
  }
}

function makeInitialPayload(): StonesPayload {
  return {
    stones: STONES.map(s => makeFreshStone(s)),
    activeStoneIdx: 0,
  }
}

// =============================================================================
// UTILITIES
// =============================================================================
function fmtTight(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (v === 0) return '—'
  if (Math.abs(v) >= 1e9) return '$' + Math.round(v / 1e9) + 'B'
  if (Math.abs(v) >= 1e6) return '$' + Math.round(v / 1e6) + 'M'
  if (Math.abs(v) >= 1e3) return '$' + Math.round(v / 1e3) + 'K'
  return '$' + Math.round(v)
}

function ringRadius(amount: number): number {
  if (!amount || amount <= 0) return 6
  const r = 5 + Math.sqrt(amount / 1000) * 0.6
  return Math.min(20, Math.max(7, r))
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

// =============================================================================
// CHART GEOMETRY — must match v9 exactly
// =============================================================================
const CHART = {
  width: 1180,
  height: 460,
  laneLabelWidth: 220,
  bottomAxis: 30,
  topPad: 16,
}

function chartGeometry(horizon: number) {
  const innerW = CHART.width - CHART.laneLabelWidth - 30
  const innerH = CHART.height - CHART.bottomAxis - CHART.topPad
  const laneCount = LANES.length
  const laneH = innerH / laneCount
  return {
    innerW,
    innerH,
    laneH,
    leftEdge: CHART.laneLabelWidth,
    rightEdge: CHART.width - 30,
    topEdge: CHART.topPad,
    bottomEdge: CHART.height - CHART.bottomAxis,
    xForMonth: (m: number) => CHART.laneLabelWidth + (m / horizon) * innerW,
    yForLane: (idx: number) => CHART.topPad + idx * laneH + laneH / 2,
    yCostForLane: (idx: number) => CHART.topPad + idx * laneH + laneH * 0.3,
    yAwardForLane: (idx: number) => CHART.topPad + idx * laneH + laneH * 0.72,
  }
}

// =============================================================================
// COMPONENT
// =============================================================================
interface Props {
  strategicProfileId: string
  tenantId: string
  profileName: string
  onClose: () => void
}

export function StonesMapEditor({ strategicProfileId, tenantId, profileName, onClose }: Props) {
  const [payload, setPayload] = useState<StonesPayload>(makeInitialPayload)
  const [loaded, setLoaded] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle')
  const [showNumbers, setShowNumbers] = useState(true)
  const [highlight, setHighlight] = useState<{ laneId: string; kind: Kind; subId?: string } | null>(null)
  const [placeMode, setPlaceMode] = useState<{ laneId: string; kind: Kind; subId: string } | null>(null)
  const [inspectorRingRef, setInspectorRingRef] = useState<{ laneId: string; ringId: string; anchorX: number; anchorY: number } | null>(null)
  const [draggingRingId, setDraggingRingId] = useState<string | null>(null)
  const [cumCollapsed, setCumCollapsed] = useState(false)

  // Sticky chart shadow detection
  const sentinelRef = useRef<HTMLDivElement>(null)
  const chartCardRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const stones = payload.stones
  const activeStoneIdx = payload.activeStoneIdx
  const stone = stones[activeStoneIdx]

  // ---------------------------------------------------------------------------
  // LOAD from Supabase on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('stones_config')
          .select('stones_state')
          .eq('strategic_profile_id', strategicProfileId)
          .maybeSingle()
        if (cancelled) return
        if (error && error.code !== 'PGRST116') {
          // PGRST116 = no rows; that's OK. Anything else is real.
          console.error('Failed to load stones_config:', error)
        }
        if (data && data.stones_state && Array.isArray(data.stones_state.stones)) {
          setPayload({
            stones: data.stones_state.stones,
            activeStoneIdx: data.stones_state.activeStoneIdx ?? 0,
          })
        }
      } catch (e) {
        if (!cancelled) console.error('Load error:', e)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [strategicProfileId])

  // ---------------------------------------------------------------------------
  // DEBOUNCED AUTOSAVE — 2 sec after last change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!loaded) return
    if (saveState === 'idle' || saveState === 'saved') return
    if (saveState !== 'dirty') return
    const timer = setTimeout(async () => {
      setSaveState('saving')
      try {
        const { error } = await supabase
          .from('stones_config')
          .upsert(
            {
              tenant_id: tenantId,
              strategic_profile_id: strategicProfileId,
              stones_state: payload as any,
              last_edited_at: new Date().toISOString(),
            },
            { onConflict: 'strategic_profile_id' },
          )
        if (error) throw error
        setSaveState('saved')
        setTimeout(() => {
          setSaveState((s) => (s === 'saved' ? 'idle' : s))
        }, 1800)
      } catch (e) {
        console.error('Save failed:', e)
        setSaveState('error')
      }
    }, 2000)
    return () => clearTimeout(timer)
  }, [payload, saveState, loaded, strategicProfileId, tenantId])

  // Mark dirty on every payload change after initial load
  const initialPayloadRef = useRef(payload)
  useEffect(() => {
    if (!loaded) return
    if (payload === initialPayloadRef.current) return
    setSaveState((s) => (s === 'saving' ? s : 'dirty'))
  }, [payload, loaded])

  // ---------------------------------------------------------------------------
  // STICKY CHART DETECTION
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const sentinel = sentinelRef.current
    const card = chartCardRef.current
    if (!sentinel || !card) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        card.classList.toggle('stones-stuck', !entry.isIntersecting)
      },
      { threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loaded])

  // ---------------------------------------------------------------------------
  // CASCADE HELPERS — visible rings/subs/lanes for the active stone
  // ---------------------------------------------------------------------------
  const getVisibleRings = useCallback(
    (laneId: string): VisibleRing[] => {
      const result: VisibleRing[] = []
      for (let i = 0; i <= activeStoneIdx; i++) {
        const ls = stones[i]?.lanes[laneId]
        if (!ls) continue
        for (const r of ls.rings || []) {
          result.push({ ...r, originStone: i + 1, inherited: i < activeStoneIdx })
        }
      }
      return result
    },
    [stones, activeStoneIdx],
  )

  const getVisibleSubs = useCallback(
    (laneId: string, kind: Kind): VisibleSub[] => {
      const seen = new Set<string>()
      const result: VisibleSub[] = []
      for (let i = 0; i <= activeStoneIdx; i++) {
        const ls = stones[i]?.lanes[laneId]
        if (!ls) continue
        const subs = kind === 'cost' ? ls.costSubs : ls.awardSubs
        for (const s of subs) {
          if (seen.has(s.id)) continue
          seen.add(s.id)
          result.push({ ...s, originStone: i + 1, inherited: i < activeStoneIdx })
        }
      }
      return result
    },
    [stones, activeStoneIdx],
  )

  const isLaneVisible = useCallback(
    (laneId: string): boolean => {
      for (let i = 0; i <= activeStoneIdx; i++) {
        if (stones[i]?.lanes[laneId]?.active) return true
      }
      return false
    },
    [stones, activeStoneIdx],
  )

  const findRingOriginStone = useCallback(
    (laneId: string, ringId: string): number | null => {
      for (let i = 0; i < stones.length; i++) {
        const ls = stones[i]?.lanes[laneId]
        if (!ls) continue
        if ((ls.rings || []).some(r => r.id === ringId)) return i + 1
      }
      return null
    },
    [stones],
  )

  const findSubOriginStone = useCallback(
    (laneId: string, kind: Kind, subId: string): number | null => {
      for (let i = 0; i < stones.length; i++) {
        const ls = stones[i]?.lanes[laneId]
        if (!ls) continue
        const subs = kind === 'cost' ? ls.costSubs : ls.awardSubs
        if (subs.some(s => s.id === subId)) return i + 1
      }
      return null
    },
    [stones],
  )

  const getSubColorForRing = useCallback(
    (laneDef: LaneDef, ring: Ring): string => {
      for (let i = 0; i < stones.length; i++) {
        const ls = stones[i]?.lanes[laneDef.id]
        if (!ls) continue
        const subs = ring.kind === 'cost' ? ls.costSubs : ls.awardSubs
        const sub = subs.find(s => s.id === ring.subId)
        if (sub) {
          const family = ring.kind === 'cost' ? laneDef.family : 'award'
          return PALETTE[family][sub.shadeIdx]
        }
      }
      return ring.kind === 'cost' ? PALETTE[laneDef.family][2] : PALETTE.award[2]
    },
    [stones],
  )

  // ---------------------------------------------------------------------------
  // STATE MUTATORS — all return new payload so React re-renders
  // ---------------------------------------------------------------------------
  function updateStone(idx: number, updater: (s: StoneState) => StoneState) {
    setPayload((prev) => ({
      ...prev,
      stones: prev.stones.map((s, i) => (i === idx ? updater(s) : s)),
    }))
  }

  function updateLane(stoneIdx: number, laneId: string, updater: (l: LaneState) => LaneState) {
    updateStone(stoneIdx, (s) => ({
      ...s,
      lanes: { ...s.lanes, [laneId]: updater(s.lanes[laneId]) },
    }))
  }

  function selectStone(idx: number) {
    setPayload((p) => ({ ...p, activeStoneIdx: idx }))
    setInspectorRingRef(null)
  }

  function setStatus(status: StoneStatus) {
    updateStone(activeStoneIdx, (s) => ({ ...s, status }))
  }

  function setHorizon(months: number) {
    updateStone(activeStoneIdx, (s) => ({
      ...s,
      horizonMonths: Math.max(6, Math.min(120, months)),
    }))
  }

  function toggleLane(laneId: string) {
    let inheritedActive = false
    for (let i = 0; i < activeStoneIdx; i++) {
      if (stones[i]?.lanes[laneId]?.active) {
        inheritedActive = true
        break
      }
    }
    if (inheritedActive) return
    updateLane(activeStoneIdx, laneId, (l) => ({ ...l, active: !l.active }))
  }

  function addSub(laneId: string, kind: Kind) {
    const visible = getVisibleSubs(laneId, kind)
    if (visible.length >= MAX_SUBS) return
    const newLabel = window.prompt(`New ${kind} sub-category name:`, '')
    if (!newLabel) return
    const lane = LANES.find(l => l.id === laneId)!
    const family = kind === 'cost' ? lane.family : 'award'
    const palette = PALETTE[family]
    const usedIdxs = visible.map(s => s.shadeIdx)
    let nextShade = 2
    for (let i = 0; i < palette.length; i++) {
      if (!usedIdxs.includes(i)) {
        nextShade = i
        break
      }
    }
    const id = newId(kind === 'cost' ? 'cs' : 'as')
    updateLane(activeStoneIdx, laneId, (l) => ({
      ...l,
      [kind === 'cost' ? 'costSubs' : 'awardSubs']: [
        ...(kind === 'cost' ? l.costSubs : l.awardSubs),
        { id, label: newLabel, shadeIdx: nextShade },
      ],
    }))
  }

  function renameSub(laneId: string, kind: Kind, subId: string, newLabel: string) {
    const originStone = findSubOriginStone(laneId, kind, subId)
    if (originStone !== activeStoneIdx + 1) return
    updateLane(activeStoneIdx, laneId, (l) => {
      const subs = kind === 'cost' ? l.costSubs : l.awardSubs
      const updated = subs.map(s => (s.id === subId ? { ...s, label: newLabel } : s))
      return {
        ...l,
        [kind === 'cost' ? 'costSubs' : 'awardSubs']: updated,
      }
    })
  }

  function removeSub(laneId: string, kind: Kind, subId: string) {
    const originStone = findSubOriginStone(laneId, kind, subId)
    if (originStone !== activeStoneIdx + 1) return
    setPayload((prev) => ({
      ...prev,
      stones: prev.stones.map((stoneState, i) => {
        if (i < activeStoneIdx) return stoneState
        const ls = stoneState.lanes[laneId]
        if (!ls) return stoneState
        const updatedLane = {
          ...ls,
          [kind === 'cost' ? 'costSubs' : 'awardSubs']: (kind === 'cost' ? ls.costSubs : ls.awardSubs).filter(s => s.id !== subId),
          rings: ls.rings.filter(r => !(r.kind === kind && r.subId === subId)),
        }
        return { ...stoneState, lanes: { ...stoneState.lanes, [laneId]: updatedLane } }
      }),
    }))
  }

  function startPlace(laneId: string, kind: Kind, subId: string) {
    setPlaceMode({ laneId, kind, subId })
  }

  function cancelPlaceMode() {
    setPlaceMode(null)
  }

  function placeRing(laneId: string, month: number, kind: Kind, subId: string) {
    const id = newId('r')
    const defaultAmount = kind === 'cost' ? 10000 : 500000
    updateLane(activeStoneIdx, laneId, (l) => ({
      ...l,
      active: true,
      rings: [...l.rings, { id, month, kind, subId, amount: defaultAmount, scale: 4, duration: 0 }],
    }))
    setPlaceMode(null)
  }

  function updateRing(laneId: string, ringId: string, patch: Partial<Ring>) {
    const originIdx = findRingOriginStone(laneId, ringId)
    if (originIdx === null) return
    const stoneIdx = originIdx - 1
    if (stoneIdx !== activeStoneIdx) return
    updateLane(stoneIdx, laneId, (l) => ({
      ...l,
      rings: l.rings.map(r => (r.id === ringId ? { ...r, ...patch } : r)),
    }))
  }

  function deleteRing(laneId: string, ringId: string) {
    const originIdx = findRingOriginStone(laneId, ringId)
    if (originIdx === null) return
    if (originIdx - 1 !== activeStoneIdx) {
      const ok = window.confirm(
        `This ring originates on Stone 0${originIdx}. Deleting it will remove it from all stones (including this one). Proceed?`,
      )
      if (!ok) return
    }
    updateLane(originIdx - 1, laneId, (l) => ({
      ...l,
      rings: l.rings.filter(r => r.id !== ringId),
    }))
    setInspectorRingRef(null)
  }

  function suggestAwards(laneId: string) {
    const stoneNum = activeStoneIdx + 1
    const baseAmounts: Record<number, { p: number; r: number; o: number }> = {
      1: { p: 100000,  r: 500000,    o: 2000000 },
      2: { p: 500000,  r: 2000000,   o: 8000000 },
      3: { p: 2000000, r: 8000000,   o: 20000000 },
      4: { p: 5000000, r: 25000000,  o: 150000000 },
    }
    const base = baseAmounts[stoneNum]
    if (!base) return
    const visibleSubs = getVisibleSubs(laneId, 'award')
    const pess = visibleSubs.find(s => s.label === 'Pessimistic')
    const real = visibleSubs.find(s => s.label === 'Realistic')
    const opt = visibleSubs.find(s => s.label === 'Optimistic')
    if (!pess || !real || !opt) {
      window.alert('Pessimistic / Realistic / Optimistic sub-categories required on this lane to use doctrine suggestion.')
      return
    }
    const month = stones[activeStoneIdx].awardSuggestionMonth
    updateLane(activeStoneIdx, laneId, (l) => {
      const cleaned = l.rings.filter(r => !(r.kind === 'award' && r.month === month))
      return {
        ...l,
        active: true,
        rings: [
          ...cleaned,
          { id: newId('r'), month, kind: 'award', subId: pess.id, amount: base.p, scale: 3, duration: 0 },
          { id: newId('r'), month, kind: 'award', subId: real.id, amount: base.r, scale: 4, duration: 0 },
          { id: newId('r'), month, kind: 'award', subId: opt.id,  amount: base.o, scale: 2, duration: 0 },
        ],
      }
    })
  }

  // ---------------------------------------------------------------------------
  // INSPECTOR ACTIONS — cycle, addNested
  // ---------------------------------------------------------------------------
  function cycleInspectorRing(direction: 1 | -1) {
    if (!inspectorRingRef) return
    const { laneId, ringId } = inspectorRingRef
    const visible = getVisibleRings(laneId)
    const current = visible.find(r => r.id === ringId)
    if (!current) return
    const peers = visible
      .filter(r => r.kind === current.kind && r.month === current.month)
      .sort((a, b) => b.amount - a.amount)
    const idx = peers.findIndex(r => r.id === ringId)
    const next = peers[(idx + direction + peers.length) % peers.length]
    setInspectorRingRef({
      laneId,
      ringId: next.id,
      anchorX: inspectorRingRef.anchorX,
      anchorY: inspectorRingRef.anchorY,
    })
  }

  function addNestedRing() {
    if (!inspectorRingRef) return
    const { laneId, ringId } = inspectorRingRef
    const originIdx = findRingOriginStone(laneId, ringId)
    if (originIdx === null) return
    if (originIdx - 1 !== activeStoneIdx) return
    const ls = stones[activeStoneIdx].lanes[laneId]
    const ring = ls.rings.find(r => r.id === ringId)
    if (!ring) return
    const subs = ring.kind === 'cost' ? ls.costSubs : ls.awardSubs
    const usedAtMonth = ls.rings
      .filter(r => r.kind === ring.kind && r.month === ring.month)
      .map(r => r.subId)
    const nextSub = subs.find(s => !usedAtMonth.includes(s.id)) || subs[0]
    const newRingId = newId('r')
    updateLane(activeStoneIdx, laneId, (l) => ({
      ...l,
      rings: [...l.rings, {
        id: newRingId,
        month: ring.month,
        kind: ring.kind,
        subId: nextSub.id,
        amount: ring.amount * 0.6,
        scale: ring.scale,
        duration: ring.duration || 0,
      }],
    }))
    setInspectorRingRef({
      laneId,
      ringId: newRingId,
      anchorX: inspectorRingRef.anchorX,
      anchorY: inspectorRingRef.anchorY,
    })
  }

  // ---------------------------------------------------------------------------
  // DURATION DRAG
  // ---------------------------------------------------------------------------
  const dragRef = useRef<{
    laneId: string
    ringId: string
    startClientX: number
    startDuration: number
    horizon: number
    innerW: number
  } | null>(null)

  function startDurationDrag(laneId: string, ringId: string, ev: React.MouseEvent | React.PointerEvent) {
    ev.preventDefault()
    ev.stopPropagation()
    const originIdx = findRingOriginStone(laneId, ringId)
    if (originIdx === null || originIdx - 1 !== activeStoneIdx) return
    const ring = stones[activeStoneIdx].lanes[laneId]?.rings.find(r => r.id === ringId)
    if (!ring) return

    // Double-click on a duration-0 ring seeds it with 1 month
    if (ev.type === 'dblclick' && (!ring.duration || ring.duration === 0)) {
      updateRing(laneId, ringId, { duration: 1 })
      return
    }

    setDraggingRingId(ringId)
    const horizon = stones[activeStoneIdx].horizonMonths
    const g = chartGeometry(horizon)
    dragRef.current = {
      laneId,
      ringId,
      startClientX: ev.clientX,
      startDuration: ring.duration || 0,
      horizon,
      innerW: g.innerW,
    }
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const scaleX = rect.width / CHART.width
      const dxPx = e.clientX - d.startClientX
      const dxChart = dxPx / scaleX
      const dxMonths = Math.round((dxChart / d.innerW) * d.horizon)
      const ringNow = stones[activeStoneIdx]?.lanes[d.laneId]?.rings.find(r => r.id === d.ringId)
      if (!ringNow) return
      const newDuration = Math.max(0, Math.min(d.horizon - ringNow.month, d.startDuration + dxMonths))
      if (newDuration !== ringNow.duration) {
        updateRing(d.laneId, d.ringId, { duration: newDuration })
      }
    }
    const onUp = () => {
      setDraggingRingId(null)
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ---------------------------------------------------------------------------
  // RING CLICK
  // ---------------------------------------------------------------------------
  function onRingClick(laneId: string, ringId: string, ev: React.MouseEvent) {
    ev.stopPropagation()
    setInspectorRingRef({
      laneId,
      ringId,
      anchorX: ev.clientX,
      anchorY: ev.clientY,
    })
  }

  // ---------------------------------------------------------------------------
  // CLICK-OUTSIDE INSPECTOR
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!inspectorRingRef) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.stones-inspector')) return
      if (target.closest('.stones-ring')) return
      setInspectorRingRef(null)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [inspectorRingRef])

  // ---------------------------------------------------------------------------
  // CUMULATIVE TABLE COMPUTATION
  // ---------------------------------------------------------------------------
  const cumTable = useMemo(() => {
    const horizon = stone.horizonMonths
    const cols = [0]
    for (let m = 3; m <= horizon; m += 3) cols.push(m)
    if (cols[cols.length - 1] !== horizon) cols.push(horizon)
    const colLabels = cols.map(m => {
      if (m === 0) return 'UP'
      if (m % 12 === 0) return `${m / 12}Y`
      return `${m}M`
    })

    const costContrib: { month: number; amount: number }[] = []
    const awardByLabel: Record<string, { month: number; amount: number }[]> = {}
    for (const lane of LANES) {
      if (!isLaneVisible(lane.id)) continue
      const visible = getVisibleRings(lane.id)
      for (const r of visible) {
        const dur = r.duration || 0
        const months = dur === 0 ? [r.month] : Array.from({ length: dur + 1 }, (_, i) => r.month + i)
        const perMonth = r.amount / months.length
        if (r.kind === 'cost') {
          months.forEach(m => costContrib.push({ month: m, amount: perMonth }))
        } else {
          let label = 'Award'
          for (let i = 0; i < stones.length; i++) {
            const ls = stones[i]?.lanes[lane.id]
            if (!ls) continue
            const sub = ls.awardSubs.find(s => s.id === r.subId)
            if (sub) {
              label = sub.label
              break
            }
          }
          if (!awardByLabel[label]) awardByLabel[label] = []
          months.forEach(m => awardByLabel[label].push({ month: m, amount: perMonth }))
        }
      }
    }

    const inPeriod = (i: number) => {
      const m = cols[i]
      if (i === 0) return costContrib.filter(c => c.month <= m).reduce((s, c) => s + c.amount, 0)
      const prev = cols[i - 1]
      return costContrib.filter(c => c.month > prev && c.month <= m).reduce((s, c) => s + c.amount, 0)
    }
    const cumThrough = (m: number) => costContrib.filter(c => c.month <= m).reduce((s, c) => s + c.amount, 0)
    const awardCum = (label: string, m: number) =>
      (awardByLabel[label] || []).filter(c => c.month <= m).reduce((s, c) => s + c.amount, 0)

    const standardOrder = ['Pessimistic', 'Realistic', 'Optimistic']
    const awardLabels = Object.keys(awardByLabel)
    const orderedLabels = [
      ...standardOrder.filter(l => awardLabels.includes(l)),
      ...awardLabels.filter(l => !standardOrder.includes(l)).sort(),
    ]

    // Inline summary for collapsed view
    const finalCol = cols[cols.length - 1]
    const totalCost = cumThrough(finalCol)
    const realLabel = orderedLabels.find(l => l === 'Realistic') || orderedLabels[0]
    const realAward = realLabel ? awardCum(realLabel, finalCol) : 0
    const horizonLabel = finalCol === 0 ? 'upfront' : finalCol % 12 === 0 ? `${finalCol / 12} yr` : `${finalCol} mo`

    return { cols, colLabels, inPeriod, cumThrough, awardCum, orderedLabels, totalCost, realLabel, realAward, horizonLabel }
  }, [stones, stone, activeStoneIdx, getVisibleRings, isLaneVisible])

  // ---------------------------------------------------------------------------
  // ESC handler
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (placeMode) {
        cancelPlaceMode()
      } else if (inspectorRingRef) {
        setInspectorRingRef(null)
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placeMode, inspectorRingRef, onClose])

  // ---------------------------------------------------------------------------
  // STYLES
  // ---------------------------------------------------------------------------
  const css = STYLES

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  if (!loaded) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
        Loading Stones config…
      </div>
    )
  }

  // X-axis ticks
  const horizon = stone.horizonMonths
  const g = chartGeometry(horizon)
  const tickStops =
    horizon <= 18
      ? [0, 6, 12, horizon]
      : horizon <= 24
      ? [0, 6, 12, 18, horizon]
      : horizon <= 36
      ? [0, 12, 24, horizon]
      : [0, 12, 36, horizon]
  const ticks = Array.from(new Set(tickStops)).filter(m => m <= horizon)

  return (
    <>
      <style>{css}</style>

      {/* Place-mode banner */}
      {placeMode && (
        <div className="stones-place-banner">
          <span>
            Click on the {LANES.find(l => l.id === placeMode.laneId)!.label} lane (highlighted) to place a{' '}
            {placeMode.kind === 'cost' ? 'COST' : 'AWARD'} ring ·{' '}
            {(getVisibleSubs(placeMode.laneId, placeMode.kind).find(s => s.id === placeMode.subId) || { label: '' }).label}
          </span>
          <button onClick={cancelPlaceMode}>Cancel</button>
        </div>
      )}

      <div className="stones-shell">
        {/* Header strip */}
        <div className="stones-headstrip">
          <div>
            <div className="stones-eyebrow">PROFILE</div>
            <div className="stones-headline">{profileName}</div>
          </div>
          <div className="stones-savestate" data-state={saveState}>
            {saveState === 'idle' && '·'}
            {saveState === 'dirty' && 'Editing — autosave in 2s'}
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && '✓ Saved'}
            {saveState === 'error' && '⚠ Save failed — will retry'}
          </div>
        </div>

        {/* Stone tabs */}
        <div className="stones-tabs">
          {STONES.map((s, i) => {
            const cls = ['stones-tab']
            if (i === activeStoneIdx) cls.push('active')
            const status = stones[i].status
            if (status === 'deferred') cls.push('deferred')
            if (status === 'not_applicable') cls.push('na')
            return (
              <button key={s.key} className={cls.join(' ')} onClick={() => selectStone(i)}>
                Stone 0{s.num} · {s.name}
                <span className="stones-badge">
                  {status === 'active' ? 'ACTIVE' : status === 'deferred' ? 'DEFERRED' : 'N/A'}
                </span>
              </button>
            )
          })}
        </div>

        {/* Status bar */}
        <div className="stones-statusbar">
          <div className="stones-pillgroup">
            <button
              className={`stones-pill${stone.status === 'active' ? ' on' : ''}`}
              onClick={() => setStatus('active')}
            >
              Active
            </button>
            <button
              className={`stones-pill${stone.status === 'deferred' ? ' deferred-on' : ''}`}
              onClick={() => setStatus('deferred')}
            >
              Deferred
            </button>
            <button
              className={`stones-pill${stone.status === 'not_applicable' ? ' na-on' : ''}`}
              onClick={() => setStatus('not_applicable')}
            >
              N/A
            </button>
          </div>

          <div className="stones-horizon">
            <span>Horizon</span>
            <input
              type="number"
              min={6}
              max={120}
              step={1}
              value={stone.horizonMonths}
              onChange={(e) => setHorizon(+e.target.value)}
            />
            <span>months</span>
          </div>

          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {LANES.filter(l => isLaneVisible(l.id)).length} of {LANES.length} lanes active
          </div>
        </div>

        <div ref={sentinelRef} style={{ height: 1 }} />

        {/* Chart card */}
        <div className="stones-chart-card" ref={chartCardRef}>
          <div className="stones-chart-head">
            <div className="stones-chart-title">
              STONES MAP · COSTS (TOP) + AWARDS (BOTTOM) · NESTED RINGS
            </div>
            <div className="stones-legend">
              <span><span className="stones-dot" style={{ background: '#F0A742' }} />Sunstone Setup</span>
              <span><span className="stones-dot" style={{ background: '#48484A' }} />Capture Work</span>
              <span><span className="stones-dot" style={{ background: '#9B3838' }} />Steptoe</span>
              <span><span className="stones-dot" style={{ background: '#6FA67C' }} />Award $</span>
              <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--color-text-tertiary)', fontSize: 10 }}>
                <input
                  type="checkbox"
                  id="stones-shownumbers"
                  checked={showNumbers}
                  onChange={(e) => setShowNumbers(e.target.checked)}
                  style={{ margin: 0, cursor: 'pointer' }}
                />
                <label htmlFor="stones-shownumbers" style={{ cursor: 'pointer' }}>Numbers (draft)</label>
              </span>
            </div>
          </div>

          <svg
            ref={svgRef}
            className="stones-chart"
            viewBox={`0 0 ${CHART.width} ${CHART.height}`}
            preserveAspectRatio="none"
          >
            {/* Lane backgrounds */}
            {LANES.map((lane, idx) => {
              const yTop = CHART.topPad + idx * g.laneH
              const halfH = g.laneH / 2
              return (
                <g key={`band_${lane.id}`}>
                  <rect
                    x={g.leftEdge}
                    y={yTop}
                    width={g.innerW}
                    height={halfH}
                    className="stones-band-cost"
                  />
                  <rect
                    x={g.leftEdge}
                    y={yTop + halfH}
                    width={g.innerW}
                    height={halfH}
                    className="stones-band-award"
                  />
                </g>
              )
            })}

            {/* Lane labels & rules */}
            {LANES.map((lane, idx) => {
              const y = g.yForLane(idx)
              return (
                <g key={`lbl_${lane.id}`}>
                  <text x={16} y={y + 4} className="stones-lane-row">
                    {lane.label}
                  </text>
                  <text
                    x={CHART.laneLabelWidth - 12}
                    y={y + 4}
                    textAnchor="end"
                    className="stones-lane-aux"
                  >
                    {lane.owner === 'sun' ? 'SUN' : 'STEP'}
                  </text>
                  <line
                    x1={g.leftEdge}
                    y1={CHART.topPad + (idx + 1) * g.laneH}
                    x2={g.rightEdge}
                    y2={CHART.topPad + (idx + 1) * g.laneH}
                    className="stones-lane-rule"
                  />
                </g>
              )
            })}

            {/* X axis */}
            <line
              x1={g.leftEdge}
              y1={g.bottomEdge}
              x2={g.rightEdge}
              y2={g.bottomEdge}
              className="stones-x-axis"
            />
            {ticks.map((m) => {
              const x = g.xForMonth(m)
              const lbl =
                m === 0
                  ? 'Upfront'
                  : m === horizon
                  ? `${(m / 12).toFixed(0)} yr`
                  : m % 12 === 0
                  ? `${m / 12} yr`
                  : `${m} mo`
              return (
                <g key={`tick_${m}`}>
                  <line x1={x} x2={x} y1={g.bottomEdge} y2={g.bottomEdge + 5} className="stones-x-axis" />
                  <text x={x} y={g.bottomEdge + 18} textAnchor="middle" className="stones-x-tick">
                    {lbl}
                  </text>
                </g>
              )
            })}

            {/* Place-mode dim + lane highlight + click cells */}
            {placeMode && (
              <g>
                <rect x={0} y={0} width={CHART.width} height={CHART.height} fill="rgba(0,0,0,0.30)" pointerEvents="none" />
                {(() => {
                  const targetIdx = LANES.findIndex(l => l.id === placeMode.laneId)
                  const yTop = CHART.topPad + targetIdx * g.laneH
                  return (
                    <>
                      <rect
                        x={g.leftEdge}
                        y={yTop}
                        width={g.innerW}
                        height={g.laneH}
                        fill="rgba(240,167,66,0.12)"
                        stroke="#F0A742"
                        strokeWidth={1}
                      />
                      {Array.from({ length: horizon + 1 }, (_, i) => i).map((m) => {
                        const cellX = g.xForMonth(m) - g.innerW / horizon / 2
                        return (
                          <rect
                            key={`cell_${m}`}
                            x={cellX}
                            y={yTop}
                            width={g.innerW / horizon}
                            height={g.laneH}
                            fill="transparent"
                            style={{ cursor: 'pointer' }}
                            onClick={() => placeRing(placeMode.laneId, m, placeMode.kind, placeMode.subId)}
                          />
                        )
                      })}
                    </>
                  )
                })()}
              </g>
            )}

            {/* Rings */}
            {LANES.map((lane, idx) => {
              if (!isLaneVisible(lane.id)) return null
              const visible = getVisibleRings(lane.id)
              // Group by month + kind
              const groups: Record<string, VisibleRing[]> = {}
              for (const r of visible) {
                const k = `${r.month}_${r.kind}`
                if (!groups[k]) groups[k] = []
                groups[k].push(r)
              }
              return (
                <g key={`rings_${lane.id}`}>
                  {Object.entries(groups).map(([key, rings]) => {
                    const [monthStr, kind] = key.split('_')
                    const month = +monthStr
                    const x = g.xForMonth(month)
                    const y = kind === 'cost' ? g.yCostForLane(idx) : g.yAwardForLane(idx)
                    const sorted = [...rings].sort((a, b) => b.amount - a.amount)
                    return sorted.map((ring, ringIdx) => {
                      const r = ringRadius(ring.amount)
                      const color = getSubColorForRing(lane, ring)
                      const isHi =
                        highlight &&
                        highlight.laneId === lane.id &&
                        highlight.kind === ring.kind &&
                        (!highlight.subId || highlight.subId === ring.subId)
                      const isInsp = inspectorRingRef?.ringId === ring.id
                      const baseAlpha = SCALE_ALPHA[ring.scale] || 1
                      const effAlpha = ring.inherited ? baseAlpha * 0.55 : baseAlpha
                      const dur = ring.duration || 0
                      const isPill = dur > 0

                      const elProps = {
                        fill: color,
                        fillOpacity: effAlpha,
                        stroke: isInsp ? '#F0A742' : ring.inherited ? '#9b9b9b' : '#fff',
                        strokeWidth: isInsp ? 3 : ring.inherited ? 1 : 1.5,
                        strokeDasharray: ring.inherited && !isInsp ? '2 2' : undefined,
                        className: `stones-ring${isHi ? ' highlighted' : ''}${ring.inherited ? ' inherited' : ''}`,
                        'data-ring-id': ring.id,
                        onClick: (e: React.MouseEvent) => onRingClick(lane.id, ring.id, e),
                        onDoubleClick: ring.inherited
                          ? undefined
                          : (e: React.MouseEvent) => startDurationDrag(lane.id, ring.id, e as any),
                        style: { cursor: 'pointer' as const },
                      }

                      const labelX = isPill ? (g.xForMonth(month) + g.xForMonth(month + dur)) / 2 : x
                      const showNum = showNumbers && r >= 9
                      const showLock = ring.inherited && r >= 7

                      return (
                        <g key={ring.id}>
                          {isPill ? (
                            <rect
                              x={g.xForMonth(month)}
                              y={y - r}
                              width={Math.max(g.xForMonth(month + dur) - g.xForMonth(month), 4)}
                              height={r * 2}
                              rx={r}
                              ry={r}
                              {...elProps}
                            />
                          ) : (
                            <circle cx={x} cy={y} r={r} {...elProps} />
                          )}

                          {showNum && (
                            <text x={labelX} y={y} className="stones-ring-number">
                              {ringIdx + 1}
                            </text>
                          )}

                          {showLock && (
                            <g pointerEvents="none">
                              <circle
                                cx={isPill ? g.xForMonth(month + dur) - 3 : x + r * 0.7}
                                cy={y - r * 0.7}
                                r={5}
                                fill="#1d1d1f"
                              />
                              <text
                                x={isPill ? g.xForMonth(month + dur) - 3 : x + r * 0.7}
                                y={y - r * 0.7 + 0.5}
                                className="stones-lock-icon"
                              >
                                {ring.originStone}
                              </text>
                            </g>
                          )}

                          {isPill && !ring.inherited && (
                            <rect
                              x={g.xForMonth(month + dur) - 3}
                              y={y - r}
                              width={6}
                              height={r * 2}
                              fill="#1d1d1f"
                              fillOpacity={draggingRingId === ring.id ? 0.65 : 0}
                              style={{ cursor: 'ew-resize' }}
                              onMouseDown={(e) => startDurationDrag(lane.id, ring.id, e as any)}
                              onMouseEnter={(e) => (e.currentTarget as SVGRectElement).setAttribute('fill-opacity', '0.45')}
                              onMouseLeave={(e) => {
                                if (draggingRingId !== ring.id) {
                                  (e.currentTarget as SVGRectElement).setAttribute('fill-opacity', '0')
                                }
                              }}
                            />
                          )}
                        </g>
                      )
                    })
                  })}
                </g>
              )
            })}
          </svg>

          {/* Cumulative table */}
          <div className={`stones-cum-wrap${cumCollapsed ? ' collapsed' : ''}`}>
            <div className="stones-cum-head" onClick={() => setCumCollapsed(!cumCollapsed)}>
              <span className={`stones-cum-chevron${cumCollapsed ? ' collapsed' : ''}`}>▼</span>
              <span className="stones-cum-label">Cumulative table</span>
              <span className="stones-cum-summary">
                <strong style={{ color: 'var(--color-text-primary)' }}>{fmtTight(cumTable.totalCost)}</strong>{' '}
                cost @ {cumTable.horizonLabel}
                {cumTable.realAward > 0 && (
                  <>
                    {' '}·{' '}
                    <strong style={{ color: '#2E6B3E' }}>{fmtTight(cumTable.realAward)}</strong>{' '}
                    {cumTable.realLabel.toLowerCase()} award
                  </>
                )}
              </span>
            </div>

            {!cumCollapsed && (
              <table className="stones-cum-table">
                <thead>
                  <tr>
                    <th>—</th>
                    {cumTable.colLabels.map((l) => (
                      <th key={l}>{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="stones-cost-row">
                    <td>
                      In-period
                      <br />
                      cost
                    </td>
                    {cumTable.cols.map((_, i) => (
                      <td key={i}>{fmtTight(cumTable.inPeriod(i))}</td>
                    ))}
                  </tr>
                  <tr className="stones-cum-row">
                    <td>
                      Cumulative
                      <br />
                      cost
                    </td>
                    {cumTable.cols.map((m, i) => (
                      <td key={i}>{fmtTight(cumTable.cumThrough(m))}</td>
                    ))}
                  </tr>
                  {cumTable.orderedLabels.length > 0 && (
                    <tr className="stones-divider">
                      <td colSpan={cumTable.cols.length + 1} />
                    </tr>
                  )}
                  {cumTable.orderedLabels.map((label) => (
                    <tr key={label} className="stones-award-row">
                      <td>
                        Awarded
                        <br />
                        {label}
                      </td>
                      {cumTable.cols.map((m, i) => {
                        const v = cumTable.awardCum(label, m)
                        return <td key={i}>{v > 0 ? fmtTight(v) : '—'}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Lane configuration drawer */}
        <div className="stones-config-card">
          <div className="stones-config-head">
            <div className="stones-config-title">Lanes — costs & awards</div>
            <div className="stones-config-meta">
              {LANES.filter(l => isLaneVisible(l.id)).length} of {LANES.length} lanes active
            </div>
          </div>

          <div className="stones-config-body">
            {LANES.map((lane) => {
              const laneState = stone.lanes[lane.id]
              const ownerCls = lane.owner === 'sun' ? (lane.id === 'sun_capture' ? 'cap' : 'sun') : 'step'

              let inheritedFromStone: number | null = null
              for (let i = 0; i < activeStoneIdx; i++) {
                if (stones[i]?.lanes[lane.id]?.active) {
                  inheritedFromStone = i + 1
                  break
                }
              }

              const visible = isLaneVisible(lane.id)

              return (
                <div
                  key={lane.id}
                  className={`stones-lane-config${inheritedFromStone ? ' lane-inherited' : ''}`}
                >
                  <div className="stones-lane-head">
                    <div className="stones-lane-name">
                      {lane.label}{' '}
                      <span className={`stones-owner-tag ${ownerCls}`}>{lane.owner.toUpperCase()}</span>
                      {inheritedFromStone && (
                        <span className="stones-inherit-tag" title={`Inherited from Stone 0${inheritedFromStone}`}>
                          ↑ STONE 0{inheritedFromStone}
                        </span>
                      )}
                    </div>
                    {inheritedFromStone ? (
                      <div className="stones-toggle on" style={{ opacity: 0.4, cursor: 'not-allowed' }} title="Inherited — cannot deactivate" />
                    ) : (
                      <div
                        className={`stones-toggle${laneState.active ? ' on' : ''}`}
                        onClick={() => toggleLane(lane.id)}
                      />
                    )}
                  </div>

                  {visible && (
                    <>
                      <Track
                        lane={lane}
                        kind="cost"
                        getVisibleSubs={getVisibleSubs}
                        getVisibleRings={getVisibleRings}
                        highlight={highlight}
                        setHighlight={setHighlight}
                        startPlace={startPlace}
                        renameSub={renameSub}
                        removeSub={removeSub}
                        addSub={addSub}
                      />
                      <Track
                        lane={lane}
                        kind="award"
                        getVisibleSubs={getVisibleSubs}
                        getVisibleRings={getVisibleRings}
                        highlight={highlight}
                        setHighlight={setHighlight}
                        startPlace={startPlace}
                        renameSub={renameSub}
                        removeSub={removeSub}
                        addSub={addSub}
                        suggestAwards={suggestAwards}
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Inspector */}
        {inspectorRingRef && (() => {
          const { laneId, ringId, anchorX, anchorY } = inspectorRingRef
          let ring: Ring | null = null
          let originStone = 0
          for (let i = 0; i < stones.length; i++) {
            const ls = stones[i]?.lanes[laneId]
            if (!ls) continue
            const r = ls.rings.find(r => r.id === ringId)
            if (r) {
              ring = r
              originStone = i + 1
              break
            }
          }
          if (!ring) return null
          const isInherited = originStone - 1 !== activeStoneIdx
          const lane = LANES.find(l => l.id === laneId)!
          let sub: SubCat | null = null
          for (let i = 0; i < stones.length; i++) {
            const ls = stones[i]?.lanes[laneId]
            if (!ls) continue
            const subs = ring.kind === 'cost' ? ls.costSubs : ls.awardSubs
            const s = subs.find(s => s.id === ring!.subId)
            if (s) {
              sub = s
              break
            }
          }
          const peers = getVisibleRings(laneId)
            .filter(r => r.kind === ring!.kind && r.month === ring!.month)
            .sort((a, b) => b.amount - a.amount)
          const ringNum = peers.findIndex(r => r.id === ringId) + 1
          const peerCount = peers.length

          const left = Math.min(window.innerWidth - 290, anchorX + 12)
          const top = anchorY + 12

          return (
            <div
              className="stones-inspector"
              style={{ left, top }}
              onClick={(e) => e.stopPropagation()}
            >
              <h4 className="stones-inspector-title">
                {lane.label} · {sub?.label || '—'}{' '}
                <span className={`stones-kind-tag ${ring.kind}`}>{ring.kind.toUpperCase()}</span>
                <span className="stones-ring-num-badge">
                  #{ringNum}
                  {peerCount > 1 ? ` of ${peerCount}` : ''}
                </span>
              </h4>

              {isInherited && (
                <div className="stones-inherit-banner">
                  <span>
                    <strong>Inherited from Stone 0{originStone}</strong> — read-only here.
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setInspectorRingRef(null)
                      selectStone(originStone - 1)
                    }}
                  >
                    Jump to Stone 0{originStone}
                  </button>
                </div>
              )}

              {peerCount > 1 && (
                <div className="stones-cycle-row">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      cycleInspectorRing(-1)
                    }}
                  >
                    ← prev ring
                  </button>
                  <span className="stones-cycle-hint">size order</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      cycleInspectorRing(1)
                    }}
                  >
                    next ring →
                  </button>
                </div>
              )}

              <div className="stones-inspector-row">
                <label>Start month</label>
                <input
                  type="number"
                  min={0}
                  max={stone.horizonMonths}
                  value={ring.month}
                  readOnly={isInherited}
                  onChange={(e) =>
                    updateRing(laneId, ringId, {
                      month: Math.max(0, Math.min(stone.horizonMonths, +e.target.value)),
                    })
                  }
                />
              </div>
              <div className="stones-inspector-row">
                <label>Duration (months)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={ring.duration || 0}
                  readOnly={isInherited}
                  onChange={(e) =>
                    updateRing(laneId, ringId, {
                      duration: Math.max(0, Math.min(stone.horizonMonths - ring!.month, +e.target.value || 0)),
                    })
                  }
                />
              </div>
              <div className="stones-inspector-row">
                <label>Amount ($)</label>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={ring.amount}
                  readOnly={isInherited}
                  onChange={(e) => updateRing(laneId, ringId, { amount: +e.target.value })}
                />
              </div>
              <div className="stones-inspector-row">
                <label>Confidence × likelihood</label>
                <div className="stones-scale">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={ring!.scale === n ? 'on' : ''}
                      disabled={isInherited}
                      onClick={(e) => {
                        e.stopPropagation()
                        updateRing(laneId, ringId, { scale: n })
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {!isInherited && (
                  <button
                    className="stones-nest-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      addNestedRing()
                    }}
                  >
                    + Nest another ring here
                  </button>
                )}
                <button
                  className="stones-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteRing(laneId, ringId)
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          )
        })()}
      </div>
    </>
  )
}

// =============================================================================
// TRACK SUB-COMPONENT — costs or awards row in a lane config
// =============================================================================
interface TrackProps {
  lane: LaneDef
  kind: Kind
  getVisibleSubs: (laneId: string, kind: Kind) => VisibleSub[]
  getVisibleRings: (laneId: string) => VisibleRing[]
  highlight: { laneId: string; kind: Kind; subId?: string } | null
  setHighlight: (h: { laneId: string; kind: Kind; subId?: string } | null) => void
  startPlace: (laneId: string, kind: Kind, subId: string) => void
  renameSub: (laneId: string, kind: Kind, subId: string, newLabel: string) => void
  removeSub: (laneId: string, kind: Kind, subId: string) => void
  addSub: (laneId: string, kind: Kind) => void
  suggestAwards?: (laneId: string) => void
}

function Track({
  lane,
  kind,
  getVisibleSubs,
  getVisibleRings,
  highlight,
  setHighlight,
  startPlace,
  renameSub,
  removeSub,
  addSub,
  suggestAwards,
}: TrackProps) {
  const subs = getVisibleSubs(lane.id, kind)
  const visible = getVisibleRings(lane.id)
  const ownCount = visible.filter(r => r.kind === kind && !r.inherited).length
  const inhCount = visible.filter(r => r.kind === kind && r.inherited).length
  const family = kind === 'cost' ? lane.family : 'award'
  const trackLabel = kind === 'cost' ? 'COSTS' : 'AWARDS'

  return (
    <div className={`stones-track ${kind}-track`}>
      <div className="stones-track-head">
        <div className={`stones-track-label${kind === 'award' ? ' award' : ''}`}>{trackLabel}</div>
        {kind === 'award' && suggestAwards && (
          <button className="stones-suggest-btn" onClick={() => suggestAwards(lane.id)}>
            Suggest doctrine awards →
          </button>
        )}
      </div>

      <div className="stones-subcats">
        {subs.map((sub) => {
          const color = PALETTE[family][sub.shadeIdx]
          const isHi = highlight?.laneId === lane.id && highlight.kind === kind && highlight.subId === sub.id
          const cls = `stones-chip${isHi ? ' highlighted' : ''}${sub.inherited ? ' chip-inherited' : ''}`
          return (
            <span
              key={sub.id}
              className={cls}
              onMouseEnter={() => setHighlight({ laneId: lane.id, kind, subId: sub.id })}
              onMouseLeave={() => setHighlight(null)}
              title={sub.inherited ? `Inherited from Stone 0${sub.originStone}` : undefined}
            >
              <span className="stones-swatch" style={{ background: color }} />
              {sub.inherited ? (
                <>
                  <span className="stones-sub-readonly">{sub.label}</span>
                  <span className="stones-inherit-tag-small">Stone 0{sub.originStone}</span>
                  <button className="stones-place-btn" onClick={() => startPlace(lane.id, kind, sub.id)}>
                    + place
                  </button>
                </>
              ) : (
                <>
                  <input
                    className="stones-label-input"
                    value={sub.label}
                    onChange={(e) => renameSub(lane.id, kind, sub.id, e.target.value)}
                  />
                  <button className="stones-place-btn" onClick={() => startPlace(lane.id, kind, sub.id)}>
                    + place
                  </button>
                  <span className="stones-x-btn" onClick={() => removeSub(lane.id, kind, sub.id)}>
                    ×
                  </span>
                </>
              )}
            </span>
          )
        })}
        {subs.length < MAX_SUBS && (
          <button className="stones-add-sub-btn" onClick={() => addSub(lane.id, kind)}>
            + Add sub-category
          </button>
        )}
      </div>

      <div className="stones-ring-count">
        {inhCount > 0
          ? `${ownCount} placed on this stone · ${inhCount} inherited`
          : `${ownCount} ring${ownCount === 1 ? '' : 's'} placed`}
      </div>
    </div>
  )
}

// =============================================================================
// STYLES — scoped to .stones-* classes; uses platform CSS vars for chrome,
// but ring/lane palette colors stay literal (defined inline at point of use).
// =============================================================================
const STYLES = `
.stones-shell {
  padding: 24px 28px 32px;
  font-family: var(--font-text);
  color: var(--color-text-primary);
}

/* Place-mode banner */
.stones-place-banner {
  position: sticky;
  top: 0;
  background: #F0A742;
  color: #1d1d1f;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
}
.stones-place-banner button {
  background: #1d1d1f;
  color: #fff;
  border: none;
  padding: 4px 10px;
  margin-left: auto;
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

/* Header strip */
.stones-headstrip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.stones-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  margin-bottom: 4px;
}
.stones-headline {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.011em;
}
.stones-savestate {
  font-size: 12px;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.stones-savestate[data-state="dirty"] { color: #F0A742; }
.stones-savestate[data-state="saving"] { color: var(--color-accent); }
.stones-savestate[data-state="saved"] { color: #2E6B3E; }
.stones-savestate[data-state="error"] { color: var(--color-danger); }

/* Stone tabs */
.stones-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--color-hairline);
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.stones-tab {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-tertiary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-family: inherit;
  transition: color .12s ease, border-color .12s ease;
}
.stones-tab:hover { color: var(--color-text-primary); }
.stones-tab.active {
  color: var(--color-text-primary);
  font-weight: 600;
  border-bottom-color: #F0A742;
}
.stones-badge {
  display: inline-block;
  padding: 2px 8px;
  margin-left: 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  background: var(--color-bg-subtle, rgba(0,0,0,0.06));
  color: var(--color-text-tertiary);
}
.stones-tab.active .stones-badge { background: #F0A742; color: #fff; }

/* Status bar */
.stones-statusbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.stones-pillgroup {
  display: inline-flex;
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  overflow: hidden;
}
.stones-pill {
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-tertiary);
  background: var(--color-bg-elevated);
  border: none;
  border-right: 1px solid var(--color-hairline);
  cursor: pointer;
  font-family: inherit;
}
.stones-pill:last-child { border-right: none; }
.stones-pill.on { background: var(--color-text-primary); color: var(--color-bg-elevated); }
.stones-pill.deferred-on { background: var(--color-text-tertiary); color: #fff; }
.stones-pill.na-on { background: #8B2A1F; color: #fff; }

.stones-horizon {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-tertiary);
}
.stones-horizon input {
  width: 56px;
  padding: 4px 6px;
  font-family: inherit;
  font-size: 12px;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  text-align: right;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

/* Chart card */
.stones-chart-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
  position: sticky;
  top: 12px;
  z-index: 50;
  transition: box-shadow .15s ease;
}
.stones-chart-card.stones-stuck {
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
}
.stones-chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}
.stones-chart-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
}
.stones-legend {
  font-size: 11px;
  color: var(--color-text-tertiary);
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
}
.stones-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 5px;
  vertical-align: -1px;
}

/* SVG */
.stones-chart {
  width: 100%;
  height: 460px;
  overflow: visible;
  user-select: none;
}
.stones-chart text { font-family: var(--font-text); }
.stones-lane-row { fill: var(--color-text-tertiary); font-size: 11px; }
.stones-lane-rule { stroke: var(--color-hairline); stroke-width: 1; stroke-dasharray: 2 3; }
.stones-x-tick { fill: var(--color-text-tertiary); font-size: 10px; }
.stones-x-axis { stroke: var(--color-text-tertiary); stroke-opacity: 0.4; stroke-width: 1; }
.stones-lane-aux { fill: var(--color-text-tertiary); fill-opacity: 0.6; font-size: 9px; }
.stones-band-cost { fill: rgba(0,0,0,0.015); }
.stones-band-award { fill: rgba(46,107,62,0.025); }
.stones-ring { transition: stroke .1s ease, stroke-width .1s ease; }
.stones-ring:hover { stroke: var(--color-text-primary); stroke-width: 2; }
.stones-ring.highlighted { stroke: #F0A742; stroke-width: 3; }
.stones-ring.inherited:hover { stroke: #F0A742 !important; stroke-width: 2; stroke-dasharray: none !important; }
.stones-ring-number {
  font-size: 9px;
  font-weight: 700;
  fill: #fff;
  pointer-events: none;
  text-anchor: middle;
  dominant-baseline: central;
  paint-order: stroke fill;
  stroke: rgba(0,0,0,0.55);
  stroke-width: 2.5;
  stroke-linejoin: round;
}
.stones-lock-icon {
  font-size: 7.5px;
  font-weight: 700;
  fill: #F0A742;
  text-anchor: middle;
  dominant-baseline: central;
}

/* Cumulative table */
.stones-cum-wrap {
  margin-top: 16px;
  border-top: 1px solid var(--color-hairline);
  overflow-x: auto;
}
.stones-cum-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0 8px;
  cursor: pointer;
  user-select: none;
}
.stones-cum-head:hover { color: #F0A742; }
.stones-cum-chevron {
  display: inline-block;
  transition: transform .15s ease;
  color: var(--color-text-tertiary);
  font-size: 10px;
}
.stones-cum-chevron.collapsed { transform: rotate(-90deg); }
.stones-cum-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
}
.stones-cum-summary {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.stones-cum-table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
.stones-cum-table thead th, .stones-cum-table tbody td { white-space: nowrap; }
.stones-cum-table thead th {
  background: var(--color-text-primary);
  color: var(--color-bg-elevated);
  padding: 6px 4px;
  text-align: right;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.stones-cum-table thead th:first-child {
  text-align: left;
  padding-left: 10px;
  min-width: 90px;
  max-width: 110px;
}
.stones-cum-table tbody td {
  padding: 6px 4px;
  border-bottom: 1px solid var(--color-hairline);
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}
.stones-cum-table tbody td:first-child {
  text-align: left;
  padding-left: 10px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  min-width: 90px;
  max-width: 110px;
  white-space: normal;
  line-height: 1.25;
}
.stones-cum-table tbody tr.stones-cost-row td:not(:first-child) { color: var(--color-text-primary); font-weight: 500; }
.stones-cum-table tbody tr.stones-cum-row td:not(:first-child) { color: var(--color-text-primary); font-weight: 700; }
.stones-cum-table tbody tr.stones-award-row td:not(:first-child) { color: #2E6B3E; font-weight: 500; }
.stones-cum-table tbody tr.stones-divider td { padding: 4px; background: var(--color-bg-subtle); border-bottom: none; }

/* Lane config card */
.stones-config-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}
.stones-config-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.stones-config-title { font-size: 14px; font-weight: 600; }
.stones-config-meta { font-size: 11px; color: var(--color-text-tertiary); }

.stones-lane-config {
  padding: 14px 0;
  border-bottom: 1px solid var(--color-hairline);
}
.stones-lane-config:last-child { border-bottom: none; }
.stones-lane-config.lane-inherited {
  background: rgba(240,167,66,0.025);
  border-radius: 6px;
  padding-left: 8px;
  margin-left: -8px;
}
.stones-lane-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.stones-lane-name {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.stones-owner-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--color-text-tertiary);
}
.stones-owner-tag.sun { color: #C77A0F; }
.stones-owner-tag.cap { color: #48484A; }
.stones-owner-tag.step { color: #9B3838; }
.stones-inherit-tag {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: #F0A742;
  background: rgba(240,167,66,0.10);
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.stones-toggle {
  position: relative;
  width: 36px;
  height: 20px;
  background: var(--color-hairline);
  border-radius: 10px;
  cursor: pointer;
  transition: background .14s ease;
}
.stones-toggle.on { background: #F0A742; }
.stones-toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  transition: left .14s ease;
  box-shadow: 0 1px 2px rgba(0,0,0,0.18);
}
.stones-toggle.on::after { left: 18px; }

.stones-track {
  margin-top: 10px;
  padding-left: 8px;
  border-left: 2px solid var(--color-hairline);
}
.stones-track.cost-track { border-left-color: #C7C7CC; }
.stones-track.award-track { border-left-color: #6FA67C; }
.stones-track-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.stones-track-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
}
.stones-track-label.award { color: #2E6B3E; }
.stones-suggest-btn {
  background: rgba(46,107,62,0.08);
  color: #2E6B3E;
  border: 1px solid rgba(46,107,62,0.20);
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.stones-suggest-btn:hover { background: rgba(46,107,62,0.14); }

.stones-subcats { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.stones-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px 4px 6px;
  border-radius: 12px;
  font-size: 11px;
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
  transition: background .12s ease, box-shadow .12s ease;
}
.stones-chip.highlighted {
  background: rgba(240,167,66,0.18);
  box-shadow: 0 0 0 2px #F0A742;
}
.stones-chip.chip-inherited {
  background: rgba(240,167,66,0.06);
  border: 1px dashed rgba(240,167,66,0.30);
}
.stones-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid rgba(0,0,0,0.12);
}
.stones-label-input {
  background: transparent;
  border: none;
  font-size: 11px;
  font-family: inherit;
  color: var(--color-text-primary);
  width: 100px;
  padding: 2px;
}
.stones-label-input:focus { outline: 1px solid #F0A742; border-radius: 3px; }
.stones-sub-readonly { font-size: 11px; color: var(--color-text-primary); padding: 2px 4px; }
.stones-inherit-tag-small {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: #F0A742;
  text-transform: uppercase;
}
.stones-place-btn {
  background: var(--color-text-primary);
  color: var(--color-bg-elevated);
  border: none;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.stones-x-btn { cursor: pointer; opacity: 0.4; padding: 0 2px; }
.stones-x-btn:hover { opacity: 1; }
.stones-add-sub-btn {
  background: transparent;
  border: 1px dashed var(--color-hairline);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  color: var(--color-text-tertiary);
  cursor: pointer;
  font-family: inherit;
}
.stones-add-sub-btn:hover { color: var(--color-text-primary); border-color: var(--color-text-tertiary); }

.stones-ring-count { font-size: 10px; color: var(--color-text-tertiary); margin-top: 4px; }

/* Inspector */
.stones-inspector {
  position: fixed;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  padding: 14px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  z-index: 200;
  min-width: 260px;
}
.stones-inspector-title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
}
.stones-kind-tag {
  display: inline-block;
  padding: 1px 6px;
  margin-left: 6px;
  border-radius: 4px;
  font-size: 9px;
  letter-spacing: 0.1em;
}
.stones-kind-tag.cost { background: var(--color-bg-subtle); color: var(--color-text-primary); }
.stones-kind-tag.award { background: rgba(46,107,62,0.12); color: #2E6B3E; }
.stones-ring-num-badge {
  float: right;
  font-weight: 600;
  color: var(--color-text-primary);
  background: rgba(240,167,66,0.18);
  padding: 2px 6px;
  border-radius: 4px;
}
.stones-inherit-banner {
  background: rgba(240,167,66,0.10);
  border: 1px solid rgba(240,167,66,0.30);
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 8px;
  font-size: 11px;
  color: #8C5208;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.stones-inherit-banner button {
  background: var(--color-text-primary);
  color: var(--color-bg-elevated);
  border: none;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.stones-cycle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--color-hairline);
  padding-top: 8px;
  margin-bottom: 4px;
}
.stones-cycle-row button {
  font-size: 11px;
  background: var(--color-bg-subtle);
  border: none;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  color: var(--color-text-primary);
}
.stones-cycle-hint { font-size: 10px; color: var(--color-text-tertiary); }
.stones-inspector-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: 13px;
}
.stones-inspector-row label { color: var(--color-text-tertiary); font-size: 12px; }
.stones-inspector-row input {
  padding: 4px 8px;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  text-align: right;
  width: 110px;
  font-variant-numeric: tabular-nums;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}
.stones-inspector-row input[readonly] { opacity: 0.6; }
.stones-scale { display: flex; gap: 2px; }
.stones-scale button {
  width: 22px;
  height: 22px;
  background: var(--color-bg-subtle);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  color: var(--color-text-tertiary);
}
.stones-scale button.on { background: #F0A742; color: #fff; }
.stones-scale button:disabled { opacity: 0.5; cursor: not-allowed; }
.stones-nest-btn {
  flex: 1;
  padding: 6px;
  background: rgba(240,167,66,0.10);
  color: #8C5208;
  border: 1px solid rgba(240,167,66,0.35);
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.stones-delete-btn {
  flex: 0 0 auto;
  padding: 6px 10px;
  background: transparent;
  color: #8B2A1F;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.stones-delete-btn:hover { background: rgba(139,42,31,0.06); border-color: #8B2A1F; }

/* Honor Capture lane label color in light mode (the grey #C7C7CC is too light to read on white).
   In light mode we use the deeper grey for label readability while rings stay literal. */
[data-theme="dark"] .stones-cum-table thead th {
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
}
`
