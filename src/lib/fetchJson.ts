/**
 * Safe fetch wrapper for Netlify Functions.
 * Returns { ok, data, error } — never throws, always returns JSON-safe object.
 * Handles the "function returned HTML error page" case gracefully.
 */

export interface SafeFetchResult<T = any> {
  ok: boolean
  status: number
  data: T | null
  error: string | null
}

export async function fetchJson<T = any>(
  url: string,
  init?: RequestInit
): Promise<SafeFetchResult<T>> {
  let resp: Response
  try {
    resp = await fetch(url, init)
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: `Network error: ${e.message || 'request failed'}`,
    }
  }

  const status = resp.status
  const contentType = resp.headers.get('content-type') || ''

  // If we got HTML back instead of JSON, the function crashed or timed out
  if (!contentType.includes('application/json')) {
    const text = await resp.text().catch(() => '')
    const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim()

    // Common Netlify error signatures
    if (status === 504 || /timeout|timed out/i.test(text)) {
      return {
        ok: false,
        status,
        data: null,
        error: `Function timed out (${status}). The request took too long — try fewer sources or a smaller document.`,
      }
    }
    if (status === 502 || status === 503) {
      return {
        ok: false,
        status,
        data: null,
        error: `Function unavailable (${status}). Netlify may still be deploying; try again in ~60 seconds.`,
      }
    }
    return {
      ok: false,
      status,
      data: null,
      error: `Function returned non-JSON (${status}): ${snippet || 'empty body'}`,
    }
  }

  let data: any
  try {
    data = await resp.json()
  } catch (e: any) {
    return {
      ok: false,
      status,
      data: null,
      error: `Invalid JSON response (${status}): ${e.message || ''}`,
    }
  }

  if (!resp.ok) {
    return {
      ok: false,
      status,
      data,
      error: (data && (data.error || data.message)) || `HTTP ${status}`,
    }
  }

  return { ok: true, status, data, error: null }
}
