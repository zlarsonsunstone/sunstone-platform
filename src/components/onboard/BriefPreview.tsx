/**
 * BriefPreview — debug/preview view for a generated Recon Brief
 *
 * Gate 4b ships text content only (JSON output from the brief generator
 * pipeline). This modal renders that JSON in a readable, collapsible form.
 *
 * Gate 4c will replace this with the actual HTML/PDF render. This component
 * is intentionally lightweight — it exists to validate the pipeline produces
 * the expected output shape before we invest in render polish.
 */

import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import type { ReconBriefRow } from '@/lib/useBriefJob'

interface Props {
  brief: ReconBriefRow
  onClose: () => void
}

const SECTION_ORDER = [
  { key: 'recon_brief',  label: 'Recon Brief — BLUF + posture' },
  { key: 'trajectory',   label: 'Trajectory — milestones' },
  { key: 'peer_cohort',  label: 'Peer Cohort — quartile structure' },
  { key: 'options_deck', label: 'Options Deck — full container' },
]

export function BriefPreview({ brief, onClose }: Props) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['recon_brief']))
  const [copied, setCopied] = useState(false)

  function toggle(key: string) {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function copyJSON() {
    const json = JSON.stringify(brief.rendered_payload, null, 2)
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      console.error('Clipboard write failed')
    }
  }

  const payload = brief.rendered_payload as Record<string, unknown>
  const briefSection      = (payload.recon_brief  as Record<string, unknown>) || {}
  const trajectorySection = (payload.options_deck as Record<string, unknown>)?.trajectory  || briefSection.trajectory
  const peerCohortSection = (payload.options_deck as Record<string, unknown>)?.peer_cohort || briefSection.peer_cohort
  const optionsSection    = payload.options_deck

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Recon Brief Preview · v${brief.version}`}
      size="full"
      footer={
        <>
          <div style={{ flex: 1, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {brief.axis_code_used && <span>axis: <code style={{ color: '#C77A0F' }}>{brief.axis_code_used}</code></span>}
            {brief.axis_code_used && brief.market_state_used && <span> · </span>}
            {brief.market_state_used && <span>market_state: {brief.market_state_used}</span>}
          </div>
          <Button variant="secondary" onClick={copyJSON}>{copied ? '✓ Copied' : 'Copy JSON'}</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </>
      }
    >
      <style>{STYLES}</style>

      <div className="bp-shell">
        <div className="bp-banner">
          <div className="bp-banner-eyebrow">GATE 4B PREVIEW</div>
          <div className="bp-banner-body">
            This is the raw pipeline output — JSON content from the brief generator.
            Gate 4c (next phase) renders this into the 1pp Recon Brief PDF + 7pp Options deck PDF.
            Use this view to verify the content is correct before investing in render polish.
          </div>
        </div>

        {SECTION_ORDER.map(({ key, label }) => {
          let data: unknown = null
          if (key === 'recon_brief')       data = briefSection
          else if (key === 'trajectory')   data = trajectorySection
          else if (key === 'peer_cohort')  data = peerCohortSection
          else if (key === 'options_deck') data = optionsSection

          const isOpen = openSections.has(key)
          const hasData = data !== null && data !== undefined && Object.keys(data as object).length > 0

          return (
            <section key={key} className="bp-section">
              <button type="button" className="bp-section-header" onClick={() => toggle(key)}>
                <span className="bp-chevron">{isOpen ? '▾' : '▸'}</span>
                <span className="bp-section-label">{label}</span>
                {!hasData && <span className="bp-empty-tag">empty</span>}
              </button>
              {isOpen && (
                <div className="bp-section-body">
                  {hasData ? (
                    <pre className="bp-json">{JSON.stringify(data, null, 2)}</pre>
                  ) : (
                    <div className="bp-empty">No data for this section.</div>
                  )}
                </div>
              )}
            </section>
          )
        })}

        <details className="bp-raw">
          <summary>Raw rendered_payload (full JSON dump)</summary>
          <pre className="bp-json">{JSON.stringify(brief.rendered_payload, null, 2)}</pre>
        </details>

        <details className="bp-raw">
          <summary>input_snapshot (what the pipeline read from DB at generation time)</summary>
          <pre className="bp-json">{JSON.stringify(brief.input_snapshot, null, 2)}</pre>
        </details>
      </div>
    </Modal>
  )
}

const STYLES = `
.bp-shell {
  font-family: var(--font-text);
  color: var(--color-text-primary);
  padding: 20px 24px 28px;
  max-width: 1100px;
  margin: 0 auto;
}

.bp-banner {
  background: rgba(240,167,66,0.08);
  border-left: 3px solid #F0A742;
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 20px;
}
.bp-banner-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #C77A0F;
  margin-bottom: 4px;
}
.bp-banner-body {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.bp-section {
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
  background: var(--color-bg-elevated);
}

.bp-section-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--color-bg-subtle);
  border: none;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  transition: background .12s ease;
}
.bp-section-header:hover {
  background: rgba(240,167,66,0.06);
}

.bp-chevron {
  font-size: 11px;
  color: var(--color-text-tertiary);
  width: 12px;
  flex-shrink: 0;
}

.bp-section-label { flex: 1; }

.bp-empty-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  background: var(--color-hairline);
  padding: 2px 6px;
  border-radius: 3px;
}

.bp-section-body {
  padding: 14px 16px;
  border-top: 1px solid var(--color-hairline);
}

.bp-json {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.55;
  color: var(--color-text-primary);
  background: #FAF9F5;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--color-hairline);
  max-height: 400px;
  overflow-y: auto;
  margin: 0;
}

.bp-empty {
  font-size: 12px;
  color: var(--color-text-tertiary);
  font-style: italic;
  padding: 8px 0;
}

.bp-raw {
  margin-top: 16px;
  padding: 10px 14px;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
}
.bp-raw summary {
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.04em;
}
.bp-raw[open] summary {
  margin-bottom: 8px;
}
.bp-raw .bp-json {
  max-height: 600px;
}
`
