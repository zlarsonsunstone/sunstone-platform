import { supabase } from '@/lib/supabase'

/**
 * Supabase defaults to a 1000-row max per query. For reference tables like
 * psc_codes (2,540 active rows) and naics_codes (1,012 rows), we need to
 * paginate. These helpers fetch the entire table in chunks and concatenate.
 */

export async function fetchAllActivePscCodes(): Promise<
  Array<{ code: string; name: string | null; full_name: string | null; level_1_name: string | null }>
> {
  const all: any[] = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('psc_codes')
      .select('code, name, full_name, level_1_name')
      .eq('is_active', true)
      .order('code')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`PSC fetch failed: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

export async function fetchAllNaicsCodes(): Promise<
  Array<{ code: string; title: string | null }>
> {
  const all: any[] = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('naics_codes')
      .select('code, title')
      .order('code')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`NAICS fetch failed: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}
