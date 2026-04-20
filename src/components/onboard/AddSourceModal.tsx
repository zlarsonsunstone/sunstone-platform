import { useState, ReactNode } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import { Field, TextInput, TextArea } from '@/components/FormInputs'
import { supabase } from '@/lib/supabase'
import { fetchJson } from '@/lib/fetchJson'
import type { SourceBucket, SourceType } from '@/lib/types'

type Mode = 'fetch' | 'paste' | 'upload' | 'highergov'

interface SourceOption {
  type: SourceType
  label: string
  description: string
  bucket: SourceBucket
  mode: Mode
}

const OPTIONS: SourceOption[] = [
  // Commercial
  { type: 'website', label: 'Website', description: 'Scrape + extract text from a URL', bucket: 'commercial', mode: 'fetch' },
  { type: 'linkedin', label: 'LinkedIn (paste)', description: 'Paste LinkedIn About / company page text', bucket: 'commercial', mode: 'paste' },
  { type: 'press_release', label: 'Press release', description: 'Paste press release text or fetch from URL', bucket: 'commercial', mode: 'paste' },
  { type: 'uploaded_doc', label: 'Upload document', description: 'PDF / marketing material / capability narrative', bucket: 'commercial', mode: 'upload' },
  { type: 'free_text', label: 'Notes', description: 'Free-form commercial context or research notes', bucket: 'commercial', mode: 'paste' },
  // Federal
  { type: 'highergov', label: 'HigherGov pull', description: 'Auto-fetch awards + entity from HigherGov', bucket: 'federal', mode: 'highergov' },
  { type: 'sam_gov', label: 'SAM.gov (paste)', description: 'Paste entity registration data from SAM', bucket: 'federal', mode: 'paste' },
  { type: 'sba_dsbs', label: 'SBA DSBS (paste)', description: 'Paste SBA profile / certifications', bucket: 'federal', mode: 'paste' },
  { type: 'usaspending', label: 'USASpending (paste)', description: 'Paste CSV or award history summary', bucket: 'federal', mode: 'paste' },
  { type: 'gsa_elibrary', label: 'GSA eLibrary (paste)', description: 'Paste schedule holdings / SIN info', bucket: 'federal', mode: 'paste' },
  { type: 'cape_statement', label: 'Capability statement', description: 'Upload a federal cape statement PDF', bucket: 'federal', mode: 'upload' },
  { type: 'free_text', label: 'Federal notes', description: 'Free-form federal context notes', bucket: 'federal', mode: 'paste' },
]

interface Props {
  bucket: SourceBucket
  tenantId: string
  tenantName: string
  onClose: () => void
  onAdded: () => void
}

export function AddSourceModal({ bucket, tenantId, tenantName, onClose, onAdded }: Props) {
  const [chosen, setChosen] = useState<SourceOption | null>(null)
  const options = OPTIONS.filter((o) => o.bucket === bucket)

  const title = chosen
    ? `Add ${chosen.label.toLowerCase()}`
    : `Add ${bucket === 'commercial' ? 'commercial' : 'federal'} source`

  return (
    <Modal open={true} onClose={onClose} title={title} size={chosen ? 'lg' : 'md'}>
      {!chosen ? (
        <div>
          <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginTop: 0, marginBottom: '16px' }}>
            Pick how you want to bring this source in. Auto-fetch where possible, paste where not.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => setChosen(opt)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-hairline)',
                  background: 'transparent',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: 'var(--color-text-primary)',
                  transition: 'var(--transition-default)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-subtle)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 500 }}>{opt.label}</div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                    {opt.description}
                  </div>
                </div>
                <ModeBadge mode={opt.mode} />
              </button>
            ))}
          </div>
        </div>
      ) : chosen.mode === 'fetch' ? (
        <WebsiteFetcher
          bucket={bucket}
          type={chosen.type}
          tenantId={tenantId}
          onDone={onAdded}
          onBack={() => setChosen(null)}
        />
      ) : chosen.mode === 'highergov' ? (
        <HigherGovFetcher
          tenantId={tenantId}
          tenantName={tenantName}
          onDone={onAdded}
          onBack={() => setChosen(null)}
        />
      ) : chosen.mode === 'upload' ? (
        <DocumentUploader
          bucket={bucket}
          type={chosen.type}
          tenantId={tenantId}
          onDone={onAdded}
          onBack={() => setChosen(null)}
        />
      ) : (
        <PastePanel
          bucket={bucket}
          type={chosen.type}
          label={chosen.label}
          tenantId={tenantId}
          onDone={onAdded}
          onBack={() => setChosen(null)}
        />
      )}
    </Modal>
  )
}

function ModeBadge({ mode }: { mode: Mode }) {
  const label =
    mode === 'fetch' ? 'Auto' : mode === 'highergov' ? 'API' : mode === 'upload' ? 'Upload' : 'Paste'
  const isAuto = mode === 'fetch' || mode === 'highergov'
  return (
    <span
      style={{
        fontSize: '10px',
        fontWeight: 500,
        padding: '2px 8px',
        borderRadius: '999px',
        background: isAuto ? 'rgba(52, 199, 89, 0.15)' : 'var(--color-bg-subtle)',
        color: isAuto ? 'var(--color-success)' : 'var(--color-text-secondary)',
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Website fetcher                                                            */
/* -------------------------------------------------------------------------- */
function WebsiteFetcher({
  bucket,
  type,
  tenantId,
  onDone,
  onBack,
}: {
  bucket: SourceBucket
  type: SourceType
  tenantId: string
  onDone: () => void
  onBack: () => void
}) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ title: string; text: string } | null>(null)

  async function run() {
    setLoading(true)
    setErr(null)
    try {
      const resp = await fetchJson<{ title: string; text: string }>('/.netlify/functions/fetch-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!resp.ok || !resp.data) throw new Error(resp.error || 'Fetch failed')
      setPreview({ title: resp.data.title || url, text: resp.data.text })
    } catch (e: any) {
      setErr(e.message || 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!preview) return
    setLoading(true)
    await supabase.from('profile_sources').insert({
      tenant_id: tenantId,
      bucket,
      source_type: type,
      label: preview.title,
      url,
      extracted_text: preview.text,
      fetched_at: new Date().toISOString(),
    })
    setLoading(false)
    onDone()
  }

  return (
    <PanelContainer>
      <Field label="URL">
        <TextInput
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          disabled={loading}
        />
      </Field>
      {err && <ErrorLine msg={err} />}

      {!preview ? (
        <FooterRow>
          <Button variant="secondary" onClick={onBack}>Back</Button>
          <Button onClick={run} disabled={!url || loading}>{loading ? 'Fetching…' : 'Fetch'}</Button>
        </FooterRow>
      ) : (
        <>
          <Preview title={preview.title} text={preview.text} />
          <FooterRow>
            <Button variant="secondary" onClick={() => setPreview(null)}>Re-fetch</Button>
            <Button onClick={save} disabled={loading}>{loading ? 'Saving…' : 'Save source'}</Button>
          </FooterRow>
        </>
      )}
    </PanelContainer>
  )
}

/* -------------------------------------------------------------------------- */
/* HigherGov fetcher                                                          */
/* -------------------------------------------------------------------------- */
function HigherGovFetcher({
  tenantId,
  tenantName,
  onDone,
  onBack,
}: {
  tenantId: string
  tenantName: string
  onDone: () => void
  onBack: () => void
}) {
  const [mode, setMode] = useState<'uei' | 'name'>('name')
  const [uei, setUei] = useState('')
  const [name, setName] = useState(tenantName)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ summary: string; awardCount: number } | null>(null)

  async function run() {
    setLoading(true)
    setErr(null)
    try {
      const resp = await fetchJson<{ summary: string; awards?: any[] }>(
        '/.netlify/functions/fetch-highergov',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mode === 'uei' ? { uei } : { company_name: name }),
        }
      )
      if (!resp.ok || !resp.data) throw new Error(resp.error || 'Fetch failed')
      setPreview({ summary: resp.data.summary, awardCount: (resp.data.awards || []).length })
    } catch (e: any) {
      setErr(e.message || 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!preview) return
    setLoading(true)
    await supabase.from('profile_sources').insert({
      tenant_id: tenantId,
      bucket: 'federal',
      source_type: 'highergov',
      label: `HigherGov: ${mode === 'uei' ? uei : name}`,
      extracted_text: preview.summary,
      metadata: { award_count: preview.awardCount, query_mode: mode },
      fetched_at: new Date().toISOString(),
    })
    setLoading(false)
    onDone()
  }

  return (
    <PanelContainer>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
        <ModeButton active={mode === 'name'} onClick={() => setMode('name')}>By company name</ModeButton>
        <ModeButton active={mode === 'uei'} onClick={() => setMode('uei')}>By UEI</ModeButton>
      </div>

      {mode === 'name' ? (
        <Field label="Company name" hint="Exact legal name works best">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      ) : (
        <Field label="UEI" hint="12-character SAM Unique Entity Identifier">
          <TextInput
            value={uei}
            onChange={(e) => setUei(e.target.value.toUpperCase())}
            placeholder="ABCDEF123456"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </Field>
      )}

      {err && <ErrorLine msg={err} />}

      {!preview ? (
        <FooterRow>
          <Button variant="secondary" onClick={onBack}>Back</Button>
          <Button onClick={run} disabled={loading || (mode === 'uei' ? !uei : !name)}>
            {loading ? 'Fetching…' : 'Fetch from HigherGov'}
          </Button>
        </FooterRow>
      ) : (
        <>
          <div style={{ ...previewBoxStyle }}>
            <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>
              Found {preview.awardCount} awards
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--color-text-secondary)',
                maxHeight: '240px',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {preview.summary.slice(0, 3000)}
              {preview.summary.length > 3000 ? '…' : ''}
            </div>
          </div>
          <FooterRow>
            <Button variant="secondary" onClick={() => setPreview(null)}>Retry</Button>
            <Button onClick={save} disabled={loading}>{loading ? 'Saving…' : 'Save source'}</Button>
          </FooterRow>
        </>
      )}
    </PanelContainer>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '8px 12px',
        fontSize: '13px',
        fontFamily: 'inherit',
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        background: active ? 'var(--color-bg-subtle)' : 'transparent',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-hairline)'}`,
        borderRadius: 'var(--radius-input)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Document uploader                                                          */
/* -------------------------------------------------------------------------- */
function DocumentUploader({
  bucket,
  type,
  tenantId,
  onDone,
  onBack,
}: {
  bucket: SourceBucket
  type: SourceType
  tenantId: string
  onDone: () => void
  onBack: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function uploadAndSave() {
    if (!file) return
    setLoading(true)
    setErr(null)
    try {
      // Unique path: tenantId/bucket/timestamp-filename
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${tenantId}/${bucket}/${Date.now()}-${safeName}`

      const { error: uploadErr } = await supabase.storage
        .from('profile-documents')
        .upload(path, file, {
          contentType: file.type || 'application/pdf',
          upsert: false,
        })
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

      const { error: insertErr } = await supabase.from('profile_sources').insert({
        tenant_id: tenantId,
        bucket,
        source_type: type,
        label: label.trim() || file.name,
        url: null,
        // No extracted_text yet — it gets extracted server-side during profile synthesis
        raw_content: null,
        extracted_text: null,
        metadata: {
          filename: file.name,
          size: file.size,
          content_type: file.type,
          storage_path: path,
          storage_bucket: 'profile-documents',
          needs_extraction: true,
        },
        fetched_at: new Date().toISOString(),
      })
      if (insertErr) throw new Error(`Save failed: ${insertErr.message}`)

      onDone()
    } catch (e: any) {
      setErr(e.message || 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PanelContainer>
      <Field label="File" hint="PDF, up to ~25MB. Text will be extracted when you build the profile.">
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0] || null
            setFile(f)
            if (f && !label) setLabel(f.name.replace(/\.pdf$/i, ''))
          }}
          style={{ fontSize: '13px', fontFamily: 'inherit' }}
        />
      </Field>
      {file && (
        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          Selected: {file.name} ({(file.size / 1024).toFixed(0)} KB)
        </div>
      )}
      {file && (
        <Field label="Label">
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder={file.name} />
        </Field>
      )}
      {err && <ErrorLine msg={err} />}

      <FooterRow>
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button onClick={uploadAndSave} disabled={!file || loading}>
          {loading ? 'Uploading…' : 'Upload & save'}
        </Button>
      </FooterRow>
    </PanelContainer>
  )
}

/* -------------------------------------------------------------------------- */
/* Paste panel                                                                */
/* -------------------------------------------------------------------------- */
function PastePanel({
  bucket,
  type,
  label: typeLabel,
  tenantId,
  onDone,
  onBack,
}: {
  bucket: SourceBucket
  type: SourceType
  label: string
  tenantId: string
  onDone: () => void
  onBack: () => void
}) {
  const [label, setLabel] = useState('')
  const [content, setContent] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [loading, setLoading] = useState(false)

  async function save() {
    if (!content.trim()) return
    setLoading(true)
    await supabase.from('profile_sources').insert({
      tenant_id: tenantId,
      bucket,
      source_type: type,
      label: label || typeLabel,
      url: sourceUrl || null,
      raw_content: content,
      extracted_text: content,
      fetched_at: new Date().toISOString(),
    })
    setLoading(false)
    onDone()
  }

  return (
    <PanelContainer>
      <Field label="Label" hint={`e.g., "${typeLabel} – ${new Date().toLocaleDateString()}"`}>
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder={typeLabel} />
      </Field>
      <Field label="Source URL (optional)">
        <TextInput
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://..."
        />
      </Field>
      <Field label="Content" hint="Paste the text directly">
        <TextArea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={12}
          placeholder="Paste text here…"
        />
      </Field>
      <FooterRow>
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button onClick={save} disabled={!content.trim() || loading}>
          {loading ? 'Saving…' : 'Save source'}
        </Button>
      </FooterRow>
    </PanelContainer>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */
function PanelContainer({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>{children}</div>
}

function FooterRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
      {children}
    </div>
  )
}

function ErrorLine({ msg }: { msg: string }) {
  return <div style={{ fontSize: '12px', color: 'var(--color-danger)' }}>{msg}</div>
}

const previewBoxStyle = {
  padding: '12px 14px',
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-hairline)',
  background: 'var(--color-bg-subtle)',
}

function Preview({ title, text }: { title: string; text: string }) {
  return (
    <div style={previewBoxStyle}>
      <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>{title}</div>
      <div
        style={{
          fontSize: '12px',
          color: 'var(--color-text-secondary)',
          maxHeight: '200px',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5,
        }}
      >
        {text.slice(0, 2000)}
        {text.length > 2000 ? '…' : ''}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '8px' }}>
        {text.length.toLocaleString()} characters
      </div>
    </div>
  )
}
