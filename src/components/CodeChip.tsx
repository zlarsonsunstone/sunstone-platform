/**
 * CodeChip - NAICS or PSC chip with hover-preview tooltip and click-to-pin modal.
 *
 * Reads from v2.code_descriptions cache. On a miss, calls Claude to generate an
 * enriched description, caches it, and shows it. Subsequent hovers/clicks on the
 * same code hit the cache instantly.
 *
 * Visual: same color-coded chip as before (green/yellow/black per conformance).
 * Hover: 300ms delay, then tooltip showing title + short description.
 * Click: opens centered modal with full enriched copy. Click backdrop to dismiss.
 */

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { callClaudeBrowser, extractJsonBlock } from '@/lib/claude'

// =============================================================================
// TYPES
// =============================================================================

interface CodeDescription {
  code: string
  code_type: 'naics' | 'psc'
  title: string
  short: string
  enriched: string
  pairs_with: string | null
}

interface CodeChipProps {
  code: string
  codeType: 'naics' | 'psc'
  highlight: 'green' | 'black' | 'yellow'
  count?: number
  share?: number
  compact?: boolean
}

// =============================================================================
// SIMPLE IN-MEMORY CACHE (avoids re-querying within a single session)
// =============================================================================

const memoryCache: Record<string, CodeDescription | null> = {}
const inFlight: Record<string, Promise<CodeDescription | null>> = {}

// Lightweight title-only fetch - no Claude call, just reads what's in the
// Supabase seed. Used for the inline "code - title" display on mount.
const titleCache: Record<string, { title: string | null }> = {}

async function fetchTitleOnly(code: string, codeType: 'naics' | 'psc'): Promise<string | null> {
  const cacheKey = `${codeType}:${code}`
  if (cacheKey in titleCache) return titleCache[cacheKey].title
  const { data } = await supabase
    .from('code_descriptions')
    .select('title')
    .eq('code', code)
    .maybeSingle()
  const title = (data?.title) || null
  titleCache[cacheKey] = { title }
  return title
}

async function fetchDescription(code: string, codeType: 'naics' | 'psc'): Promise<CodeDescription | null> {
  const cacheKey = `${codeType}:${code}`
  if (cacheKey in memoryCache) return memoryCache[cacheKey]
  if (cacheKey in inFlight) return inFlight[cacheKey]

  inFlight[cacheKey] = (async () => {
    // 1) Try the Supabase cache
    const { data, error } = await supabase
      .from('code_descriptions')
      .select('*')
      .eq('code', code)
      .maybeSingle()

    // If row exists AND has enriched content, use it.
    if (!error && data && data.enriched && data.enriched.trim() !== '') {
      memoryCache[cacheKey] = data as CodeDescription
      return memoryCache[cacheKey]
    }

    // Row may exist with title-only (from bulk seed). Preserve the title for
    // immediate display, but proceed to generate the strategic short+enriched.
    const existingTitle = (data && data.title) ? data.title : null

    // 2) Generate enriched description via Claude
    try {
      const titleHint = existingTitle ? `The official title for this code is: "${existingTitle}". Use it as the title field.` : ''
      const userPrompt = `You are an expert in federal procurement. Write a strategic, market-focused description of ${codeType.toUpperCase()} code ${code}.

${titleHint}

DO NOT use the standard Census/regulatory definition. Write for a small-business federal contractor evaluating whether this code matters to their market.

Return STRICT JSON only (no preamble, no markdown):
{
  "title": "${existingTitle ? existingTitle.replace(/"/g, '\\"') : 'Short title (3-6 words)'}",
  "short": "One-line tooltip description (15-25 words).",
  "enriched": "Two paragraphs of strategic market context. Plain text only. No headings. Explain what kind of work this code covers in practice, who buys it, and how it pairs with other codes.",
  "pairs_with": "Comma-separated list of common pairing codes (or null)."
}`

      const result = await callClaudeBrowser(userPrompt, { maxTokens: 1500 })
      const parsed = extractJsonBlock(result.text)
      if (!parsed) throw new Error('Bad JSON response')

      const newRow: CodeDescription = {
        code,
        code_type: codeType,
        // Always prefer the official title if we have one
        title: existingTitle || parsed.title || code,
        short: parsed.short || '',
        enriched: parsed.enriched || '',
        pairs_with: parsed.pairs_with || null,
      }

      // Persist to Supabase cache (best-effort; ignore errors)
      await supabase.from('code_descriptions').upsert({
        ...newRow,
        source: existingTitle ? 'official_table+claude' : 'claude_generated',
      })

      memoryCache[cacheKey] = newRow
      return newRow
    } catch (e: any) {
      console.error('[CodeChip] Failed to generate description for', code, e)
      // Even on failure, if we have an official title, return a title-only row
      if (existingTitle) {
        const titleOnly: CodeDescription = {
          code, code_type: codeType, title: existingTitle,
          short: '', enriched: '', pairs_with: null,
        }
        memoryCache[cacheKey] = titleOnly
        return titleOnly
      }
      memoryCache[cacheKey] = null
      return null
    }
  })()

  const result = await inFlight[cacheKey]
  delete inFlight[cacheKey]
  return result
}

// =============================================================================
// CHIP STYLE
// =============================================================================

function chipStyle(highlight: 'green' | 'black' | 'yellow'): React.CSSProperties {
  if (highlight === 'green') return { background: '#E6F4EA', color: '#1B5E20', border: '1px solid #B4DBBE' }
  if (highlight === 'yellow') return { background: '#FFF8E1', color: '#856404', border: '1px solid #F0D17C' }
  return { background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-hairline)' }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function CodeChip({ code, codeType, highlight, count, share, compact }: CodeChipProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [description, setDescription] = useState<CodeDescription | null | undefined>(undefined)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Lazy-load full description on first hover OR click
  const ensureLoaded = async () => {
    if (description !== undefined && description !== null && description.enriched) return
    const d = await fetchDescription(code, codeType)
    setDescription(d)
  }

  // Eagerly load JUST THE TITLE on mount so the chip can show "code - title"
  // inline. No Claude call - this only hits the bulk-seeded Supabase table.
  // The hover/click handlers will trigger the heavier description fetch.
  useEffect(() => {
    let cancelled = false
    fetchTitleOnly(code, codeType).then((title) => {
      if (cancelled) return
      if (title) {
        // Stub description: just the title is enough to render the inline label.
        setDescription({
          code, code_type: codeType, title,
          short: '', enriched: '', pairs_with: null,
        })
      } else {
        setDescription(null)
      }
    })
    return () => { cancelled = true }
  }, [code, codeType])

  const handleMouseEnter = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => {
      setShowTooltip(true)
      ensureLoaded()
    }, 300)
  }

  const handleMouseLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setShowTooltip(false)
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowModal(true)
    setShowTooltip(false)
    ensureLoaded()
  }

  return (
    <>
      <span
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{
          ...chipStyle(highlight),
          fontSize: compact ? '9px' : '10px',
          padding: compact ? '2px 5px' : '2px 7px',
          borderRadius: '3px',
          fontFamily: 'var(--font-mono, monospace)',
          fontWeight: 600,
          cursor: 'pointer',
          position: 'relative',
          display: 'inline-block',
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{code}</span>
        {description && description.title && (
          <span style={{ fontFamily: 'var(--font-text, system-ui)', fontWeight: 500, marginLeft: '6px', opacity: 0.85 }}>
            — {description.title}
          </span>
        )}

        {/* TOOLTIP */}
        {showTooltip && !showModal && (
          <span
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 6px)',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(31, 29, 26, 0.96)',
              color: '#FFFFFF',
              padding: '8px 10px',
              borderRadius: '4px',
              fontSize: '11px',
              lineHeight: 1.4,
              minWidth: '220px',
              maxWidth: '300px',
              whiteSpace: 'normal',
              fontFamily: 'var(--font-text, system-ui)',
              fontWeight: 400,
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              zIndex: 100,
              pointerEvents: 'none',
            }}
          >
            {description === undefined ? (
              <em style={{ color: '#B5AEA1' }}>Loading...</em>
            ) : description === null ? (
              <span style={{ color: '#E07A14' }}>No description available</span>
            ) : (
              <>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                  {codeType.toUpperCase()} {code} · {description.title}
                </div>
                <div style={{ color: '#D5CFC2' }}>
                  {description.short && description.short.trim() !== ''
                    ? description.short
                    : <em style={{ color: '#B5AEA1' }}>Generating market description...</em>}
                </div>
                <div style={{ marginTop: '5px', fontSize: '9px', color: '#8B857C', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Click for full description
                </div>
              </>
            )}
          </span>
        )}
      </span>

      {/* MODAL */}
      {showModal && (
        <CodeModal
          code={code}
          codeType={codeType}
          description={description}
          count={count}
          share={share}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}

// =============================================================================
// MODAL
// =============================================================================

function CodeModal({ code, codeType, description, count, share, onClose }: {
  code: string
  codeType: 'naics' | 'psc'
  description: CodeDescription | null | undefined
  count?: number
  share?: number
  onClose: () => void
}) {
  useEffect(() => {
    // Close on Escape
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-bg-elevated)',
          borderRadius: 'var(--radius-card, 8px)',
          padding: '32px',
          maxWidth: '640px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: '14px', right: '14px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '22px',
            color: 'var(--color-text-tertiary)',
            width: '32px', height: '32px',
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
            fontFamily: 'inherit',
          }}
        >
          ×
        </button>

        <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px' }}>
          {codeType.toUpperCase()} Code
        </div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, marginBottom: '6px', letterSpacing: '-0.018em' }}>
          {code}
        </h2>

        {description === undefined ? (
          <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px', fontStyle: 'italic' }}>Loading description...</p>
        ) : description === null ? (
          <p style={{ color: '#B00020', fontSize: '14px' }}>No description available for this code.</p>
        ) : (
          <>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '14px' }}>
              {description.title}
            </h3>

            {(count || share) && (
              <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginBottom: '16px', padding: '8px 12px', background: 'var(--color-bg-primary)', borderRadius: '4px', display: 'inline-block' }}>
                Appears in <strong style={{ color: 'var(--color-text-primary)' }}>{count || 0}</strong> awards in this cluster
                {share !== undefined && <span> · <strong style={{ color: 'var(--color-text-primary)' }}>{Math.round(share * 100)}%</strong> conformance</span>}
              </div>
            )}

            <div style={{ fontSize: '14px', lineHeight: 1.65, color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap' }}>
              {description.enriched && description.enriched.trim() !== ''
                ? renderMarkdownLite(description.enriched)
                : <em style={{ color: 'var(--color-text-tertiary)' }}>Generating strategic description... this takes a few seconds the first time anyone opens this code.</em>}
            </div>

            {description.pairs_with && (
              <div style={{ marginTop: '20px', paddingTop: '14px', borderTop: '1px solid var(--color-hairline)' }}>
                <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>Pairs naturally with</div>
                <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{description.pairs_with}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Render very lightweight markdown (just **bold**) - the description uses paragraphs and bold only
function renderMarkdownLite(text: string): React.ReactNode {
  // Split on **bold** segments
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    return <span key={i}>{part}</span>
  })
}
