// fetch-website: GET a URL, strip HTML, return clean text
// Request: { url: string }
// Response: { text: string, title: string, length: number }

import { json } from './_shared-claude.mjs'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }

  const { url } = payload
  if (!url || typeof url !== 'string') return json(400, { error: 'url required' })

  // Normalize
  let target = url.trim()
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target

  try {
    const resp = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SunstonePlatform/1.0; +https://sunstoneplatform.netlify.app)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    })

    if (!resp.ok) return json(502, { error: `Upstream ${resp.status}` })

    const html = await resp.text()
    const { text, title } = htmlToText(html)

    return json(200, {
      text: text.slice(0, 50000), // cap at 50kb of text
      title,
      length: text.length,
      url: target,
    })
  } catch (err) {
    return json(500, { error: err.message || 'Fetch failed' })
  }
}

function htmlToText(html) {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : ''

  // Strip scripts, styles, comments
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')

  // Convert common block elements to newlines
  cleaned = cleaned.replace(/<(br|p|div|h[1-6]|li|tr|section|article)[^>]*>/gi, '\n')

  // Strip remaining tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ')

  // Decode entities
  cleaned = decodeEntities(cleaned)

  // Collapse whitespace
  cleaned = cleaned
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')

  return { text: cleaned, title }
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
}
