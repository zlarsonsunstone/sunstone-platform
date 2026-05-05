import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'

export interface FileUploadResult {
  storagePath: string
  publicUrl: string | null
  extractedText: string
  fileMetadata: {
    filename: string
    size_bytes: number
    mime_type: string
    extracted_format: 'csv' | 'xlsx' | 'text' | 'pdf' | 'doc' | 'unknown'
    sheet_names?: string[]
    row_count?: number
  }
}

const BUCKET_NAME = 'surface-research'
const MAX_BYTES = 25 * 1024 * 1024
const MAX_TEXT_CHARS = 200000

const MIME_BY_EXT: Record<string, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  json: 'application/json',
}

// -----------------------------------------------------------------------------
// Helper: convert a File to base64 string (no data URI prefix)
// -----------------------------------------------------------------------------

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // result looks like: "data:application/pdf;base64,JVBERi0xLjQK..."
      const commaIdx = result.indexOf(',')
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result)
    }
    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

// -----------------------------------------------------------------------------
// Helper: call extract-pdf-text edge function
// -----------------------------------------------------------------------------

async function extractPdfText(file: File): Promise<string> {
  const pdf_base64 = await fileToBase64(file)
  const response = await fetch('/.netlify/functions/extract-pdf-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      pdf_base64,
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error('extract-pdf-text failed: ' + response.status + ' ' + errBody.slice(0, 300))
  }

  const data = await response.json() as { text?: string; length?: number; error?: string }
  if (data.error) {
    throw new Error('extract-pdf-text returned error: ' + data.error)
  }
  if (!data.text) {
    throw new Error('extract-pdf-text returned no text')
  }
  return data.text
}

// -----------------------------------------------------------------------------
// Main upload + extract
// -----------------------------------------------------------------------------

export async function uploadAndExtract(
  file: File,
  tenantId: string,
  strategicProfileId: string,
): Promise<FileUploadResult> {
  if (file.size > MAX_BYTES) {
    throw new Error('File too large: ' + (file.size / 1024 / 1024).toFixed(1) + 'MB exceeds 25MB limit')
  }

  const ext = (file.name.split('.').pop() || '').toLowerCase()
  const mime = file.type || MIME_BY_EXT[ext] || 'application/octet-stream'
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = tenantId + '/' + strategicProfileId + '/' + timestamp + '-' + safeName

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, file, {
      contentType: mime,
      upsert: false,
    })

  if (uploadErr) {
    throw new Error('Upload failed: ' + uploadErr.message)
  }

  const { data: urlData } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, 3600)

  let extractedText = ''
  let extractedFormat: FileUploadResult['fileMetadata']['extracted_format'] = 'unknown'
  let sheetNames: string[] | undefined
  let rowCount: number | undefined

  try {
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt' || ext === 'json') {
      extractedText = await file.text()
      extractedFormat = ext === 'json' ? 'text' : 'csv'
      if (ext === 'csv' || ext === 'tsv') {
        rowCount = extractedText.split(/\r?\n/).filter(line => line.trim()).length
      }
    } else if (ext === 'xls' || ext === 'xlsx') {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      sheetNames = workbook.SheetNames
      const allSheets: string[] = []
      let totalRows = 0
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name]
        const csv = XLSX.utils.sheet_to_csv(sheet)
        const sheetRows = csv.split(/\r?\n/).filter(l => l.trim()).length
        totalRows += sheetRows
        allSheets.push('### Sheet: ' + name + ' (' + sheetRows + ' rows)\n' + csv)
      }
      extractedText = allSheets.join('\n\n')
      extractedFormat = 'xlsx'
      rowCount = totalRows
    } else if (ext === 'pdf') {
      // Call the extract-pdf-text edge function for real text extraction
      try {
        extractedText = await extractPdfText(file)
        extractedFormat = 'pdf'
      } catch (pdfErr) {
        console.error('PDF extraction failed, file still stored:', pdfErr)
        extractedText =
          '[PDF uploaded: ' + file.name + ', ' + (file.size / 1024).toFixed(1) + ' KB]\n\n' +
          'PDF text extraction failed: ' + (pdfErr instanceof Error ? pdfErr.message : String(pdfErr)) + '\n' +
          'Original file stored at ' + storagePath + '. You may add a summary in the user-context field below.'
        extractedFormat = 'pdf'
      }
    } else if (ext === 'doc' || ext === 'docx') {
      extractedText =
        '[Word document uploaded: ' + file.name + ', ' + (file.size / 1024).toFixed(1) + ' KB]\n\n' +
        'Original file stored. Text extraction not performed in v1 - paste a summary below or refer to file via download link.'
      extractedFormat = 'doc'
    } else {
      extractedText =
        '[File uploaded: ' + file.name + ', ' + (file.size / 1024).toFixed(1) + ' KB, type=' + mime + ']\n\n' +
        'Original file stored at ' + storagePath + '.'
      extractedFormat = 'unknown'
    }
  } catch (extractErr) {
    console.error('Text extraction failed (file still uploaded):', extractErr)
    extractedText =
      '[Upload succeeded but text extraction failed for ' + file.name + ']\n' +
      'Error: ' + (extractErr instanceof Error ? extractErr.message : String(extractErr)) + '\n' +
      'Original file is at ' + storagePath + '.'
  }

  if (extractedText.length > MAX_TEXT_CHARS) {
    extractedText =
      extractedText.slice(0, MAX_TEXT_CHARS) +
      '\n\n[... truncated; original is ' + (file.size / 1024 / 1024).toFixed(2) + 'MB. Full file in storage.]'
  }

  return {
    storagePath,
    publicUrl: urlData?.signedUrl || null,
    extractedText,
    fileMetadata: {
      filename: file.name,
      size_bytes: file.size,
      mime_type: mime,
      extracted_format: extractedFormat,
      sheet_names: sheetNames,
      row_count: rowCount,
    },
  }
}

export async function getSignedDownloadUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, 3600)
  if (error) {
    console.error('createSignedUrl error:', error.message)
    return null
  }
  return data?.signedUrl || null
}

export async function deleteFromStorage(storagePath: string): Promise<boolean> {
  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([storagePath])
  if (error) {
    console.error('Storage delete error:', error.message)
    return false
  }
  return true
}
