import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { renderPrompt } from '@/lib/prompt'
import { TabPage } from '../TabPage'
import { Card } from '../Card'
import { Button } from '../Button'
import { DoppelgangerScanner } from '../DoppelgangerScanner'

interface EnrichedRecord {
  id: string
  awardee: string | null
  agency: string | null
  obligated: number | null
  enrichment_result: any
  naics_code: string | null
  uei: string | null
}

interface GateOutputRow {
  id: string
  session_id: string
  iteration: number
  tribal_map: any
  search_strings: any
  doppelganger_ueis: any
  hidden_codes: any
  created_at: string
}

export function IntelligenceTab() {
  const tenant = useStore((s) => s.activeTenant)
  const [records, setRecords] = useState<EnrichedRecord[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [gateOutput, setGateOutput] = useState<GateOutputRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [synthesizing, setSynthesizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tenantProfileText, setTenantProfileText] = useState<string>('')

  const loadData = async () => {
    if (!tenant) return
    setLoading(true)

    // Load the tenant's commercial profile for the doppelganger scanner
    const { data: profileData } = await supabase
      .from('commercial_profile')
      .select('synthesized_text')
      .eq('tenant_id', tenant.id)
      .maybeSingle()
    setTenantProfileText(profileData?.synthesized_text || '')

    const { data: sData } = await supabase
      .from('enrichment_sessions')
      .select('*')
      .eq('tenant_id', tenant.id)
      .is('deleted_at', null)
      .order('iteration', { ascending: false })
    setSessions(sData || [])

    const latest = (sData || [])[0]
    if (!latest) {
      setLoading(false)
      return
    }

    const { data: rData } = await supabase
      .from('enrichment_records')
      .select('id, awardee, agency, obligated, enrichment_result, naics_code, uei')
      .eq('session_id', latest.session_id)
      .eq('enrichment_status', 'complete')
      .is('deleted_at', null)
      .order('obligated', { ascending: false })
    setRecords((rData as EnrichedRecord[]) || [])

    const { data: gData } = await supabase
      .from('gate_outputs')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('iteration', latest.iteration)
      .maybeSingle()
    setGateOutput(gData as GateOutputRow)

    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [tenant?.id])

  const synthesize = async () => {
    if (!tenant || sessions.length === 0) return
    setError(null)
    setSynthesizing(true)

    try {
      const latest = sessions[0]

      const { data: profile } = await supabase
        .from('onboarding_sessions')
        .select('*')
        .eq('tenant_id', tenant.id)
        .maybeSingle()

      const { data: variant } = await supabase
        .from('prompt_variants')
        .select('*')
        .eq('id', tenant.prompt_variant_gate)
        .single()

      if (!variant) throw new Error('Gate variant not found')

      const completedEnrichments = records
        .map((r) => r.enrichment_result?.text || '')
        .filter(Boolean)
        .slice(0, 50)
        .join('\n\n---\n\n')

      const context = {
        client_name: profile?.company_name || tenant.name,
        client_description: profile?.core_description || '',
        client_naics: (profile?.naics_codes || []).join(', '),
        client_certifications: (profile?.certifications || []).join(', '),
        client_website: profile?.website || '',
        turn: latest.iteration,
        next_turn: latest.iteration + 1,
        gate_context: completedEnrichments,
        enrichments: completedEnrichments,
      }

      const rendered = renderPrompt(variant.prompt_template, context)

      const response = await fetch('/.netlify/functions/claude-enrich', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: rendered, max_tokens: 4096 }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Gate synthesis failed')

      // Store raw text as tribal_map for now; structured parsing added later
      const payload = {
        session_id: latest.session_id,
        tenant_id: tenant.id,
        iteration: latest.iteration,
        tribal_map: { raw_synthesis: data.text },
        search_strings: null,
        doppelganger_ueis: null,
        hidden_codes: null,
        variant_id_used: variant.id,
      }

      await supabase.from('gate_outputs').upsert(payload, {
        onConflict: 'tenant_id,iteration',
      })

      await loadData()
      setSynthesizing(false)
    } catch (err: any) {
      setError(err?.message || 'Synthesis failed')
      setSynthesizing(false)
    }
  }

  if (!tenant) return null

  return (
    <TabPage
      eyebrow="Gate output"
      title="Intelligence"
      description="Compounding signals surfaced from enrichment. Feeds the next turn's search package."
      actions={
        records.length > 0 && (
          <Button onClick={synthesize} disabled={synthesizing}>
            {synthesizing ? 'Synthesizing…' : gateOutput ? 'Re-synthesize' : 'Run gate synthesis'}
          </Button>
        )
      }
    >
      {/* Vendor Doppelganger Tier 2 scanner — baseline dataset generation.
          Appears first because this is the active workstream for tenants where
          the NAICS Path produced a wrong-room diagnosis. For tenants with good
          NAICS Path fit, the scanner shows 0 pending and becomes informational. */}
      {tenant && (
        <DoppelgangerScanner
          tenantId={tenant.id}
          tenantName={tenant.name}
          tenantProfileText={tenantProfileText}
        />
      )}

      {error && (
        <div
          style={{
            background: 'rgba(255, 59, 48, 0.1)',
            color: 'var(--color-danger)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-input)',
            fontSize: '13px',
            marginBottom: '24px',
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>Loading…</p>
      ) : records.length === 0 ? (
        <Card padding="large">
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '15px', textAlign: 'center', padding: '32px 0' }}>
            No completed enrichments yet. Run enrichment first.
          </p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '24px' }}>
          {gateOutput && (
            <Card padding="large">
              <h3
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '20px',
                  fontWeight: 600,
                  letterSpacing: '-0.008em',
                  marginBottom: '4px',
                }}
              >
                Gate synthesis
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', marginBottom: '16px' }}>
                Generated {new Date(gateOutput.created_at).toLocaleString()}
              </p>
              <pre
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.6,
                  margin: 0,
                  color: 'var(--color-text-primary)',
                }}
              >
                {gateOutput.tribal_map?.raw_synthesis || JSON.stringify(gateOutput, null, 2)}
              </pre>
            </Card>
          )}

          <Card padding="large">
            <h3
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '20px',
                fontWeight: 600,
                letterSpacing: '-0.008em',
                marginBottom: '16px',
              }}
            >
              Enriched records ({records.length})
            </h3>
            <div style={{ maxHeight: '600px', overflow: 'auto' }}>
              {records.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: '16px 0',
                    borderBottom: '0.5px solid var(--color-hairline)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 500 }}>{r.awardee || '—'}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                        {r.agency}
                        {r.naics_code && ` · NAICS ${r.naics_code}`}
                      </div>
                    </div>
                    <div style={{ fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                      {r.obligated ? `$${r.obligated.toLocaleString()}` : ''}
                    </div>
                  </div>
                  {r.enrichment_result?.text && (
                    <details>
                      <summary
                        style={{
                          fontSize: '12px',
                          color: 'var(--color-accent)',
                          cursor: 'pointer',
                          marginTop: '4px',
                        }}
                      >
                        Show enrichment
                      </summary>
                      <pre
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12px',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          lineHeight: 1.5,
                          margin: '12px 0 0 0',
                          padding: '12px',
                          background: 'var(--color-bg-subtle)',
                          borderRadius: 'var(--radius-input)',
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        {r.enrichment_result.text}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </TabPage>
  )
}
