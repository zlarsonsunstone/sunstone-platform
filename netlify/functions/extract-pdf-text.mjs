// extract-pdf-text: accept base64-encoded PDF, return extracted text
// PRIMARY: Use pdf-parse for direct text extraction (fast, no API cost)
// FALLBACK: Use Claude for scanned/image PDFs where direct extraction fails
// Request: { filename: string, pdf_base64: string }
// Response: { text: string, filename: string, length: number, method: 'direct'|'claude'|'fallback' }

import { json } from './_shared-claude.mjs'
import pdfParse from 'pdf-parse'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }

  const { filename, pdf_base64 } = payload
  if (!pdf_base64) return json(400, { error: 'pdf_base64 required' })

  // Decode base64 to buffer
  let buffer
  try {
    buffer = Buffer.from(pdf_base64, 'base64')
  } catch (err) {
    return json(400, { error: 'Invalid base64 PDF data' })
  }

  // -----------------------------------------------------------------
  // PRIMARY: pdf-parse direct extraction
  // -----------------------------------------------------------------
  try {
    const result = await pdfParse(buffer)
    const text = (result.text || '').trim()

    if (text.length > 50) {
      // Got meaningful content
      return json(200, {
        text,
        filename: filename || 'document.pdf',
        length: text.length,
        method: 'direct',
        page_count: result.numpages || 0,
      })
    }

    // pdf-parse returned almost nothing - might be a scanned PDF
    // Fall through to Claude fallback
    console.log('pdf-parse returned ' + text.length + ' chars, falling back to Claude')
  } catch (err) {
    console.error('pdf-parse failed: ' + (err.message || err))
    // Fall through to Claude fallback
  }

  // -----------------------------------------------------------------
  // FALLBACK: Claude (for scanned/image PDFs)
  // -----------------------------------------------------------------
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return json(500, { error: 'pdf-parse failed and ANTHROPIC_API_KEY not configured for fallback' })
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdf_base64,
                },
              },
              {
                type: 'text',
                text: 'Extract ALL text content from this PDF. Preserve the structure with headings and sections. Output only the extracted text - no commentary, no meta-description, no summary. Just the text as it appears in the document.',
              },
            ],
          },
        ],
      }),
    })

    if (!resp.ok) {
      const txt = await resp.text()
      return json(502, { error: 'Both pdf-parse and Claude failed. Claude response: ' + resp.status + ': ' + txt.slice(0, 300) })
    }

    const data = await resp.json()
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    return json(200, {
      text,
      filename: filename || 'document.pdf',
      length: text.length,
      method: 'claude',
    })
  } catch (err) {
    return json(500, { error: 'PDF extraction failed: ' + (err.message || 'unknown') })
  }
}
