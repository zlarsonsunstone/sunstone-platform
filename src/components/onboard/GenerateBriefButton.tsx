/**
 * GenerateBriefButton — the "Generate Recon Brief" affordance for a strategic profile
 *
 * Drops into OnboardTab's strategic profile card. Owns the full flow:
 *   - Disabled with reason text when readiness gates fail
 *   - Active button when generate_ready
 *   - Pipeline progress shown inline (5 stages: trajectory → peer_cohort → recon_brief → stones → what_about)
 *   - On done: opens BriefPreview modal showing the generated content
 *   - On error: shows error inline with retry option
 *   - Loads existing current brief on mount so you can re-open it without regenerating
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/Button'
import { useBriefJob } from '@/lib/useBriefJob'
import { BriefPreview } from '@/components/onboard/BriefPreview'
import type { ReadinessState } from '@/lib/recon'

interface Props {
  strategicProfileId: string
  tenantId: string
  readiness: ReadinessState
}

const STAGE_LABELS: Record<string, string> = {
  trajectory:  'Stage 1 of 5 — Extracting trajectory milestones',
  peer_cohort: 'Stage 2 of 5 — Composing peer cohort',
  recon_brief: 'Stage 3 of 5 — Writing Recon Brief BLUF',
  stones:      'Stage 4 of 5 — Composing 4 Stone narratives',
  what_about:  'Stage 5 of 5 — Generating "What about..." pairs',
}

export function GenerateBriefButton({ strategicProfileId, tenantId, readiness }: Props) {
  const job = useBriefJob()
  const [showPreview, setShowPreview] = useState(false)

  // Load any existing current brief on mount so user sees it's already generated
  useEffect(() => {
    job.loadCurrentBrief(strategicProfileId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategicProfileId])

  // Auto-open preview when generation completes
  useEffect(() => {
    if (job.status === 'done' && job.brief) {
      setShowPreview(true)
    }
  }, [job.status, job.brief])

  function handleGenerate() {
    job.generate(strategicProfileId, tenantId)
  }

  function handleRegenerate() {
    job.reset()
    job.generate(strategicProfileId, tenantId)
  }

  // ---------------------------------------------------------------------------
  // RENDER STATES
  // ---------------------------------------------------------------------------
  const reasonForDisable = !readiness.cbp_ready
    ? 'Build CBP first'
    : !readiness.frame_ready
    ? 'Compose Framing the Frame first'
    : !readiness.research_ready
    ? 'Surface Research not yet sufficient'
    : !readiness.stones_ready
    ? 'Configure Stones first'
    : null

  return (
    <div className="gbb-shell">
      <style>{STYLES}</style>

      {/* IDLE — no brief yet, gates not all met */}
      {job.status === 'idle' && !job.brief && reasonForDisable && (
        <div className="gbb-disabled">
          <span className="gbb-lock">⚿</span>
          <span className="gbb-disabled-text">
            <strong>Generate Recon Brief</strong>
            <span>{reasonForDisable}</span>
          </span>
        </div>
      )}

      {/* IDLE — gates met, ready to generate (no brief yet) */}
      {job.status === 'idle' && !job.brief && !reasonForDisable && (
        <Button variant="primary" onClick={handleGenerate}>
          Generate Recon Brief
        </Button>
      )}

      {/* IDLE — existing brief loaded, show "view + regenerate" */}
      {job.status === 'done' && job.brief && !showPreview && (
        <div className="gbb-existing">
          <Button variant="secondary" onClick={() => setShowPreview(true)}>
            View current brief (v{job.brief.version})
          </Button>
          {!reasonForDisable && (
            <button type="button" className="gbb-regen" onClick={handleRegenerate}>
              Regenerate
            </button>
          )}
        </div>
      )}

      {/* CREATING — brief_jobs row being inserted */}
      {job.status === 'creating' && (
        <div className="gbb-progress">
          <div className="gbb-spinner" />
          <span className="gbb-progress-text">Initializing brief generation…</span>
        </div>
      )}

      {/* RUNNING — pipeline in progress */}
      {job.status === 'running' && (
        <div className="gbb-progress">
          <div className="gbb-spinner" />
          <div className="gbb-progress-detail">
            <div className="gbb-progress-text">
              {job.currentStage
                ? STAGE_LABELS[job.currentStage] || `Running stage: ${job.currentStage}`
                : 'Pipeline starting…'}
            </div>
            <div className="gbb-stage-track">
              {Object.entries(STAGE_LABELS).map(([stageKey]) => {
                const isCompleted = job.stagesCompleted.includes(stageKey)
                const isCurrent = job.currentStage === stageKey
                return (
                  <div
                    key={stageKey}
                    className={`gbb-stage-dot${isCompleted ? ' completed' : ''}${isCurrent ? ' current' : ''}`}
                    title={STAGE_LABELS[stageKey]}
                  />
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ERROR — show message + retry */}
      {job.status === 'error' && (
        <div className="gbb-error">
          <div className="gbb-error-header">
            <span className="gbb-error-icon">✗</span>
            <span>Brief generation failed</span>
          </div>
          <div className="gbb-error-msg">{job.error}</div>
          <div className="gbb-error-actions">
            <button type="button" className="gbb-retry" onClick={handleRegenerate}>
              Retry
            </button>
            <button type="button" className="gbb-dismiss" onClick={job.reset}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* PREVIEW MODAL */}
      {showPreview && job.brief && (
        <BriefPreview brief={job.brief} onClose={() => setShowPreview(false)} />
      )}
    </div>
  )
}

const STYLES = `
.gbb-shell {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.gbb-disabled {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--color-bg-subtle);
  border: 1px dashed var(--color-hairline);
  border-radius: 8px;
  color: var(--color-text-tertiary);
}
.gbb-lock {
  font-size: 14px;
  color: var(--color-text-tertiary);
}
.gbb-disabled-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.gbb-disabled-text strong {
  font-weight: 600;
  color: var(--color-text-secondary);
}

.gbb-existing {
  display: flex;
  align-items: center;
  gap: 10px;
}

.gbb-regen {
  background: none;
  border: none;
  font-family: inherit;
  font-size: 11px;
  color: #C77A0F;
  cursor: pointer;
  padding: 4px 0;
  font-weight: 500;
}
.gbb-regen:hover { text-decoration: underline; }

.gbb-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: rgba(240,167,66,0.06);
  border: 1px solid rgba(240,167,66,0.30);
  border-radius: 8px;
}
.gbb-progress-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gbb-progress-text {
  font-size: 12px;
  color: var(--color-text-primary);
  font-weight: 500;
}
.gbb-stage-track {
  display: flex;
  gap: 5px;
}
.gbb-stage-dot {
  width: 28px;
  height: 4px;
  background: var(--color-hairline);
  border-radius: 2px;
  transition: background .18s ease;
}
.gbb-stage-dot.completed {
  background: #F0A742;
}
.gbb-stage-dot.current {
  background: #C77A0F;
  animation: gbb-pulse 1.2s ease-in-out infinite;
}
@keyframes gbb-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}

.gbb-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(240,167,66,0.25);
  border-top-color: #F0A742;
  border-radius: 50%;
  animation: gbb-spin .8s linear infinite;
  flex-shrink: 0;
}
@keyframes gbb-spin {
  to { transform: rotate(360deg); }
}

.gbb-error {
  padding: 12px 14px;
  background: rgba(155,56,56,0.06);
  border: 1px solid rgba(155,56,56,0.30);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gbb-error-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #9B3838;
}
.gbb-error-icon {
  font-size: 14px;
}
.gbb-error-msg {
  font-size: 11px;
  color: var(--color-text-secondary);
  font-family: 'SF Mono', Menlo, monospace;
  background: rgba(155,56,56,0.04);
  padding: 6px 8px;
  border-radius: 4px;
  word-break: break-word;
  max-height: 100px;
  overflow-y: auto;
}
.gbb-error-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.gbb-retry,
.gbb-dismiss {
  padding: 5px 12px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  border: none;
  font-weight: 500;
}
.gbb-retry {
  background: #9B3838;
  color: white;
}
.gbb-dismiss {
  background: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-hairline);
}
`
