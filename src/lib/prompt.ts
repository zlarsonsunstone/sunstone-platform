/**
 * Prompt rendering per PRD v1.4 PV-4 / PV-5.
 * Single entry point: renderPrompt(variantTemplate, context)
 * Replaces {{placeholders}} with values from a context object.
 * Throws if a referenced placeholder has no value — no silent empty sends.
 */

export interface TenantProfileContext {
  client_name: string
  client_description: string
  client_naics: string
  client_certifications: string
  client_website: string
}

export interface RecordContext {
  awardee: string
  agency: string
  obligated: string
  naics_code: string
  description: string
  contract_number: string
}

export type PromptContext = Partial<TenantProfileContext & RecordContext> & {
  turn?: number
  next_turn?: number
  gate_context?: string
  [key: string]: any
}

export function renderPrompt(template: string, context: PromptContext): string {
  const placeholderRegex = /\{\{(\w+)\}\}/g
  const missing: string[] = []

  const rendered = template.replace(placeholderRegex, (_match, key) => {
    const value = context[key]
    if (value === undefined || value === null || value === '') {
      missing.push(key)
      return `{{${key}}}`
    }
    return String(value)
  })

  if (missing.length > 0) {
    throw new Error(
      `Prompt template references placeholders with no value: ${missing.join(', ')}. ` +
      `Supply these in the context object before rendering.`
    )
  }

  return rendered
}

/**
 * Extract placeholder names from a template without rendering.
 * Useful for the Preview tool to show what fields are required.
 */
export function extractPlaceholders(template: string): string[] {
  const regex = /\{\{(\w+)\}\}/g
  const found = new Set<string>()
  let match
  while ((match = regex.exec(template)) !== null) {
    found.add(match[1])
  }
  return Array.from(found)
}
