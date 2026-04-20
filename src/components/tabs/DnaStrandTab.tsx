import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { TabPage } from '../TabPage'
import { Card } from '../Card'

interface RecordRow {
  agency: string | null
  department: string | null
  office: string | null
  awardee: string | null
  uei: string | null
  naics_code: string | null
  psc_code: string | null
  obligated: number | null
  iteration: number
}

export function DnaStrandTab() {
  const tenant = useStore((s) => s.activeTenant)
  const [records, setRecords] = useState<RecordRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant) return
    supabase
      .from('enrichment_records')
      .select('agency, department, office, awardee, uei, naics_code, psc_code, obligated, iteration')
      .eq('tenant_id', tenant.id)
      .eq('enrichment_status', 'complete')
      .is('deleted_at', null)
      .then(({ data }) => {
        setRecords((data as RecordRow[]) || [])
        setLoading(false)
      })
  }, [tenant?.id])

  if (!tenant) return null

  // Aggregate
  const agencyAgg: Map<string, { spend: number; count: number; turns: Set<number> }> = new Map()
  const vendorAgg: Map<string, { spend: number; count: number; agencies: Set<string> }> = new Map()
  const naicsAgg: Map<string, { spend: number; count: number }> = new Map()

  for (const r of records) {
    if (r.agency) {
      const e = agencyAgg.get(r.agency) || { spend: 0, count: 0, turns: new Set() }
      e.spend += r.obligated || 0
      e.count += 1
      e.turns.add(r.iteration)
      agencyAgg.set(r.agency, e)
    }
    if (r.awardee) {
      const key = r.uei ? `${r.awardee}|${r.uei}` : r.awardee
      const e = vendorAgg.get(key) || { spend: 0, count: 0, agencies: new Set() }
      e.spend += r.obligated || 0
      e.count += 1
      if (r.agency) e.agencies.add(r.agency)
      vendorAgg.set(key, e)
    }
    if (r.naics_code) {
      const e = naicsAgg.get(r.naics_code) || { spend: 0, count: 0 }
      e.spend += r.obligated || 0
      e.count += 1
      naicsAgg.set(r.naics_code, e)
    }
  }

  const topAgencies = Array.from(agencyAgg.entries())
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, 10)

  const topVendors = Array.from(vendorAgg.entries())
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, 15)

  const topNaics = Array.from(naicsAgg.entries())
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, 10)

  const totalSpend = records.reduce((s, r) => s + (r.obligated || 0), 0)

  return (
    <TabPage
      eyebrow="Compounding signals"
      title="DNA Strand"
      description="Aggregated relationships across agencies, vendors, and codes — stacked across all completed turns."
    >
      {loading ? (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>Loading…</p>
      ) : records.length === 0 ? (
        <Card padding="large">
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '15px', textAlign: 'center', padding: '32px 0' }}>
            No enriched records yet. Run enrichment first.
          </p>
        </Card>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
              marginBottom: '32px',
            }}
          >
            <Metric label="Total spend tracked" value={`$${Math.round(totalSpend / 1_000_000).toLocaleString()}M`} mono />
            <Metric label="Agencies" value={agencyAgg.size.toString()} />
            <Metric label="Vendors" value={vendorAgg.size.toString()} />
            <Metric label="NAICS codes" value={naicsAgg.size.toString()} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
            <Card padding="large">
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, letterSpacing: '-0.008em', marginBottom: '16px' }}>
                Top agencies
              </h3>
              {topAgencies.map(([name, a]) => (
                <div
                  key={name}
                  style={{
                    padding: '10px 0',
                    borderBottom: '0.5px solid var(--color-hairline)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
                      {a.count} awards · turns {Array.from(a.turns).sort().join(',')}
                    </div>
                  </div>
                  <div style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', marginLeft: '12px' }}>
                    ${Math.round(a.spend / 1000).toLocaleString()}K
                  </div>
                </div>
              ))}
            </Card>

            <Card padding="large">
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, letterSpacing: '-0.008em', marginBottom: '16px' }}>
                Top vendors
              </h3>
              {topVendors.map(([key, v]) => {
                const [name, uei] = key.split('|')
                return (
                  <div
                    key={key}
                    style={{
                      padding: '10px 0',
                      borderBottom: '0.5px solid var(--color-hairline)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '2px', fontFamily: uei ? 'var(--font-mono)' : 'inherit' }}>
                        {uei ? uei : `${v.count} awards`}
                      </div>
                    </div>
                    <div style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', marginLeft: '12px' }}>
                      ${Math.round(v.spend / 1000).toLocaleString()}K
                    </div>
                  </div>
                )
              })}
            </Card>

            <Card padding="large">
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, letterSpacing: '-0.008em', marginBottom: '16px' }}>
                Top NAICS codes
              </h3>
              {topNaics.map(([code, n]) => (
                <div
                  key={code}
                  style={{
                    padding: '10px 0',
                    borderBottom: '0.5px solid var(--color-hairline)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{code}</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
                      {n.count} awards
                    </div>
                  </div>
                  <div style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', marginLeft: '12px' }}>
                    ${Math.round(n.spend / 1000).toLocaleString()}K
                  </div>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}
    </TabPage>
  )
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Card>
      <div
        style={{
          color: 'var(--color-text-tertiary)',
          fontSize: '13px',
          fontWeight: 500,
          letterSpacing: '0.015em',
          textTransform: 'uppercase',
          marginBottom: '12px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: 'var(--color-text-primary)',
          fontSize: '28px',
          fontWeight: 600,
          letterSpacing: '-0.015em',
          lineHeight: 1.1,
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-display)',
        }}
      >
        {value}
      </div>
    </Card>
  )
}
