import { useRef, useState } from 'react'
import { uploadAndExtract, FileUploadResult } from '@/lib/fileUpload'

interface Props {
  tenantId: string
  strategicProfileId: string
  onUploaded: (result: FileUploadResult) => void
  attachedFilename?: string | null
}

const ACCEPTED = '.csv,.tsv,.xls,.xlsx,.pdf,.doc,.docx,.txt,.json'

export function FileUploadInput({
  tenantId,
  strategicProfileId,
  onUploaded,
  attachedFilename,
}: Props) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    setProgress('Uploading ' + file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB)...')

    try {
      const result = await uploadAndExtract(file, tenantId, strategicProfileId)
      const sheetSuffix =
        result.fileMetadata.sheet_names && result.fileMetadata.sheet_names.length > 1
          ? ' . ' + result.fileMetadata.sheet_names.length + ' sheets'
          : ''
      const rowSuffix = result.fileMetadata.row_count
        ? ' . ' + result.fileMetadata.row_count + ' rows extracted'
        : ''
      setProgress('Done: ' + result.fileMetadata.filename + rowSuffix + sheetSuffix)
      onUploaded(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setProgress('')
    } finally {
      setUploading(false)
    }
  }

  function onClick() {
    inputRef.current?.click()
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
  }

  const zoneClassName =
    'fui-zone' +
    (uploading ? ' uploading' : '') +
    (error ? ' error' : '')

  return (
    <div style={{ marginBottom: 12 }}>
      <style>{STYLES}</style>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        onChange={onFileChange}
        style={{ display: 'none' }}
        disabled={uploading}
      />

      <div
        className={zoneClassName}
        onClick={uploading ? undefined : onClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        role="button"
        tabIndex={0}
      >
        <div className="fui-icon">{uploading ? '...' : (attachedFilename ? '[file]' : '[upload]')}</div>
        <div className="fui-text">
          {uploading ? (
            <>
              <strong>Uploading...</strong>
              <span>{progress}</span>
            </>
          ) : attachedFilename ? (
            <>
              <strong>{attachedFilename}</strong>
              <span>Click or drop another file to replace</span>
            </>
          ) : (
            <>
              <strong>Click or drop a file</strong>
              <span>CSV, XLSX, PDF, DOC, TXT - max 25MB. Auto-extracts text.</span>
            </>
          )}
        </div>
      </div>

      {progress && !uploading && !error && (
        <div className="fui-result">{progress}</div>
      )}

      {error && (
        <div className="fui-error">! {error}</div>
      )}
    </div>
  )
}

const STYLES = `
.fui-zone {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px dashed var(--color-hairline);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  cursor: pointer;
  transition: all 0.15s ease;
}
.fui-zone:hover {
  border-color: #F0A742;
  background: rgba(240,167,66,0.04);
}
.fui-zone.uploading {
  cursor: wait;
  border-color: #F0A742;
  background: rgba(240,167,66,0.06);
}
.fui-zone.error {
  border-color: #9B3838;
}

.fui-icon {
  font-size: 13px;
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  font-family: 'SF Mono', Menlo, monospace;
}

.fui-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.fui-text strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fui-text span {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.fui-result {
  margin-top: 6px;
  padding: 6px 10px;
  font-size: 11px;
  color: #2E6B3E;
  background: rgba(46,107,62,0.08);
  border-radius: 4px;
}

.fui-error {
  margin-top: 6px;
  padding: 6px 10px;
  font-size: 11px;
  color: #9B3838;
  background: rgba(155,56,56,0.08);
  border-radius: 4px;
  font-family: 'SF Mono', Menlo, monospace;
  word-break: break-word;
}
`
