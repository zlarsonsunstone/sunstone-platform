/**
 * useBriefJob — React hook for the brief generation flow
 *
 * Flow:
 *   1. Caller invokes generate(strategicProfileId)
 *   2. Hook creates a brief_jobs row (status='queued')
 *   3. Hook POSTs to /.netlify/functions/build-recon-engine-background
 *      with { brief_job_id }. Function returns 202 immediately.
 *   4. Hook polls the brief_jobs row every 3s until status='done' or 'error'
 *   5. On 'done', hook fetches the recon_briefs row from result.brief_id
 *      and exposes the full rendered_payload via the brief field
 *   6. Surfaces intermediate_outputs as they update so UI can show progress
 *
 * State:
 *   status:               'idle' | 'creating' | 'running' | 'done' | 'error'
 *   error:                string | null
 *   currentStage:         string | null (e.g. 'trajectory', 'peer_cohort', 'recon_brief', 'stones', 'what_about')
 *   stagesCompleted:      string[] (in completion order)
 *   brief:                ReconBrief | null
 *   intermediate_outputs: Record<string, unknown>
 *
 * Mirrors the platform's existing waitForJob pattern. Polling resolves
 * after 5min timeout regardless of job status — prevents hung UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type BriefJobStatus = 'idle' | 'creating' | 'running' | 'done' | 'error'

export interface ReconBriefRow {
  id: string
  tenant_id: string
  strategic_profile_id: string
  version: number
  is_current: boolean
  rendered_payload: Record<string, unknown>
  input_snapshot: Record<string, unknown>
  axis_code_used?: string | null
  market_state_used?: string | null
  created_at: string
}

export interface UseBriefJobResult {
  status: BriefJobStatus
  error: string | null
  currentStage: string | null
  stagesCompleted: string[]
  brief: ReconBriefRow | null
  intermediate_outputs: Record<string, unknown>
  generate: (strategicProfileId: string, tenantId: string) => Promise<void>
  reset: () => void
  loadCurrentBrief: (strategicProfileId: string) => Promise<void>
}

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 5 * 60 * 1000   // 5 min

const PIPELINE_STAGES = ['trajectory', 'peer_cohort', 'recon_brief', 'stones', 'what_about']

export function useBriefJob(): UseBriefJobResult {
  const [status, setStatus] = useState<BriefJobStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [currentStage, setCurrentStage] = useState<string | null>(null)
  const [stagesCompleted, setStagesCompleted] = useState<string[]>([])
  const [brief, setBrief] = useState<ReconBriefRow | null>(null)
  const [intermediateOutputs, setIntermediateOutputs] = useState<Record<string, unknown>>({})

  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false })

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelRef.current.cancelled = true
    }
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setError(null)
    setCurrentStage(null)
    setStagesCompleted([])
    setBrief(null)
    setIntermediateOutputs({})
  }, [])

  const loadCurrentBrief = useCallback(async (strategicProfileId: string) => {
    const { data, error: loadErr } = await supabase
      .from('recon_briefs')
      .select('*')
      .eq('strategic_profile_id', strategicProfileId)
      .eq('is_current', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (loadErr) {
      console.error('loadCurrentBrief error:', loadErr.message)
      return
    }
    if (data) {
      setBrief(data as ReconBriefRow)
      setStatus('done')
    }
  }, [])

  const generate = useCallback(async (strategicProfileId: string, tenantId: string) => {
    cancelRef.current.cancelled = false
    setError(null)
    setCurrentStage(null)
    setStagesCompleted([])
    setBrief(null)
    setIntermediateOutputs({})
    setStatus('creating')

    try {
      // -----------------------------------------------------------------------
      // 1. Create brief_jobs row
      // -----------------------------------------------------------------------
      const { data: jobRow, error: createErr } = await supabase
        .from('brief_jobs')
        .insert({
          tenant_id: tenantId,
          strategic_profile_id: strategicProfileId,
          status: 'queued',
        })
        .select()
        .single()
      if (createErr || !jobRow) {
        throw new Error(`brief_jobs insert failed: ${createErr?.message || 'unknown error'}`)
      }
      const briefJobId = jobRow.id

      // -----------------------------------------------------------------------
      // 2. POST to background function (fire-and-forget — expects 202)
      // -----------------------------------------------------------------------
      setStatus('running')
      const fnUrl = '/.netlify/functions/build-recon-engine-background'
      const fnResp = await fetch(fnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief_job_id: briefJobId }),
      })
      if (!fnResp.ok && fnResp.status !== 202) {
        const errText = await fnResp.text().catch(() => '')
        throw new Error(`Function call failed (${fnResp.status}): ${errText.slice(0, 300)}`)
      }

      // -----------------------------------------------------------------------
      // 3. Poll brief_jobs every 3s
      // -----------------------------------------------------------------------
      const startedAt = Date.now()
      while (!cancelRef.current.cancelled) {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          throw new Error('Brief generation timed out after 5 minutes')
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
        if (cancelRef.current.cancelled) return

        const { data: pollRow, error: pollErr } = await supabase
          .from('brief_jobs')
          .select('*')
          .eq('id', briefJobId)
          .maybeSingle()
        if (pollErr) {
          console.warn('Poll error (will retry):', pollErr.message)
          continue
        }
        if (!pollRow) continue

        // Update intermediate progress
        const intOutputs = (pollRow.intermediate_outputs || {}) as Record<string, unknown>
        setIntermediateOutputs(intOutputs)
        const completed = PIPELINE_STAGES.filter(s => intOutputs[s] !== undefined)
        setStagesCompleted(completed)

        // Determine current stage = first stage NOT yet in intOutputs
        const next = PIPELINE_STAGES.find(s => intOutputs[s] === undefined)
        setCurrentStage(next || null)

        if (pollRow.status === 'done') {
          // Fetch the actual brief
          const briefId = (pollRow.result as { brief_id?: string } | null)?.brief_id
          if (briefId) {
            const { data: briefRow } = await supabase
              .from('recon_briefs')
              .select('*')
              .eq('id', briefId)
              .maybeSingle()
            if (briefRow) setBrief(briefRow as ReconBriefRow)
          }
          setCurrentStage(null)
          setStatus('done')
          return
        }
        if (pollRow.status === 'error') {
          throw new Error(pollRow.error || 'Brief generation failed (no error message)')
        }
        // status === 'queued' or 'running' — keep polling
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('useBriefJob.generate error:', msg)
      setError(msg)
      setStatus('error')
    }
  }, [])

  return {
    status,
    error,
    currentStage,
    stagesCompleted,
    brief,
    intermediate_outputs: intermediateOutputs,
    generate,
    reset,
    loadCurrentBrief,
  }
}
