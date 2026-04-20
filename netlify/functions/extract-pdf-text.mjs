// extract-pdf-text: accept base64-encoded PDF, return extracted text
// Uses Claude's native PDF support (document content block) as the extractor
// Request: { filename: string, pdf_base64: string }
// Response: { text: string, filename: string, length: number }

import { callClaude, json } from './_shared-claude.mjs'

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

  try {
    // Call Anthropic with the PDF as a document block + extraction instruction
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' })

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
                text: 'Extract ALL text content from this PDF. Preserve the structure with headings and sections. Output only the extracted text — no commentary, no meta-description, no summary. Just the text as it appears in the document.',
              },
            ],
          },
        ],
      }),
    })

    if (!resp.ok) {
      const txt = await resp.text()
      return json(502, { error: `Anthropic ${resp.status}: ${txt.slice(0, 500)}` })
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
    })
  } catch (err) {
    return json(500, { error: err.message || 'PDF extraction failed' })
  }
}
