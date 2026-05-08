/**
 * EngagementInit - Stage 0 of the recon journey
 *
 * Consultant creates an engagement on top of an existing Strategic Profile
 * (which already has CBP done + reconciliation done).
 *
 * Captures:
 *   - Engagement title (e.g., "WB - Federal Multilingual Outreach Recon")
 *   - The Decider (one named user, with email + role/title)
 *   - Optional Viewers (up to 4 more)
 *   - Engagement notes / closing thesis
 *
 * On commit, advances strategic_profile.engagement_stage from
 * 'stage_0_initialized' to 'stage_2_frame_workshop' and unlocks the
 * Frame Workshop.
 */
import { useState, useEffect, CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'

interface Props {
  strategicProfileId: string
  tenantId: string
  profileName: string
  onClose: () => void
  onCompleted: () => void
}

interface UserDraft {
  id: string  // local id for this draft, not DB
  name: string
  email: string
  title: string
  role: 'decider' | 'viewer'
}

export function EngagementInit({
  strategicProfileId,
  tenantId,
  profileName,
  onClose,
  onCompleted,
}: Props) {
  const [engagementTitle, setEngagementTitle] = useState(`${profileName} - Federal Recon`)
  const [closingThesis, setClosingThesis] = useState('')
  const [users, setUsers] = useState<UserDraft[]>([
    { id: 'd1', name: '', email: '', title: '', role: 'decider' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingUsers, setExistingUsers] = useState<any[]>([])

  // Check if engagement already initialized (in case of re-open)
  useEffect(() => {
    void loadExisting()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategicProfileId])

  async function loadExisting() {
    const { data } = await supabase
      .from('engagement_users')
      .select('*')
      .eq('strategic_profile_id', strategicProfileId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
    if (data && data.length > 0) {
      setExistingUsers(data)
      // Reset form to show existing
      setUsers(data.map((u: any, i: number) => ({
        id: `existing-${i}`,
        name: u.user_name,
        email: u.user_email,
        title: u.user_title || '',
        role: u.role,
      })))
    }
    const { data: profile } = await supabase
      .from('strategic_profiles')
      .select('engagement_title')
      .eq('id', strategicProfileId)
      .single()
    if (profile?.engagement_title) {
      setEngagementTitle(profile.engagement_title)
    }
  }

  function addViewer() {
    if (users.length >= 5) return
    setUsers([
      ...users,
      { id: `v${Date.now()}`, name: '', email: '', title: '', role: 'viewer' },
    ])
  }

  function removeUser(id: string) {
    if (users.find(u => u.id === id)?.role === 'decider') {
      setError('Cannot remove the Decider. Reassign first.')
      return
    }
    setUsers(users.filter(u => u.id !== id))
  }

  function updateUser(id: string, patch: Partial<UserDraft>) {
    setUsers(users.map(u => (u.id === id ? { ...u, ...patch } : u)))
  }

  function reassignDecider(newDeciderId: string) {
    setUsers(users.map(u => ({
      ...u,
      role: u.id === newDeciderId ? 'decider' : (u.role === 'decider' ? 'viewer' : u.role),
    })))
  }

  async function commit() {
    setError(null)

    // Validate
    if (!engagementTitle.trim()) {
      setError('Engagement title is required')
      return
    }
    const decider = users.find(u => u.role === 'decider')
    if (!decider) {
      setError('A Decider must be designated')
      return
    }
    if (!decider.name.trim() || !decider.email.trim()) {
      setError('Decider must have a name and email')
      return
    }
    for (const u of users) {
      if (u.email && !u.email.includes('@')) {
        setError(`Invalid email: ${u.email}`)
        return
      }
    }

    setSaving(true)
    try {
      // 1. Update strategic_profiles
      await supabase
        .from('strategic_profiles')
        .update({
          engagement_title: engagementTitle.trim(),
          engagement_stage: 'stage_2_frame_workshop',
          client_status: 'prospect',
        })
        .eq('id', strategicProfileId)

      // 2. Insert/update engagement_users (only new ones for now)
      if (existingUsers.length === 0) {
        const userRows = users
          .filter(u => u.name.trim() && u.email.trim())
          .map(u => ({
            tenant_id: tenantId,
            strategic_profile_id: strategicProfileId,
            user_email: u.email.trim().toLowerCase(),
            user_name: u.name.trim(),
            user_title: u.title.trim() || null,
            role: u.role,
            status: 'active',
          }))

        const { data: insertedUsers, error: insertErr } = await supabase
          .from('engagement_users')
          .insert(userRows)
          .select()
        if (insertErr) throw insertErr

        // 3. Create initial decider_assignment
        const insertedDecider = (insertedUsers || []).find(u => u.role === 'decider')
        if (insertedDecider) {
          await supabase.from('decider_assignments').insert({
            tenant_id: tenantId,
            strategic_profile_id: strategicProfileId,
            assigned_user_id: insertedDecider.id,
            is_active: true,
            reason: 'Initial decider designation at engagement init',
          })
        }
      }

      // 4. Save closing thesis as a note (use confirmation_change_log for permanence)
      if (closingThesis.trim()) {
        await supabase.from('confirmation_change_log').insert({
          tenant_id: tenantId,
          strategic_profile_id: strategicProfileId,
          event_type: 'consultant_draft_saved',
          actor_type: 'consultant',
          payload_snapshot: { closing_thesis: closingThesis.trim() },
          notes: 'Closing thesis captured at engagement init',
        })
      }

      onCompleted()
    } catch (e: any) {
      setError(e.message || 'Save failed')
      setSaving(false)
    }
  }

  return (
    <Modal open={true} onClose={onClose} title="Initialize Engagement" size="full">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={introBoxStyle}>
          <strong>Stage 0 of the Recon Journey.</strong> Set up the engagement metadata, designate the
          Decider (one client voice with confirmation authority), and add up to 4 Viewers. The Decider
          can be reassigned later by the client. Audit trail preserved throughout.
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        {/* Engagement Title */}
        <div>
          <Label>Engagement Title</Label>
          <input
            value={engagementTitle}
            onChange={(e) => setEngagementTitle(e.target.value)}
            placeholder="e.g., Wicked Bionic - Federal Multilingual Outreach Recon"
            style={inputStyle}
          />
        </div>

        {/* Closing Thesis */}
        <div>
          <Label>Closing Thesis (optional, internal note)</Label>
          <textarea
            value={closingThesis}
            onChange={(e) => setClosingThesis(e.target.value)}
            placeholder="What do we believe will close this prospect? What proof would they need to see?"
            rows={3}
            style={textareaStyle}
          />
        </div>

        {/* Users */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <Label>Engagement Users</Label>
            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              {users.filter(u => u.name && u.email).length} of 5 max
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                canBeDecider={true}
                onUpdate={(patch) => updateUser(u.id, patch)}
                onMakeDecider={() => reassignDecider(u.id)}
                onRemove={() => removeUser(u.id)}
                disabled={existingUsers.length > 0}
              />
            ))}
          </div>

          {users.length < 5 && existingUsers.length === 0 && (
            <button onClick={addViewer} style={addUserButtonStyle}>
              + Add Viewer
            </button>
          )}
          {existingUsers.length > 0 && (
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '8px', fontStyle: 'italic' }}>
              Engagement already initialized. To add or modify users, use the engagement settings.
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px' }}>
          <button onClick={onClose} style={{ padding: "8px 16px", background: "transparent", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-input)", color: "var(--color-text-secondary)", cursor: "pointer", fontFamily: "inherit", fontSize: "13px" }}>Cancel</button>
          <Button onClick={commit} disabled={saving}>
            {saving ? 'Saving...' : (existingUsers.length > 0 ? 'Update Engagement' : 'Initialize and Continue')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function UserRow({
  user,
  canBeDecider,
  onUpdate,
  onMakeDecider,
  onRemove,
  disabled,
}: {
  user: UserDraft
  canBeDecider: boolean
  onUpdate: (patch: Partial<UserDraft>) => void
  onMakeDecider: () => void
  onRemove: () => void
  disabled: boolean
}) {
  const isDecider = user.role === 'decider'
  return (
    <div
      style={{
        padding: '12px 14px',
        border: `2px solid ${isDecider ? '#f0a742' : 'var(--color-hairline)'}`,
        borderRadius: 'var(--radius-input)',
        background: isDecider ? 'rgba(240, 167, 66, 0.04)' : 'white',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isDecider ? (
            <span style={deciderBadgeStyle}>DECIDER</span>
          ) : (
            <span style={viewerBadgeStyle}>VIEWER</span>
          )}
          {!isDecider && canBeDecider && !disabled && (
            <button onClick={onMakeDecider} style={makeDeciderButtonStyle}>
              Make Decider
            </button>
          )}
        </div>
        {!isDecider && !disabled && (
          <button onClick={onRemove} style={removeButtonStyle}>x</button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <input
          value={user.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Full name"
          style={inputStyle}
          disabled={disabled}
        />
        <input
          value={user.email}
          onChange={(e) => onUpdate({ email: e.target.value })}
          placeholder="email@company.com"
          type="email"
          style={inputStyle}
          disabled={disabled}
        />
      </div>
      <input
        value={user.title}
        onChange={(e) => onUpdate({ title: e.target.value })}
        placeholder="Title (e.g., CEO)"
        style={inputStyle}
        disabled={disabled}
      />
    </div>
  )
}

// Styles

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--color-text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: '6px',
      }}
    >
      {children}
    </div>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '13px',
  fontFamily: 'inherit',
  border: '1px solid var(--color-hairline)',
  borderRadius: 'var(--radius-input)',
  background: 'white',
  color: 'var(--color-text-primary)',
}

const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
}

const introBoxStyle: CSSProperties = {
  padding: '12px 14px',
  background: 'rgba(240, 167, 66, 0.06)',
  border: '1px solid rgba(240, 167, 66, 0.25)',
  borderRadius: 'var(--radius-input)',
  fontSize: '13px',
  color: 'var(--color-text-secondary)',
  lineHeight: 1.5,
}

const errorStyle: CSSProperties = {
  padding: '10px 12px',
  background: 'rgba(255, 59, 48, 0.08)',
  border: '1px solid rgba(255, 59, 48, 0.25)',
  borderRadius: 'var(--radius-input)',
  color: 'var(--color-danger)',
  fontSize: '13px',
}

const deciderBadgeStyle: CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  padding: '3px 10px',
  borderRadius: '4px',
  background: '#f0a742',
  color: '#2a2622',
}

const viewerBadgeStyle: CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  padding: '3px 10px',
  borderRadius: '4px',
  background: 'var(--color-bg-subtle)',
  color: 'var(--color-text-secondary)',
}

const makeDeciderButtonStyle: CSSProperties = {
  fontSize: '10px',
  padding: '3px 8px',
  background: 'transparent',
  border: '1px solid var(--color-hairline)',
  borderRadius: '4px',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const removeButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-tertiary)',
  cursor: 'pointer',
  padding: '4px 8px',
  fontSize: '14px',
  lineHeight: 1,
}

const addUserButtonStyle: CSSProperties = {
  marginTop: '8px',
  padding: '8px 14px',
  background: 'transparent',
  border: '1px dashed var(--color-hairline)',
  borderRadius: 'var(--radius-input)',
  color: 'var(--color-text-secondary)',
  fontSize: '13px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  width: '100%',
}
