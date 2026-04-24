import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { runTier2Analysis } from '@/lib/vendorTier2'

/**
 * Minimal Tier 2 Scanner
 *
 * Scope: baseline dataset generation only. No analytical UI — this is about
 * getting the Haiku scan to run across the 6,876 signal-tagged Manifold
 * doppelganger candidates and populating vendor_capability_analysis with
 * tier=2 rows.
 *
 * After the scan completes, analytical surfaces (filters, drawers, tier
 * segmentation) get built in a subsequent iteration informed by what the
 * actual score distribution shows us.
 */

interface ScanStats {
  universeSize: number
  signalCount: number
  analyzedCount: number
  failedCount: number
  pendingCount: number
}

export function DoppelgangerScanner({
  tenantId,
  tenantName,
  tenantProfileText,
}: {
  tenantId: string
  tenantName: string
  tenantProfileText: string
}) {
  const [stats, setStats] = useState<ScanStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; label?: string } | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<{
    attempted: number
    succeeded: number
    failed: number
    elapsedMinutes: number
  } | null>(null)

  const loadStats = async () => {
    setLoading(true)
    try {
      const { count: universeSize } = await supabase
        .from('vendor_universe')
        .select('*', { count: 'exact', head: true })
      const { count: signalCount } = await supabase
        .from('vendor_universe')
        .select('*', { count: 'exact', head: true })
        .eq('has_capability_signal', true)
        .not('website', 'is', null)
      const { count: analyzedCount } = await supabase
        .from('vendor_capability_analysis')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('tier', 2)
      const { count: failedCount } = await supabase
        .from('vendor_capability_analysis')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('tier', 2)
        .not('fetch_error', 'is', null)

      const pending = Math.max(0, (signalCount || 0) - (analyzedCount || 0))

      setStats({
        universeSize: universeSize || 0,
        signalCount: signalCount || 0,
        analyzedCount: analyzedCount || 0,
        failedCount: failedCount || 0,
        pendingCount: pending,
      })
    } catch (err) {
      console.warn('[DoppelgangerScanner] loadStats failed', err)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  const launchScan = async () => {
    setScanning(true)
    setScanError(null)
    setScanResult(null)
    setProgress({ done: 0, total: 0, label: 'Preparing…' })

    try {
      const result = await runTier2Analysis({
        tenantId,
        tenantName,
        tenantProfileText,
        onProgress: (done, total, label) => setProgress({ done, total, label }),
      })

      setProgress(null)
      setScanResult({
        attempted: result.attempted,
        succeeded: result.succeeded,
        failed: result.failed,
        elapsedMinutes: +(result.elapsedMs / 60000).toFixed(1),
      })

      await loadStats()
    } catch (err: any) {
      setScanError(err?.message || 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  if (loading || !stats) {
    return (
      <div style={placeholderStyle}>Loading vendor scan state…</div>
    )
  }

  const hasWorkPending = stats.pendingCount > 0

  return (
    <div
      style={{
        padding: '20px 24px',
        background: 'var(--color-bg-elevated)',
        borderRadius: 'var(--radius-card)',
        marginBottom: '24px',
        border: '1px solid var(--color-hairline)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '4px',
            }}
          >
            Vendor Doppelganger — Tier 2 Scan
          </div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            Baseline dataset generation
          </h3>
        </div>
      </div>

      {/* Stats row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
          marginBottom: '20px',
          padding: '14px',
          background: 'var(--color-bg-subtle)',
          borderRadius: 'var(--radius-input)',
        }}
      >
        <Stat label="Vendor universe" value={stats.universeSize.toLocaleString()} hint="All imported SAM vendors" />
        <Stat
          label="Target pool (Tier 1)"
          value={stats.signalCount.toLocaleString()}
          hint="Signal-tagged + website present"
        />
        <Stat
          label="Analyzed (Tier 2)"
          value={stats.analyzedCount.toLocaleString()}
          hint={`${stats.failedCount} fetch errors`}
          accent={stats.analyzedCount > 0}
        />
        <Stat
          label="Pending"
          value={stats.pendingCount.toLocaleString()}
          hint={
            hasWorkPending
              ? `~$${(stats.pendingCount * 0.002).toFixed(2)}, ~${Math.round(stats.pendingCount / 600)} min`
              : 'Complete'
          }
          warn={hasWorkPending}
        />
      </div>

      {/* Progress bar while scanning */}
      {progress && (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px 14px',
            background: 'var(--color-bg-subtle)',
            borderRadius: 'var(--radius-input)',
          }}
        >
          <div style={{ fontSize: '13px', marginBottom: '8px', fontWeight: 500 }}>
            {progress.label || 'Scanning…'}
          </div>
          {progress.total > 0 && (
            <>
              <div
                style={{
                  height: '6px',
                  background: 'var(--color-hairline)',
                  borderRadius: '3px',
                  overflow: 'hidden',
                  marginBottom: '6px',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${(progress.done / progress.total) * 100}%`,
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
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  {progress.done.toLocaleString()} of {progress.total.toLocaleString()}
                </span>
                <span>{Math.round((progress.done / progress.total) * 100)}%</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Success result */}
      {scanResult && !scanning && (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px 14px',
            background: 'rgba(52, 199, 89, 0.08)',
            border: '1px solid rgba(52, 199, 89, 0.2)',
            borderRadius: 'var(--radius-input)',
            fontSize: '13px',
            color: 'var(--color-success)',
          }}
        >
          Scan complete. <strong>{scanResult.succeeded.toLocaleString()}</strong> vendors analyzed successfully,{' '}
          <strong>{scanResult.failed.toLocaleString()}</strong> had fetch/analysis errors. Elapsed:{' '}
          <strong>{scanResult.elapsedMinutes} min</strong>. Data is in{' '}
          <code style={{ fontSize: '11px' }}>vendor_capability_analysis</code>.
        </div>
      )}

      {/* Error */}
      {scanError && (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px 14px',
            background: 'rgba(255, 59, 48, 0.08)',
            border: '1px solid rgba(255, 59, 48, 0.2)',
            borderRadius: 'var(--radius-input)',
            fontSize: '13px',
            color: 'var(--color-danger)',
          }}
        >
          {scanError}
        </div>
      )}

      {/* Action button */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'flex-end' }}>
        {!scanning && stats.pendingCount > 0 && (
          <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginRight: 'auto' }}>
            Ready to analyze {stats.pendingCount.toLocaleString()} vendors against{' '}
            {tenantName}'s profile.
          </span>
        )}
        {!scanning && stats.pendingCount === 0 && stats.analyzedCount > 0 && (
          <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginRight: 'auto' }}>
            Baseline dataset complete. Inspect in Supabase or await analytical UI.
          </span>
        )}
        <button
          onClick={launchScan}
          disabled={scanning || stats.pendingCount === 0}
          style={{
            padding: '10px 24px',
            background: scanning || stats.pendingCount === 0 ? 'var(--color-hairline)' : 'var(--color-accent)',
            color: scanning || stats.pendingCount === 0 ? 'var(--color-text-tertiary)' : 'white',
            border: 'none',
            borderRadius: 'var(--radius-input)',
            fontSize: '13px',
            fontWeight: 500,
            cursor: scanning || stats.pendingCount === 0 ? 'not-allowed' : 'pointer',
            transition: 'var(--transition-default)',
          }}
        >
          {scanning
            ? 'Scanning…'
            : stats.pendingCount === 0
            ? 'All vendors analyzed'
            : `Launch Tier 2 scan (${stats.pendingCount.toLocaleString()})`}
        </button>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  accent,
  warn,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
  warn?: boolean
}) {
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
      <div
        style={{
          fontSize: '20px',
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          color: accent ? 'var(--color-success)' : warn ? 'var(--color-accent)' : 'var(--color-text-primary)',
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>{hint}</div>
      )}
    </div>
  )
}

const placeholderStyle: React.CSSProperties = {
  padding: '20px 24px',
  background: 'var(--color-bg-elevated)',
  borderRadius: 'var(--radius-card)',
  marginBottom: '24px',
  fontSize: '13px',
  color: 'var(--color-text-tertiary)',
}
