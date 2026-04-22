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
export function mapCsvRowToRecord(
  row: Record<string, string>
): Partial<Record<string, string | number>> {
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      if (row[k]) return row[k]
    }
    return ''
  }

  const toNumber = (v: string): number | null => {
    if (!v) return null
    const n = parseFloat(v.replace(/[$,]/g, ''))
    return isNaN(n) ? null : n
  }

  return {
    contract_number: pick(
      'contract_number',
      'award_id_piid',
      'contract_award_unique_key',
      'piid',
      'notice_id'
    ),
    awardee: pick(
      'awardee',
      'recipient_name',
      'vendor_name',
      'company_name'
    ),
    uei: pick('uei', 'recipient_uei', 'awardee_uei'),
    agency: pick(
      'agency',
      'awarding_agency_name',
      'contracting_agency_name',
      'department_ind_agency'
    ),
    department: pick('department', 'awarding_department_name'),
    office: pick('office', 'awarding_sub_agency_name', 'contracting_office_name'),
    naics_code: pick('naics_code', 'naics'),
    psc_code: pick('psc_code', 'psc', 'product_or_service_code'),
    obligated: toNumber(
      pick(
        'obligated',
        'obligated_amount',
        'action_obligation',
        'total_dollars_obligated',
        'total_obligated_amount',       // USASpending.gov
        'current_total_value_of_award', // USASpending fallback
        'award_amount',                 // HigherGov variant
        'amount'
      )
    ) as any,
    total_value: toNumber(
      pick(
        'total_value',
        'base_and_all_options_value',
        'current_total_value_of_award',
        'potential_total_value_of_award',  // USASpending.gov
        'potential_total_value'
      )
    ) as any,
    description: pick(
      'description',
      'award_description',
      'transaction_description',
      'description_of_requirement',
      'prime_award_base_transaction_description'  // USASpending.gov
    ),
    start_date: pick('start_date', 'period_of_performance_start_date', 'action_date', 'award_base_action_date'),
    end_date: pick('end_date', 'period_of_performance_current_end_date'),
    set_aside: pick('set_aside', 'type_of_set_aside', 'set_aside_type'),
    pop_state: pick('pop_state', 'primary_place_of_performance_state_code', 'place_of_performance_state'),
    vendor_state: pick('vendor_state', 'recipient_state_code', 'vendor_state_code'),
  }
}
