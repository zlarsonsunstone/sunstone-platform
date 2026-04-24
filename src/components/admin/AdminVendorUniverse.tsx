import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * AdminVendorUniverse
 *
 * SuperAdmin tab for managing the shared vendor_universe table — the pool of
 * SAM-registered vendors (with websites + primary NAICS) that the Vendor
 * Doppelganger research path analyzes against.
 *
 * The universe is shared across tenants because the underlying SAM data is
 * the same for everyone. Only the per-tenant capability scoring changes.
 *
 * Features:
 * - Current universe size + breakdown by sector
 * - CSV import (paste or upload) for bulk ingestion
 * - Import progress with batched inserts
 * - Tier 1 name-signal tagging on import
 */

// Default set of capability signal tokens — matches what the migration seeded.
// Kept here too so the import can tag vendors without a DB round-trip.
const DEFAULT_SIGNAL_TOKENS = [
  'compute', 'gpu', 'ai', 'ml', 'machine learning', 'artificial intelligence',
  'cloud', 'hosting', 'data center', 'hpc', 'high performance', 'supercomput',
  'inference', 'training', 'model', 'neural',
  'confidential comput', 'secure enclave', 'trusted execution', 'attestation',
  'encryption', 'cybersecurity', 'zero trust', 'cyber',
  'distributed', 'decentralized', 'blockchain',
  'marketplace', 'platform', 'infrastructure',
  'quant', 'analytics', 'data science', 'llm', 'intel tdx', 'tpm',
]

interface StatsRow {
  total: number
  with_signal: number
  by_sector: { sector: string; count: number }[]
}

export function AdminVendorUniverse() {
  const [stats, setStats] = useState<StatsRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number>(0)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setSuccess(null)
    setFileName(file.name)
    setFileSize(file.size)
    try {
      // Read the file as text. For 8.7MB CSV this is sub-second.
      const text = await file.text()
      setCsvText(text)
    } catch (err: any) {
      setError(`Failed to read file: ${err?.message || 'unknown error'}`)
      setFileName(null)
      setFileSize(0)
      setCsvText('')
    }
  }

  const loadStats = async () => {
    setLoading(true)
    try {
      const { count: totalCount } = await supabase
        .from('vendor_universe')
        .select('*', { count: 'exact', head: true })
      const { count: signalCount } = await supabase
        .from('vendor_universe')
        .select('*', { count: 'exact', head: true })
        .eq('has_capability_signal', true)

      // Sector breakdown — pull all rows' sector column paginated.
      // Supabase enforces a hard 1000-row cap on SELECTs regardless of
      // .range() request size, so we page through in 1000-row chunks and
      // loop until we get back fewer than 1000. Earlier code used PAGE=10000
      // which silently got capped to 1000 and then exited the loop because
      // data.length (1000) was < PAGE (10000), producing only the first
      // page's breakdown.
      const sectorMap = new Map<string, number>()
      const PAGE = 1000
      let offset = 0
      for (;;) {
        const { data } = await supabase
          .from('vendor_universe')
          .select('primary_naics_sector')
          .range(offset, offset + PAGE - 1)
        if (!data || data.length === 0) break
        for (const r of data) {
          const s = r.primary_naics_sector || 'unk'
          sectorMap.set(s, (sectorMap.get(s) || 0) + 1)
        }
        if (data.length < PAGE) break
        offset += PAGE
      }
      const by_sector = Array.from(sectorMap.entries())
        .map(([sector, count]) => ({ sector, count }))
        .sort((a, b) => b.count - a.count)

      setStats({
        total: totalCount || 0,
        with_signal: signalCount || 0,
        by_sector,
      })
    } catch (err: any) {
      setError(err?.message || 'Failed to load stats')
    }
    setLoading(false)
  }

  useEffect(() => {
    loadStats()
  }, [])

  const runImport = async () => {
    setImporting(true)
    setError(null)
    setSuccess(null)

    try {
      // Parse CSV — expect columns: uei, cage, legal_name, website, naics
      const lines = csvText.split('\n').map((l) => l.trim()).filter((l) => l)
      if (lines.length < 2) {
        throw new Error('CSV must have a header row + at least one data row')
      }
      const headerCells = lines[0].split(',').map((c) => c.trim().toLowerCase())
      const idxUei = headerCells.indexOf('uei')
      const idxCage = headerCells.indexOf('cage')
      const idxName = headerCells.indexOf('legal_name')
      const idxWebsite = headerCells.indexOf('website')
      const idxNaics = headerCells.indexOf('naics')
      if (idxUei === -1 || idxName === -1 || idxNaics === -1) {
        throw new Error('CSV must include uei, legal_name, naics columns')
      }

      // Parse data rows — basic CSV (assume no embedded commas in names; our
      // export script already stripped those)
      const rows: any[] = []
      for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i])
        if (cells.length < headerCells.length) continue
        const uei = (cells[idxUei] || '').trim()
        if (!uei || uei.length !== 12) continue
        const legalName = (cells[idxName] || '').trim()
        if (!legalName) continue
        const naics = (cells[idxNaics] || '').trim()
        const nameLower = legalName.toLowerCase()
        const matchedTokens: string[] = []
        for (const tok of DEFAULT_SIGNAL_TOKENS) {
          if (nameLower.includes(tok)) matchedTokens.push(tok)
        }
        rows.push({
          uei,
          cage: (cells[idxCage] || '').trim() || null,
          legal_business_name: legalName,
          website: idxWebsite >= 0 ? (cells[idxWebsite] || '').trim() || null : null,
          primary_naics: naics || null,
          primary_naics_sector: naics && naics.length >= 2 ? naics.substring(0, 2) : null,
          in_fence: true,
          has_capability_signal: matchedTokens.length > 0,
          signal_tokens: matchedTokens.length > 0 ? matchedTokens : null,
          source: 'sam_extract_monthly',
        })
      }

      if (rows.length === 0) {
        throw new Error('No valid data rows parsed')
      }

      // Deduplicate by UEI. Postgres rejects ON CONFLICT DO UPDATE that
      // touches the same row twice within a single statement, so if the
      // source CSV has duplicate UEIs (rare but possible — the SAM monthly
      // extract occasionally has same UEI appearing twice with slightly
      // different metadata), we must collapse them before upserting. Keep
      // last occurrence to favor the most recent metadata entry.
      const byUei = new Map<string, any>()
      for (const r of rows) {
        byUei.set(r.uei, r)
      }
      const dedupedRows = Array.from(byUei.values())
      const duplicateCount = rows.length - dedupedRows.length

      // Batch insert — 1000 rows per upsert to avoid timeout
      const BATCH_SIZE = 1000
      let inserted = 0
      setImportProgress({ done: 0, total: dedupedRows.length })

      for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
        const batch = dedupedRows.slice(i, i + BATCH_SIZE)
        const { error: insertError } = await supabase
          .from('vendor_universe')
          .upsert(batch, { onConflict: 'uei', ignoreDuplicates: false })
        if (insertError) {
          throw new Error(`Batch ${i / BATCH_SIZE + 1} failed: ${insertError.message}`)
        }
        inserted += batch.length
        setImportProgress({ done: inserted, total: dedupedRows.length })
      }

      const dupNote = duplicateCount > 0 ? ` (${duplicateCount.toLocaleString()} duplicate UEIs collapsed)` : ''
      setSuccess(`Imported ${inserted.toLocaleString()} vendors.${dupNote}`)
      setCsvText('')
      setFileName(null)
      setFileSize(0)
      await loadStats()
    } catch (err: any) {
      setError(err?.message || 'Import failed')
    }
    setImporting(false)
    setImportProgress(null)
  }

  return (
    <div style={{ fontSize: '14px', lineHeight: 1.5 }}>
      <h3 style={{ fontSize: '18px', marginTop: 0, fontWeight: 600 }}>Vendor Universe</h3>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
        Shared pool of SAM-registered vendors with websites and primary NAICS codes. Used by the
        Vendor Doppelganger research path. Not tenant-scoped — the same universe serves all
        tenants.
      </p>

      {/* Stats */}
      {loading ? (
        <div style={{ padding: '24px', fontSize: '13px', color: 'var(--color-text-tertiary)' }}>
          Loading stats…
        </div>
      ) : stats ? (
        <div
          style={{
            padding: '20px',
            background: 'var(--color-bg-subtle)',
            borderRadius: 'var(--radius-input)',
            marginBottom: '24px',
          }}
        >
          <div style={{ display: 'flex', gap: '32px', marginBottom: '16px' }}>
            <Stat label="Total vendors" value={stats.total.toLocaleString()} />
            <Stat
              label="With capability signal"
              value={`${stats.with_signal.toLocaleString()} (${
                stats.total > 0 ? ((stats.with_signal / stats.total) * 100).toFixed(1) : '0'
              }%)`}
            />
            <Stat label="Distinct sectors" value={stats.by_sector.length.toString()} />
          </div>

          {stats.by_sector.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--color-text-tertiary)',
                  marginBottom: '8px',
                }}
              >
                By NAICS sector (top 15)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '8px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {stats.by_sector.slice(0, 15).map((s) => (
                  <div
                    key={s.sector}
                    style={{
                      padding: '6px 10px',
                      background: 'var(--color-bg-primary)',
                      borderRadius: '4px',
                      border: '1px solid var(--color-hairline)',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{s.sector}</span>:{' '}
                    <span style={{ color: 'var(--color-text-secondary)' }}>
                      {s.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Import */}
      <div
        style={{
          padding: '20px',
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-hairline)',
          borderRadius: 'var(--radius-input)',
        }}
      >
        <h4 style={{ margin: '0 0 8px 0', fontSize: '15px', fontWeight: 600 }}>
          Import from CSV
        </h4>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px', margin: '0 0 16px 0' }}>
          Expected columns: <code>uei,cage,legal_name,website,naics</code>. Upsert on UEI — re-import
          updates existing rows. Tier 1 capability signal tags are applied automatically at
          import time.
        </p>

        {/* File upload (primary) */}
        <div style={{ marginBottom: '16px' }}>
          <label
            htmlFor="vendor-csv-upload"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px 20px',
              border: `2px dashed ${fileName ? 'var(--color-accent)' : 'var(--color-hairline)'}`,
              borderRadius: 'var(--radius-input)',
              background: fileName ? 'rgba(212,146,10,0.04)' : 'var(--color-bg-subtle)',
              cursor: importing ? 'not-allowed' : 'pointer',
              transition: 'var(--transition-default)',
              opacity: importing ? 0.5 : 1,
            }}
          >
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>
              {fileName ? '📄' : '⬆️'}
            </div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: 'var(--color-text-primary)',
                marginBottom: '4px',
              }}
            >
              {fileName || 'Click to choose CSV file (or drag and drop)'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              {fileName
                ? `${(fileSize / 1024 / 1024).toFixed(2)} MB — ${csvText.split('\n').length - 1} rows`
                : 'Typical Manifold-fence file: ~8.7 MB / 119K rows'}
            </div>
            <input
              id="vendor-csv-upload"
              type="file"
              accept=".csv,text/csv,text/plain"
              disabled={importing}
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {/* Or paste fallback */}
        <details style={{ marginBottom: '12px' }}>
          <summary
            style={{
              fontSize: '12px',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            Or paste CSV content directly (for small files)
          </summary>
          <textarea
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value)
              setFileName(null)
              setFileSize(0)
            }}
            placeholder="Paste CSV content here..."
            disabled={importing}
            style={{
              width: '100%',
              marginTop: '8px',
              minHeight: '180px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              padding: '12px',
              border: '1px solid var(--color-hairline)',
              borderRadius: 'var(--radius-input)',
              background: 'var(--color-bg-subtle)',
              color: 'var(--color-text-primary)',
              resize: 'vertical',
            }}
          />
        </details>

        {importProgress && (
          <div style={{ marginTop: '12px' }}>
            <div
              style={{
                height: '4px',
                background: 'var(--color-hairline)',
                borderRadius: '2px',
                overflow: 'hidden',
                marginBottom: '4px',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${(importProgress.done / importProgress.total) * 100}%`,
                  background: 'var(--color-accent)',
                  transition: 'width 0.3s',
                }}
              />
            </div>
            <div
              style={{
                fontSize: '11px',
                color: 'var(--color-text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              Imported {importProgress.done.toLocaleString()} of{' '}
              {importProgress.total.toLocaleString()}
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: '12px',
              padding: '10px 12px',
              background: 'rgba(255,59,48,0.08)',
              border: '1px solid rgba(255,59,48,0.2)',
              borderRadius: 'var(--radius-input)',
              color: 'var(--color-danger)',
              fontSize: '12px',
            }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            style={{
              marginTop: '12px',
              padding: '10px 12px',
              background: 'rgba(52,199,89,0.08)',
              border: '1px solid rgba(52,199,89,0.2)',
              borderRadius: 'var(--radius-input)',
              color: 'var(--color-success)',
              fontSize: '12px',
            }}
          >
            {success}
          </div>
        )}

        <div style={{ marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={runImport}
            disabled={importing || !csvText.trim()}
            style={{
              padding: '8px 20px',
              background:
                importing || !csvText.trim() ? 'var(--color-hairline)' : 'var(--color-accent)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-input)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: importing || !csvText.trim() ? 'not-allowed' : 'pointer',
              transition: 'var(--transition-default)',
            }}
          >
            {importing ? 'Importing…' : 'Import CSV'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: '10px',
          color: 'var(--color-text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
        {value}
      </div>
    </div>
  )
}

/**
 * Minimal CSV line parser — handles quoted fields for names containing commas.
 * Our export script already strips commas from names, so this is defensive.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  out.push(current)
  return out
}
