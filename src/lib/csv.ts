/**
 * Lightweight CSV parser for SAM.gov / HigherGov exports.
 * Handles quoted values, escaped quotes, commas inside quotes.
 * Returns array of row objects keyed by the first-row headers.
 */

export function parseCsv(text: string): Record<string, string>[] {
  const rows = splitLines(text)
  if (rows.length === 0) return []

  const headers = parseRow(rows[0]).map(normalizeHeader)
  const result: Record<string, string>[] = []

  for (let i = 1; i < rows.length; i++) {
    const cells = parseRow(rows[i])
    if (cells.length === 0 || (cells.length === 1 && cells[0] === '')) continue

    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cells[j] || '').trim()
    }
    result.push(row)
  }

  return result
}

function splitLines(text: string): string[] {
  // Handle CRLF, LF, and lone CR
  return text.replace(/\r\n?/g, '\n').split('\n')
}

function parseRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  let i = 0

  while (i < line.length) {
    const ch = line[i]

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 2
        } else {
          inQuotes = false
          i++
        }
      } else {
        cur += ch
        i++
      }
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
      } else if (ch === ',') {
        cells.push(cur)
        cur = ''
        i++
      } else {
        cur += ch
        i++
      }
    }
  }

  cells.push(cur)
  return cells
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/**
 * Map common SAM.gov / HigherGov / USASpending column names to our
 * enrichment_records schema fields. If a CSV comes in with different
 * column names, map them here.
 */
/**
 * Map common SAM.gov / HigherGov / USASpending column names to our
 * enrichment_records schema fields. If a CSV comes in with different
 * column names, map them here.
 *
 * Empty fields return `null` so Postgres doesn't reject empty strings
 * for typed columns (date, numeric). Dates are parsed from various
 * common formats (ISO, US M/D/YYYY, with or without timestamps).
 */
export function mapCsvRowToRecord(
  row: Record<string, string>
): Partial<Record<string, string | number | null>> {
  // Return the first non-empty value from the candidate keys, or null.
  const pickOrNull = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = row[k]
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        return String(v).trim()
      }
    }
    return null
  }

  // Number parser that returns null for missing / unparseable values.
  const toNumber = (v: string | null): number | null => {
    if (v === null) return null
    const cleaned = v.replace(/[$,\s]/g, '')
    if (cleaned === '') return null
    const n = parseFloat(cleaned)
    return isNaN(n) ? null : n
  }

  // Date parser: accepts ISO "YYYY-MM-DD", US "M/D/YYYY" (optionally with
  // time suffix like " 0:00"), returns ISO format. null on failure.
  const toDate = (v: string | null): string | null => {
    if (v === null) return null
    let cleaned = v.trim()
    // Strip trailing time portion if present (USASpending sometimes has
    // "6/21/2028 0:00")
    cleaned = cleaned.replace(/\s+\d{1,2}:\d{2}.*$/, '')

    // Already ISO?
    const iso = /^\d{4}-\d{2}-\d{2}$/
    if (iso.test(cleaned)) return cleaned

    // US M/D/YYYY or MM/DD/YYYY
    const usMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (usMatch) {
      const [, m, d, y] = usMatch
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }

    // Generic parse fallback
    const d = new Date(cleaned)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)

    return null
  }

  return {
    contract_number: pickOrNull(
      'contract_number',
      'award_id_piid',
      'contract_award_unique_key',
      'piid',
      'notice_id'
    ),
    awardee: pickOrNull(
      'awardee',
      'recipient_name',
      'vendor_name',
      'company_name'
    ),
    uei: pickOrNull('uei', 'recipient_uei', 'awardee_uei'),
    agency: pickOrNull(
      'agency',
      'awarding_agency_name',
      'contracting_agency_name',
      'department_ind_agency'
    ),
    department: pickOrNull('department', 'awarding_department_name'),
    office: pickOrNull('office', 'awarding_sub_agency_name', 'contracting_office_name'),
    naics_code: pickOrNull('naics_code', 'naics'),
    psc_code: pickOrNull('psc_code', 'psc', 'product_or_service_code'),
    obligated: toNumber(
      pickOrNull(
        'obligated',
        'obligated_amount',
        'action_obligation',
        'total_dollars_obligated',
        'total_obligated_amount',       // USASpending.gov
        'current_total_value_of_award', // USASpending fallback
        'award_amount',                 // HigherGov variant
        'amount'
      )
    ),
    total_value: toNumber(
      pickOrNull(
        'total_value',
        'base_and_all_options_value',
        'current_total_value_of_award',
        'potential_total_value_of_award',  // USASpending.gov
        'potential_total_value'
      )
    ),
    description: pickOrNull(
      'description',
      'award_description',
      'transaction_description',
      'description_of_requirement',
      'prime_award_base_transaction_description'  // USASpending.gov
    ),
    start_date: toDate(
      pickOrNull(
        'start_date',
        'period_of_performance_start_date',
        'action_date',
        'award_base_action_date'
      )
    ),
    end_date: toDate(
      pickOrNull(
        'end_date',
        'period_of_performance_current_end_date'
      )
    ),
    set_aside: pickOrNull('set_aside', 'type_of_set_aside', 'set_aside_type'),
    pop_state: pickOrNull('pop_state', 'primary_place_of_performance_state_code', 'place_of_performance_state'),
    vendor_state: pickOrNull('vendor_state', 'recipient_state_code', 'vendor_state_code'),
  }
}
