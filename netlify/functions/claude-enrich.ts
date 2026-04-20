/**
 * Netlify Function: /.netlify/functions/claude-enrich
 *
 * Proxies enrichment prompts to the Anthropic API. The key lives in
 * Netlify environment variables only — never exposed to the browser.
 *
 * POST body: { prompt: string }
 * Response:  { text: string }  or  { error: string }
 */

interface HandlerEvent {
  httpMethod: string
  body: string | null
  headers: Record<string, string>
}

export const handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'ANTHROPIC_API_KEY is not set on the Netlify site.',
      }),
    }
  }

  let body: { prompt?: string; model?: string; max_tokens?: number }
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    }
  }

  const prompt = body.prompt
  if (!prompt || typeof prompt !== 'string') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing prompt (string) in request body' }),
    }
  }

  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-5',
        max_tokens: body.max_tokens || 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await anthropicResponse.json()

    if (!anthropicResponse.ok) {
      return {
        statusCode: anthropicResponse.status,
        body: JSON.stringify({
          error: data?.error?.message || `Anthropic API error ${anthropicResponse.status}`,
        }),
      }
    }

    // Extract text from content blocks
    const textBlocks = (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: textBlocks,
        usage: data.usage,
        stop_reason: data.stop_reason,
      }),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err?.message || 'Unknown error' }),
    }
  }
}
