import { supabase } from '@/lib/supabase'

/**
 * Fire-and-forget methodology logger. Intentionally does NOT throw or block —
 * we never want logging to break the primary workflow. Best-effort insert,
 * errors console.warn'd silently.
 */
export async function logMethodology(args: {
  tenantId: string
  sessionId?: string | null
  roundNumber?: number | null
  turnNumber?: number | null
  eventType: string
  actor?: string
  summary?: string
  details?: Record<string, any>
}) {
  try {
    const { error } = await supabase.from('methodology_log').insert({
      tenant_id: args.tenantId,
      session_id: args.sessionId || null,
      round_number: args.roundNumber ?? null,
      turn_number: args.turnNumber ?? null,
      event_type: args.eventType,
      actor: args.actor || 'system',
      summary: args.summary || null,
      details: args.details || null,
    })
    if (error) {
      console.warn('[methodology_log] insert failed:', error.message)
    }
  } catch (err: any) {
    console.warn('[methodology_log] exception:', err?.message)
  }
}
