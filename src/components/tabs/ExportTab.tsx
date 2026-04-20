import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { TabPage } from '../TabPage'
import { Card } from '../Card'
import { Button } from '../Button'

interface ExportRecord {
  agency: string | null
  awardee: string | null
  obligated: number | null
  naics_code: string | null
  enrichment_result: any
  iteration: number
}

export function ExportTab() {
  const tenant = useStore((s) => s.activeTenant)
  const [records, setRecords] = useState<ExportRecord[]>([])
  const [profile, setProfile] = useState<any>(null)
  const [gates, setGates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant) return
    Promise.all([
      supabase
        .from('enrichment_records')
        .select('agency, awardee, obligated, naics_code, enrichment_result, iteration')
        .eq('tenant_id', tenant.id)
        .eq('enrichment_status', 'complete')
        .is('deleted_at', null),
      supabase
        .from('onboarding_sessions')
        .select('*')
        .eq('tenant_id', tenant.id)
        .maybeSingle(),
      supabase
        .from('gate_outputs')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('iteration'),
    ]).then(([rResult, pResult, gResult]) => {
      setRecords((rResult.data as ExportRecord[]) || [])
      setProfile(pResult.data)
      setGates(gResult.data || [])
      setLoading(false)
    })
  }, [tenant?.id])

  const generateReport = () => {
    if (!tenant) return

    const agencyAgg: Map<string, { spend: number; count: number }> = new Map()
    for (const r of records) {
      if (!r.agency) continue
      const e = agencyAgg.get(r.agency) || { spend: 0, count: 0 }
      e.spend += r.obligated || 0
      e.count += 1
      agencyAgg.set(r.agency, e)
    }

    const topAgencies = Array.from(agencyAgg.entries())
      .sort((a, b) => b[1].spend - a[1].spend)
      .slice(0, 5)

    const totalSpend = records.reduce((s, r) => s + (r.obligated || 0), 0)
    const date = new Date().toISOString().split('T')[0]

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${tenant.name} — Federal Market Intelligence Report</title>
<style>
:root {
  --accent: ${tenant.client_color};
}
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  color: #1D1D1F;
  background: #FBFBFD;
  margin: 0;
  padding: 64px 48px;
  line-height: 1.47;
  -webkit-font-smoothing: antialiased;
}
.cover { text-align: center; padding: 120px 0 80px; border-bottom: 1px solid rgba(0,0,0,0.08); }
.eyebrow { font-size: 13px; text-transform: uppercase; letter-spacing: 0.015em; color: #86868B; font-weight: 500; margin-bottom: 16px; }
h1 { font-size: 48px; font-weight: 600; letter-spacing: -0.022em; margin: 0 0 16px; }
h2 { font-size: 32px; font-weight: 600; letter-spacing: -0.015em; margin: 64px 0 8px; }
h3 { font-size: 20px; font-weight: 600; letter-spacing: -0.008em; margin: 32px 0 8px; }
p { font-size: 17px; color: #6E6E73; margin: 0 0 16px; }
.tagline { font-size: 17px; color: #6E6E73; margin: 0 0 8px; }
.accent { color: var(--accent); font-weight: 600; }
.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 32px 0; }
.metric { padding: 24px; background: #fff; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
.metric .label { font-size: 13px; color: #86868B; text-transform: uppercase; letter-spacing: 0.015em; font-weight: 500; margin-bottom: 12px; }
.metric .value { font-size: 28px; font-weight: 600; letter-spacing: -0.015em; font-family: 'SF Mono', monospace; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; }
th, td { padding: 12px 8px; text-align: left; border-bottom: 0.5px solid rgba(0,0,0,0.08); font-size: 14px; }
th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.015em; font-weight: 500; color: #86868B; }
td.mono { font-family: 'SF Mono', monospace; font-size: 13px; }
td.right { text-align: right; }
.gate { background: #F5F5F7; border-radius: 12px; padding: 24px; margin: 16px 0; font-family: 'SF Mono', monospace; font-size: 12px; white-space: pre-wrap; line-height: 1.6; }
.footer { margin-top: 96px; padding-top: 32px; border-top: 0.5px solid rgba(0,0,0,0.08); font-size: 13px; color: #86868B; }
@media print { body { padding: 32px; } }
</style>
</head>
<body>

<div class="cover">
  <div class="eyebrow">Federal Market Intelligence Report</div>
  <h1>${escapeHtml(tenant.name)}</h1>
  <p class="tagline">${escapeHtml(tenant.report_tagline || 'Federal contracting intelligence')}</p>
  <p>Prepared by <span class="accent">Sunstone Advisory Group</span>${tenant.cobrand_name ? ` with ${escapeHtml(tenant.cobrand_name)}` : ''}</p>
  <p style="margin-top: 48px; font-size: 13px; color: #86868B;">Generated ${date}</p>
</div>

<h2>Executive Summary</h2>
<p>
  ${escapeHtml(profile?.core_description || `${tenant.name} engaged Sunstone to map the federal market for its capabilities.`)}
  This report reflects enrichment across ${gates.length || records.reduce((m, r) => Math.max(m, r.iteration), 0)} of ${tenant.turn_count} planned turns.
</p>

<div class="metrics">
  <div class="metric">
    <div class="label">Records enriched</div>
    <div class="value">${records.length.toLocaleString()}</div>
  </div>
  <div class="metric">
    <div class="label">Total spend tracked</div>
    <div class="value">$${Math.round(totalSpend / 1_000_000).toLocaleString()}M</div>
  </div>
  <div class="metric">
    <div class="label">Target agencies</div>
    <div class="value">${agencyAgg.size}</div>
  </div>
  <div class="metric">
    <div class="label">Turn count</div>
    <div class="value">${tenant.turn_count}</div>
  </div>
</div>

<h2>Top Target Agencies</h2>
<p>Ranked by total obligated spend across all enriched awards.</p>
<table>
  <thead>
    <tr>
      <th>Agency</th>
      <th style="text-align: right;">Awards</th>
      <th style="text-align: right;">Spend</th>
    </tr>
  </thead>
  <tbody>
${topAgencies
  .map(
    ([name, a]) => `    <tr>
      <td>${escapeHtml(name)}</td>
      <td class="right mono">${a.count.toLocaleString()}</td>
      <td class="right mono">$${Math.round(a.spend / 1000).toLocaleString()}K</td>
    </tr>`
  )
  .join('\n')}
  </tbody>
</table>

${gates
  .map(
    (g) => `<h2>Turn ${g.iteration} Gate Synthesis</h2>
<div class="gate">${escapeHtml(g.tribal_map?.raw_synthesis || JSON.stringify(g, null, 2))}</div>`
  )
  .join('\n')}

<div class="footer">
  Generated by the Sunstone Federal Intelligence Platform.<br>
  Tenant: ${escapeHtml(tenant.name)} · Template: ${tenant.template_id || 'custom'} · ${date}
</div>

</body>
</html>`

    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${tenant.id}-federal-market-intelligence-${date}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (!tenant) return null

  return (
    <TabPage
      eyebrow="Deliverable"
      title="Export"
      description={`Branded intelligence report drawing from all completed turns. Download as HTML — open and print to PDF.`}
      actions={
        <Button onClick={generateReport} disabled={loading || records.length === 0}>
          Generate report
        </Button>
      }
    >
      {loading ? (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>Loading…</p>
      ) : records.length === 0 ? (
        <Card padding="large">
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '15px', textAlign: 'center', padding: '32px 0' }}>
            Nothing to export yet. Complete at least one enrichment turn first.
          </p>
        </Card>
      ) : (
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
            Report preview
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            <Line label="Cover" value={`${tenant.name}${tenant.cobrand_name ? ` with ${tenant.cobrand_name}` : ''}`} />
            <Line label="Records included" value={records.length.toLocaleString()} />
            <Line label="Gates synthesized" value={gates.length.toString()} />
            <Line label="Profile populated" value={profile?.core_description ? 'Yes' : 'No — Onboard tab recommended first'} />
          </div>
        </Card>
      )}
    </TabPage>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '0.5px solid var(--color-hairline)' }}>
      <span>{label}</span>
      <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
