import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { PromptVariant } from '@/lib/types'

export function AdminVariants() {
  const [variants, setVariants] = useState<PromptVariant[]>([])
  const [selected, setSelected] = useState<PromptVariant | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('prompt_variants')
      .select('*')
      .eq('is_active', true)
      .order('industry_tag')
      .order('use_case')
      .then(({ data }) => {
        setVariants((data as PromptVariant[]) || [])
        setLoading(false)
      })
  }, [])

  // Group by industry
  const grouped = variants.reduce((acc, v) => {
    if (!acc[v.industry_tag]) acc[v.industry_tag] = []
    acc[v.industry_tag].push(v)
    return acc
  }, {} as Record<string, PromptVariant[]>)

  const industryLabels: Record<string, string> = {
    defense: 'Defense Manufacturing',
    it_services: 'IT Services',
    healthcare: 'Healthcare Services',
    pro_services: 'Professional Services',
    other: 'Other',
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '20px',
            fontWeight: 600,
            letterSpacing: '-0.008em',
            margin: 0,
          }}
        >
          Prompt variants
        </h3>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: '4px 0 0 0' }}>
          Platform-owned prompt library. Click a variant to inspect its template.
        </p>
      </div>

      {loading && <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>Loading…</p>}

      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '24px' }}>
          {/* Variant list */}
          <div>
            {Object.entries(grouped).map(([industry, vs]) => (
              <div key={industry} style={{ marginBottom: '20px' }}>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    letterSpacing: '0.015em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-tertiary)',
                    marginBottom: '8px',
                  }}
                >
                  {industryLabels[industry] || industry}
                </div>
                {vs.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelected(v)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      background: selected?.id === v.id ? 'var(--color-bg-subtle)' : 'transparent',
                      border: 'none',
                      borderRadius: 'var(--radius-input)',
                      padding: '10px 12px',
                      marginBottom: '4px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>{v.use_case}</div>
                    <div
                      style={{
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--color-text-tertiary)',
                        marginTop: '2px',
                      }}
                    >
                      {v.id}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Preview */}
          <div
            style={{
              background: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-card)',
              padding: '20px',
              minHeight: '300px',
            }}
          >
            {selected ? (
              <>
                <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '4px' }}>{selected.name}</div>
                <div
                  style={{
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--color-text-tertiary)',
                    marginBottom: '16px',
                  }}
                >
                  {selected.id} · v{selected.version}
                </div>
                <pre
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: 'var(--color-text-primary)',
                    margin: 0,
                    lineHeight: 1.6,
                  }}
                >
                  {selected.prompt_template}
                </pre>
              </>
            ) : (
              <div style={{ color: 'var(--color-text-tertiary)', fontSize: '14px', textAlign: 'center', paddingTop: '100px' }}>
                Select a variant to preview
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
