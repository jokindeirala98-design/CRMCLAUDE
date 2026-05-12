'use client'

import { useEffect, useState, useCallback } from 'react'
import { Save, UserPlus, Shield, Users, Key, ExternalLink, CheckCircle, AlertCircle, Trash2, RotateCw, Lock, Edit2, MessageCircle, Link2, Unlink, Copy, Check, CalendarDays } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { DataTable } from '@/components/ui/DataTable'
import { createClient } from '@/lib/supabase/client'
import { getUserInitials } from '@/lib/utils/format'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/Toast'

export default function SettingsPage() {
  const { user, isAdmin } = useAuthStore()
  const { toast } = useToast()
  const [teamMembers, setTeamMembers] = useState<any[]>([])
  const [pendingInvitations, setPendingInvitations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [invitationLoading, setInvitationLoading] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [editingPermissions, setEditingPermissions] = useState<Record<string, boolean>>({})
  const [editingRole, setEditingRole] = useState<string>('')
  const [geminiStatus, setGeminiStatus] = useState<{ ok: boolean; model?: string; error?: string; keyPrefix?: string } | null>(null)
  const [geminiLoading, setGeminiLoading] = useState(false)
  const [reextractName, setReextractName] = useState('')
  const [reextractLoading, setReextractLoading] = useState(false)
  const [reextractResult, setReextractResult] = useState<{ ok: number; errors: number; total: number; results?: any[] } | null>(null)
  const [profile, setProfile] = useState({
    full_name: '',
    nickname: '',
    email: '',
    phone: '',
  })
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' })
  const [passwordLoading, setPasswordLoading] = useState(false)
  // ── Permission groups — mirrors the sidebar sections ──
  const PERMISSION_GROUPS = [
    {
      label: 'General',
      items: [
        { key: 'panel',  label: 'Panel' },
        { key: 'inbox',  label: 'Bandeja' },
        { key: 'agenda', label: 'Agenda' },
      ],
    },
    {
      label: 'Operación',
      items: [
        { key: 'clients',      label: 'Clientes' },
        { key: 'supplies',     label: 'Suministros' },
        { key: 'prescorings',  label: 'Prescorings' },
        { key: 'comparativas', label: 'Comparativas 2.0' },
        { key: 'contracts',    label: 'Contratos' },
      ],
    },
    {
      label: 'Finanzas',
      items: [
        { key: 'billing',     label: 'Facturación' },
        { key: 'commissions', label: 'Comisiones' },
        { key: 'reports',     label: 'Estadísticas' },
      ],
    },
  ] as const

  const DEFAULT_PERMISSIONS = {
    panel: false, inbox: false, agenda: false,
    clients: false, supplies: false, prescorings: false, comparativas: false, contracts: false,
    billing: false, commissions: false, reports: false,
  }

  const [inviteForm, setInviteForm] = useState({
    email: '',
    full_name: '',
    nickname: '',
    password: '',
    role: 'commercial',
    permissions: { ...DEFAULT_PERMISSIONS },
  })

  // ── Telegram bot state ──
  const [telegramLink, setTelegramLink] = useState<any>(null)
  const [telegramLoading, setTelegramLoading] = useState(false)

  // ── Google Calendar state ──
  const [gcalConnected,       setGcalConnected]       = useState(false)
  const [gcalLoading,         setGcalLoading]         = useState(false)
  const [sharedCalConnected,  setSharedCalConnected]  = useState(false)
  const [linkCode, setLinkCode] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)

  const fetchTelegramLink = useCallback(async () => {
    if (!user) return
    const supabase = createClient()
    const { data } = await supabase
      .from('telegram_links')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()
    setTelegramLink(data)
  }, [user])

  const generateLinkCode = async () => {
    if (!user) return
    setTelegramLoading(true)
    const supabase = createClient()
    const code = Math.random().toString(36).substring(2, 8).toUpperCase()

    // Delete any existing pending codes for this user
    await supabase
      .from('telegram_links')
      .delete()
      .eq('user_id', user.id)
      .eq('status', 'pending')

    // Create new pending link
    const { error } = await supabase.from('telegram_links').insert({
      user_id: user.id,
      link_code: code,
      status: 'pending',
      created_at: new Date().toISOString(),
    })

    if (!error) {
      setLinkCode(code)
      toast('success', 'Código generado. Escanea el QR o toca el enlace de Telegram.')
    } else {
      toast('error', 'Error generando código')
    }
    setTelegramLoading(false)
  }

  const unlinkTelegram = async () => {
    if (!user || !telegramLink) return
    setTelegramLoading(true)
    const supabase = createClient()
    await supabase
      .from('telegram_links')
      .update({ status: 'unlinked' })
      .eq('id', telegramLink.id)
    setTelegramLink(null)
    toast('success', 'Telegram desvinculado')
    setTelegramLoading(false)
  }

  const disconnectGcal = async () => {
    setGcalLoading(true)
    try {
      const res = await fetch('/api/google/disconnect', { method: 'POST' })
      if (res.ok) {
        setGcalConnected(false)
        toast('success', 'Google Calendar desvinculado')
      }
    } catch {
      toast('error', 'Error al desvincular')
    }
    setGcalLoading(false)
  }

  const copyCode = () => {
    if (!linkCode) return
    navigator.clipboard.writeText(`/start ${linkCode}`)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 2000)
  }

  useEffect(() => {
    if (user) {
      setProfile({
        full_name: user.full_name || '',
        nickname: (user as any).nickname || '',
        email: user.email || '',
        phone: user.phone || '',
      })
      fetchTelegramLink()

      // Check Google Calendar connection
      const supabase = createClient()
      supabase
        .from('users_profile')
        .select('google_refresh_token')
        .eq('id', user.id)
        .single()
        .then(({ data }) => setGcalConnected(!!data?.google_refresh_token))

      // Check shared calendar connection (admin only)
      if (isAdmin()) {
        fetch('/api/google/shared-status')
          .then(r => r.json())
          .then(d => setSharedCalConnected(!!d.connected))
          .catch(() => {})
      }

      // Show success/error toast if redirected back from Google OAuth
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        if (params.get('gcal') === 'connected') {
          setGcalConnected(true)
          toast('success', '¡Google Calendar personal conectado!')
          window.history.replaceState({}, '', window.location.pathname)
        } else if (params.get('gcal') === 'shared_connected') {
          setSharedCalConnected(true)
          toast('success', '✅ Calendario compartido "Voltis CRM" conectado. Las citas se sincronizarán automáticamente.')
          window.history.replaceState({}, '', window.location.pathname)
        } else if (params.get('gcal') === 'error') {
          toast('error', 'Error conectando Google Calendar. Inténtalo de nuevo.')
          window.history.replaceState({}, '', window.location.pathname)
        }
      }
    }

    const fetchTeam = async () => {
      const supabase = createClient()
      const [teamRes, invitationsRes] = await Promise.all([
        supabase
          .from('users_profile')
          .select('*')
          .order('full_name'),
        supabase
          .from('notifications')
          .select('*')
          .eq('type', 'invitation')
          .order('created_at', { ascending: false }),
      ])

      setTeamMembers(teamRes.data || [])
      setPendingInvitations(invitationsRes.data || [])
      setLoading(false)
    }

    if (isAdmin()) fetchTeam()
    else setLoading(false)
  }, [user])

  const handleSaveProfile = async () => {
    if (!user) return
    const supabase = createClient()
    await supabase
      .from('users_profile')
      .update({
        full_name: profile.full_name,
        nickname: profile.nickname || null,
        phone: profile.phone,
      })
      .eq('id', user.id)
    toast('success', 'Perfil actualizado')
  }

  const handleChangePassword = async () => {
    if (!passwordForm.current || !passwordForm.new || !passwordForm.confirm) {
      toast('error', 'Completa todos los campos')
      return
    }
    if (passwordForm.new !== passwordForm.confirm) {
      toast('error', 'Las contraseñas nuevas no coinciden')
      return
    }
    if (passwordForm.new.length < 8) {
      toast('error', 'La contraseña debe tener al menos 8 caracteres')
      return
    }
    setPasswordLoading(true)
    try {
      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user!.email!,
        password: passwordForm.current,
      })
      if (signInError) {
        toast('error', 'La contraseña actual es incorrecta')
        return
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: passwordForm.new })
      if (updateError) throw updateError
      toast('success', 'Contraseña actualizada correctamente')
      setPasswordForm({ current: '', new: '', confirm: '' })
    } catch (err: any) {
      toast('error', err.message || 'Error al cambiar la contraseña')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleSendInvitation = async () => {
    if (!inviteForm.email || !inviteForm.full_name) {
      toast('error', 'Por favor completa email y nombre')
      return
    }

    setInvitationLoading(true)

    try {
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteForm.email,
          full_name: inviteForm.full_name,
          nickname: inviteForm.nickname || null,
          role: inviteForm.role,
          permissions: inviteForm.permissions,
          ...(inviteForm.password ? { password: inviteForm.password } : {}),
        }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al crear el acceso')

      toast('success', inviteForm.password
        ? `Acceso creado para ${inviteForm.email}. Ya puede entrar con esa contraseña.`
        : `Invitación enviada a ${inviteForm.email}`)
      setInviteForm({
        email: '',
        full_name: '',
        nickname: '',
        password: '',
        role: 'commercial',
        permissions: { ...DEFAULT_PERMISSIONS },
      })

      // Refetch team list to show the pre-created profile row
      const supabase = createClient()
      const { data } = await supabase
        .from('users_profile')
        .select('*')
        .order('full_name')
      setTeamMembers(data || [])
    } catch (err: any) {
      toast('error', err.message || 'Error al enviar invitación')
    } finally {
      setInvitationLoading(false)
    }
  }

  const handleResendInvitation = async (_invitationId: string, metadata: any) => {
    // Re-send by hitting the invite API again (Supabase will resend the email)
    try {
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: metadata.email,
          full_name: metadata.full_name,
          role: metadata.role || 'commercial',
          permissions: metadata.permissions || {},
        }),
      })
      // 409 = already active account, that's fine for a resend
      if (res.ok || res.status === 409) {
        toast('success', `Invitación reenviada a ${metadata.email}`)
      } else {
        const result = await res.json()
        toast('error', result.error || 'Error al reenviar')
      }
    } catch {
      toast('error', 'Error al reenviar invitación')
    }
  }

  const startEditingPermissions = (userId: string, currentRole: string, currentPermissions: Record<string, boolean>) => {
    setEditingUserId(userId)
    setEditingRole(currentRole)
    // Merge with defaults so all permission keys are always present
    setEditingPermissions({ ...DEFAULT_PERMISSIONS, ...(currentPermissions || {}) })
  }

  const handleSavePermissions = async (userId: string) => {
    const supabase = createClient()

    try {
      const { error } = await supabase
        .from('users_profile')
        .update({
          role: editingRole,
          permissions: editingPermissions,
        })
        .eq('id', userId)

      if (error) throw error

      toast('success', 'Permisos actualizados')
      setEditingUserId(null)

      // Refetch team
      const { data } = await supabase
        .from('users_profile')
        .select('*')
        .order('full_name')
      setTeamMembers(data || [])
    } catch (error) {
      toast('error', 'Error al actualizar permisos')
    }
  }

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!confirm(`¿Eliminar el acceso de ${userName}? Esta acción no se puede deshacer.`)) return
    try {
      const res = await fetch('/api/invite-user', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      toast('success', `Acceso de ${userName} eliminado`)
      setTeamMembers(prev => prev.filter(m => m.id !== userId))
    } catch (err: any) {
      toast('error', err.message || 'Error al eliminar usuario')
    }
  }

  const handleResetPassword = async (userId: string, userEmail: string, userName: string) => {
    const newPass = prompt(`Nueva contraseña para ${userName} (mínimo 8 caracteres).\nDeja en blanco para enviar email de recuperación a ${userEmail}:`)
    if (newPass === null) return // cancelled
    try {
      const body = newPass.trim()
        ? { userId, newPassword: newPass.trim() }
        : { email: userEmail }
      if (body.newPassword && body.newPassword.length < 8) {
        toast('error', 'La contraseña debe tener al menos 8 caracteres')
        return
      }
      const res = await fetch('/api/invite-user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      if (result.mode === 'email_sent') {
        toast('success', `Email de recuperación enviado a ${userEmail}`)
      } else {
        toast('success', `Contraseña de ${userName} actualizada`)
      }
    } catch (err: any) {
      toast('error', err.message || 'Error al restablecer contraseña')
    }
  }

  const handleCancelInvitation = async (invitationId: string) => {
    if (!confirm('¿Cancelar esta invitación?')) return
    try {
      const supabase = createClient()
      await supabase.from('notifications').delete().eq('id', invitationId)
      setPendingInvitations(prev => prev.filter(i => i.id !== invitationId))
      toast('success', 'Invitación cancelada')
    } catch {
      toast('error', 'Error al cancelar la invitación')
    }
  }

  const handleTestGemini = async () => {
    setGeminiLoading(true)
    setGeminiStatus(null)
    try {
      const res = await fetch('/api/gemini/status')
      const data = await res.json()
      setGeminiStatus(data)
    } catch {
      setGeminiStatus({ ok: false, error: 'No se pudo conectar con el servidor' })
    } finally {
      setGeminiLoading(false)
    }
  }

  const handleReextract = async () => {
    if (!reextractName.trim()) return
    setReextractLoading(true)
    setReextractResult(null)
    try {
      const res = await fetch('/api/admin/reextract-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: reextractName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast('error', data.error || 'Error desconocido')
      } else {
        setReextractResult(data)
        toast(
          data.errors === 0 ? 'success' : 'warning',
          `${data.ok}/${data.total} facturas re-extraídas.${data.errors > 0 ? ` ${data.errors} errores.` : ''}`,
        )
      }
    } catch {
      toast('error', 'No se pudo conectar con el servidor')
    } finally {
      setReextractLoading(false)
    }
  }

  // Helper: display name for a team member (nickname > full_name > email)
  const displayName = (item: any) => item.nickname || item.full_name || item.email

  const teamColumns = [
    {
      key: 'full_name',
      header: 'Nombre',
      render: (item: any) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center">
            <span className="text-white text-xs font-bold">{(item.nickname || item.full_name || item.email || '?').charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <p className="text-sm font-medium text-ink">{item.full_name || item.email}</p>
            {item.nickname && (
              <p className="text-xs text-brand font-medium">@{item.nickname}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      render: (item: any) => <span className="text-sm text-ink-3">{item.email}</span>,
    },
    {
      key: 'role',
      header: 'Rol',
      render: (item: any) => {
        if (editingUserId === item.id) {
          return (
            <Select
              value={editingRole}
              onChange={(e) => setEditingRole(e.target.value)}
              options={[
                { value: 'admin', label: 'Administrador' },
                { value: 'commercial', label: 'Comercial' },
              ]}
            />
          )
        }
        return (
          <Badge variant={item.role === 'admin' ? 'success' : 'default'}>
            {item.role === 'admin' ? 'Admin' : 'Comercial'}
          </Badge>
        )
      },
    },
    {
      key: 'active',
      header: 'Estado',
      render: (item: any) => (
        item.active
          ? <Badge variant="success">Activo</Badge>
          : <Badge variant="warning">Invitado</Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (item: any) => {
        if (editingUserId === item.id) {
          return (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => handleSavePermissions(item.id)}>
                Guardar
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditingUserId(null)}>
                Cancelar
              </Button>
            </div>
          )
        }
        return (
          <div className="flex items-center gap-2">
            {!item.active && (
              <Button
                size="sm"
                variant="ghost"
                title="Reenviar invitación"
                onClick={() => handleResendInvitation(item.id, { email: item.email, full_name: item.full_name, role: item.role, permissions: item.permissions })}
              >
                <RotateCw className="w-4 h-4" />
              </Button>
            )}
            <Button
              size="sm"
              variant="tertiary"
              onClick={() => startEditingPermissions(item.id, item.role, item.permissions || {})}
            >
              <Edit2 className="w-4 h-4" />
              Editar permisos
            </Button>
          </div>
        )
      },
    },
  ]

  const invitationColumns = [
    {
      key: 'metadata.full_name',
      header: 'Nombre',
      render: (item: any) => (
        <span className="text-sm font-medium text-ink">{item.metadata?.full_name}</span>
      ),
    },
    {
      key: 'metadata.email',
      header: 'Email',
      render: (item: any) => <span className="text-sm text-ink-3">{item.metadata?.email}</span>,
    },
    {
      key: 'metadata.role',
      header: 'Rol',
      render: (item: any) => (
        <Badge variant={item.metadata?.role === 'admin' ? 'success' : 'default'}>
          {item.metadata?.role === 'admin' ? 'Admin' : 'Comercial'}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Enviada',
      render: (item: any) => (
        <span className="text-xs text-ink-3">
          {new Date(item.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (item: any) => (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleResendInvitation(item.id, item.metadata)}
          >
            <RotateCw className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => handleCancelInvitation(item.id)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <Header title="Configuración" subtitle="Perfil y gestión del equipo" />

      <div className="px-6 lg:px-8 pb-8 space-y-6">
        {/* Profile */}
        <Card>
          <h3 className="font-sans font-semibold text-base text-ink mb-4">Mi perfil</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Input
              label="Nombre completo"
              value={profile.full_name}
              onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
            />
            <Input
              label="Apodo / Alias"
              value={profile.nickname}
              onChange={(e) => setProfile({ ...profile, nickname: e.target.value })}
              placeholder="Ej: Jokin, Alex..."
              hint="Aparece en tarjetas de clientes y equipo"
            />
            <Input
              label="Email"
              value={profile.email}
              disabled
              hint="El email no se puede cambiar"
            />
            <Input
              label="Teléfono"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            />
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <p className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <Lock className="w-4 h-4 text-ink-3" />
              Cambiar contraseña
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Contraseña actual"
                type="password"
                value={passwordForm.current}
                onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
              />
              <Input
                label="Nueva contraseña"
                type="password"
                value={passwordForm.new}
                onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })}
                placeholder="Mínimo 8 caracteres"
              />
              <Input
                label="Confirmar nueva contraseña"
                type="password"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
              />
            </div>
          </div>

          <div className="mt-4 flex justify-between items-center">
            <Button
              variant="secondary"
              onClick={handleChangePassword}
              loading={passwordLoading}
              disabled={!passwordForm.current || !passwordForm.new || !passwordForm.confirm}
            >
              <Lock className="w-4 h-4" />
              Cambiar contraseña
            </Button>
            <Button onClick={handleSaveProfile}>
              <Save className="w-4 h-4" />
              Guardar perfil
            </Button>
          </div>
        </Card>

        {/* Telegram Bot */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-info-container/40 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-info" />
            </div>
            <div>
              <h3 className="font-sans font-semibold text-base text-ink">Telegram Bot</h3>
              <p className="text-xs text-ink-3">Recibe notificaciones y envía facturas desde Telegram</p>
            </div>
          </div>

          {telegramLink ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-ok-container/40 rounded-xl">
                <CheckCircle className="w-5 h-5 text-ok" />
                <div>
                  <p className="text-sm font-medium text-ok">Vinculado</p>
                  <p className="text-xs text-ok">
                    Chat ID: {telegramLink.telegram_chat_id} · Desde {new Date(telegramLink.linked_at).toLocaleDateString('es-ES')}
                  </p>
                </div>
              </div>
              <button
                onClick={unlinkTelegram}
                disabled={telegramLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm text-err hover:bg-err-container/40 rounded-lg transition-colors"
              >
                <Unlink className="w-4 h-4" />
                Desvincular Telegram
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-3">
                Vincula tu cuenta de Telegram para recibir notificaciones push y enviar facturas directamente al CRM.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button onClick={generateLinkCode} disabled={telegramLoading}>
                  <Link2 className="w-4 h-4" />
                  Generar codigo de vinculacion
                </Button>
              </div>
              {linkCode && (
                <div className="p-4 bg-info-container/40 rounded-xl space-y-4">
                  <p className="text-sm font-medium text-info">Escanea el QR con tu móvil para vincular Telegram al instante:</p>
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    {/* QR code — uses tg:// protocol to avoid Android stripping ?start= param */}
                    <div className="flex-shrink-0 p-2 bg-white rounded-xl shadow-sm">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(`tg://resolve?domain=VOLTISCRM_bot&start=${linkCode}`)}&size=160x160&margin=4`}
                        alt="QR Telegram"
                        width={160}
                        height={160}
                        className="rounded-lg"
                      />
                    </div>
                    <div className="flex-1 space-y-3 text-center sm:text-left">
                      <p className="text-sm text-info">
                        Escanea el QR con la <b>cámara del móvil</b> → Telegram se abrirá con el código listo → pulsa <b>Iniciar</b>.
                      </p>
                      <a
                        href={`https://t.me/VOLTISCRM_bot?start=${linkCode}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#229ED9] text-white rounded-xl text-sm font-semibold hover:bg-[#1a8bbf] transition-all"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.247-2.02 9.52c-.148.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.16 14.4l-2.96-.924c-.643-.204-.656-.643.136-.953l11.57-4.463c.537-.194 1.006.131.656 2.187z"/>
                        </svg>
                        Pulsa aquí desde el móvil
                      </a>
                      <p className="text-xs text-info/70">
                        O escribe en @VOLTISCRM_bot: <code className="bg-white/60 px-1 py-0.5 rounded font-mono">/vincular {linkCode}</code>
                        <button
                          onClick={copyCode}
                          className="ml-2 p-1 bg-white/60 rounded hover:bg-white transition-colors inline-flex"
                          title="Copiar código"
                        >
                          {codeCopied ? <Check className="w-3 h-3 text-ok" /> : <Copy className="w-3 h-3 text-info" />}
                        </button>
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Calendario Compartido — solo admin */}
        {isAdmin() && (
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center">
                <CalendarDays className="w-5 h-5 text-brand" />
              </div>
              <div>
                <h3 className="font-sans font-semibold text-base text-ink">Calendario Compartido del Equipo</h3>
                <p className="text-xs text-ink-3">Las citas del CRM aparecen en el calendario "Voltis CRM" compartido con todo el equipo</p>
              </div>
            </div>

            {sharedCalConnected ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 bg-ok-container/40 rounded-xl">
                  <CheckCircle className="w-5 h-5 text-ok" />
                  <div>
                    <p className="text-sm font-medium text-ok">Calendario compartido conectado</p>
                    <p className="text-xs text-ok/80">Las citas se publican automáticamente en "Voltis CRM"</p>
                  </div>
                </div>
                <div className="p-3 bg-bg-2 rounded-xl space-y-1.5 text-xs text-ink-3">
                  <p>📅 <b>Presentaciones, firmas, seguimientos</b> → aparecen para todo el equipo</p>
                  <p>🌐 <b>Citas grupo</b> → destacadas en rojo, visibles para todos</p>
                  <p>👤 <b>Creador visible</b> → el título incluye quién creó la cita</p>
                </div>
                <a
                  href="/api/google/auth-shared"
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm text-ink-3 hover:bg-line/60 rounded-lg transition-colors"
                >
                  <CalendarDays className="w-4 h-4" />
                  Reconectar
                </a>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink-3">
                  Autoriza el CRM para publicar las citas en el calendario compartido del equipo. Solo necesitas hacerlo una vez.
                </p>
                <div className="p-3 bg-bg-2 rounded-xl space-y-1.5 text-xs text-ink-3">
                  <p>📅 <b>Todas las citas</b> → visibles para todo el equipo en Google Calendar</p>
                  <p>🌐 <b>Citas grupo</b> → destacadas en rojo con los asistentes</p>
                  <p>🔄 <b>Automático</b> → se actualiza al crear, editar o cancelar una cita</p>
                </div>
                <a
                  href="/api/google/auth-shared"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand text-white rounded-xl text-sm font-semibold hover:bg-brand/90 transition-all"
                >
                  <CalendarDays className="w-4 h-4" />
                  Conectar Calendario Compartido
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>
              </div>
            )}
          </Card>
        )}

        {/* Google Calendar Personal */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <CalendarDays className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h3 className="font-sans font-semibold text-base text-ink">Mi Google Calendar</h3>
              <p className="text-xs text-ink-3">Recibe tus tareas pendientes del día en tu calendario personal</p>
            </div>
          </div>

          {gcalConnected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-ok-container/40 rounded-xl">
                <CheckCircle className="w-5 h-5 text-ok" />
                <div>
                  <p className="text-sm font-medium text-ok">Conectado</p>
                  <p className="text-xs text-ok/80">Tus tareas del día aparecen a las 8:00am en tu calendario</p>
                </div>
              </div>
              <div className="p-3 bg-bg-2 rounded-xl space-y-1.5 text-xs text-ink-3">
                <p>📋 <b>Tareas pendientes</b> → evento diario a las 8:00am con tu lista del día</p>
                <p>📌 <b>Tareas con fecha</b> → aparecen el día que toca</p>
              </div>
              <button
                onClick={disconnectGcal}
                disabled={gcalLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm text-err hover:bg-err-container/40 rounded-lg transition-colors"
              >
                <Unlink className="w-4 h-4" />
                Desvincular mi Google Calendar
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-3">
                Conecta tu cuenta de Google para recibir tus tareas del CRM directamente en tu Google Calendar personal.
              </p>
              <div className="p-3 bg-bg-2 rounded-xl space-y-1.5 text-xs text-ink-3">
                <p>📋 <b>Tareas</b> → evento diario a las 8:00am con todas tus tareas pendientes</p>
                <p>🔄 <b>Automático</b> → se actualiza solo, incluso desde el bot de Telegram</p>
              </div>
              <a
                href="/api/google/auth"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand text-white rounded-xl text-sm font-semibold hover:bg-brand/90 transition-all"
              >
                <CalendarDays className="w-4 h-4" />
                Conectar mi Google Calendar
                <ExternalLink className="w-3 h-3 opacity-70" />
              </a>
            </div>
          )}
        </Card>

        {/* Invite User Form (admin only) */}
        {isAdmin() && (
          <Card>
            <h3 className="font-sans font-semibold text-base text-ink mb-1 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-brand" />
              Crear acceso para compañero
            </h3>
            <p className="text-sm text-ink-3 mb-4">
              Crea un usuario con nombre y contraseña. Tú decides a qué secciones del sidebar puede acceder.
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label="Nombre completo"
                  value={inviteForm.full_name}
                  onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })}
                  placeholder="Ana García"
                />
                <Input
                  label="Apodo / Alias"
                  value={inviteForm.nickname}
                  onChange={(e) => setInviteForm({ ...inviteForm, nickname: e.target.value })}
                  placeholder="Ana, Anita..."
                  hint="Se muestra en tarjetas de clientes"
                />
                <Input
                  label="Email (usuario)"
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  placeholder="ana@tuempresa.com"
                />
              </div>

              <Input
                label="Contraseña"
                type="password"
                value={inviteForm.password}
                onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
                placeholder="Mínimo 8 caracteres"
                hint="Si dejas este campo vacío, se enviará un email de invitación para que el usuario establezca su propia contraseña."
              />

              {/* Role selector */}
              <div>
                <p className="text-sm font-medium text-ink mb-2">Rol</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setInviteForm({ ...inviteForm, role: 'admin' })}
                    className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                      inviteForm.role === 'admin'
                        ? 'border-brand bg-brand/5 text-brand'
                        : 'border-line text-ink-3 hover:border-brand/40'
                    }`}
                  >
                    <Shield className="w-5 h-5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">Administrador</p>
                      <p className="text-xs opacity-70">Acceso a todos los clientes y secciones</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteForm({ ...inviteForm, role: 'commercial' })}
                    className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                      inviteForm.role === 'commercial'
                        ? 'border-brand bg-brand/5 text-brand'
                        : 'border-line text-ink-3 hover:border-brand/40'
                    }`}
                  >
                    <Users className="w-5 h-5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">Comercial</p>
                      <p className="text-xs opacity-70">Solo ve sus propios clientes asignados</p>
                    </div>
                  </button>
                </div>
              </div>

              {inviteForm.role === 'commercial' && (
                <div className="p-4 bg-bg-2 rounded-xl space-y-4">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-brand" />
                    <p className="text-sm font-semibold text-ink">Accesos al sidebar</p>
                  </div>
                  {PERMISSION_GROUPS.map((group) => (
                    <div key={group.label}>
                      <p className="text-xs font-medium text-ink-3 uppercase tracking-wider mb-2">{group.label}</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {group.items.map(({ key, label }) => (
                          <label key={key} className="flex items-center gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-line/40 transition-colors">
                            <input
                              type="checkbox"
                              checked={(inviteForm.permissions as any)[key] || false}
                              onChange={(e) =>
                                setInviteForm({
                                  ...inviteForm,
                                  permissions: { ...inviteForm.permissions, [key]: e.target.checked },
                                })
                              }
                              className="w-4 h-4 rounded accent-primary cursor-pointer flex-shrink-0"
                            />
                            <span className="text-sm text-ink">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={handleSendInvitation} loading={invitationLoading}>
                  <UserPlus className="w-4 h-4" />
                  {inviteForm.password ? 'Crear acceso' : 'Enviar invitación'}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Pending invitations are shown inline in the team table as "Invitado" status */}

        {/* Integrations (admin only) */}
        {isAdmin() && (
          <Card>
            <h3 className="font-sans font-semibold text-base text-ink mb-4 flex items-center gap-2">
              <Key className="w-5 h-5 text-brand" />
              Integraciones API
            </h3>
            <p className="text-sm text-ink-3 mb-4">
              Configura las claves API para activar DocuSign (firma digital) y GoCardless (domiciliacion SEPA).
              Estas claves se configuran como variables de entorno en Vercel.
            </p>

            <div className="space-y-4">
              {/* Gemini AI */}
              <div className="p-4 bg-bg-2 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-ink">Gemini AI</span>
                    <Badge variant="info">Extractor de facturas</Badge>
                  </div>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand flex items-center gap-1 hover:underline"
                  >
                    Gestionar clave <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="text-xs text-ink-3 space-y-1">
                  <p><code className="bg-white px-1.5 py-0.5 rounded">GEMINI_API_KEY</code> — Clave de Google AI Studio (gratuita)</p>
                  <p className="text-ink-3/80">Si la clave caduca o se agota la cuota mensual, el extractor de facturas deja de funcionar. Renuévala en aistudio.google.com y actualízala en Vercel → Settings → Environment Variables.</p>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={handleTestGemini}
                    disabled={geminiLoading}
                    className="flex items-center gap-1.5 text-xs bg-white border border-border px-3 py-1.5 rounded-lg hover:bg-bg-2 transition-colors disabled:opacity-50"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${geminiLoading ? 'animate-spin' : ''}`} />
                    {geminiLoading ? 'Probando…' : 'Probar clave'}
                  </button>
                  {geminiStatus && (
                    <div className={`flex items-center gap-1.5 text-xs ${geminiStatus.ok ? 'text-green-700' : 'text-red-600'}`}>
                      {geminiStatus.ok
                        ? <><CheckCircle className="w-3.5 h-3.5" /> Activa — modelo: {geminiStatus.model}</>
                        : <><AlertCircle className="w-3.5 h-3.5" /> {geminiStatus.error}</>
                      }
                    </div>
                  )}
                </div>
              </div>

              {/* DocuSign */}
              <div className="p-4 bg-bg-2 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-ink">DocuSign</span>
                    <Badge variant="info">Firma digital</Badge>
                  </div>
                  <a
                    href="https://developers.docusign.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand flex items-center gap-1 hover:underline"
                  >
                    Documentacion <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="text-xs text-ink-3 space-y-1">
                  <p><code className="bg-bg-2 px-1.5 py-0.5 rounded">DOCUSIGN_ACCESS_TOKEN</code> — OAuth access token</p>
                  <p><code className="bg-bg-2 px-1.5 py-0.5 rounded">DOCUSIGN_ACCOUNT_ID</code> — Account ID</p>
                  <p><code className="bg-bg-2 px-1.5 py-0.5 rounded">DOCUSIGN_BASE_URL</code> — API base URL (demo o produccion)</p>
                  <p><code className="bg-bg-2 px-1.5 py-0.5 rounded">DOCUSIGN_TEMPLATE_ID</code> — Template ID (opcional, genera HTML si no existe)</p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <AlertCircle className="w-3.5 h-3.5 text-warn" />
                    <span className="text-ink-3">
                      Webhook URL: <code className="bg-bg-2 px-1.5 py-0.5 rounded">/api/docusign/webhook</code>
                    </span>
                  </div>
                </div>
              </div>

              {/* GoCardless */}
              <div className="p-4 bg-bg-2 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-ink">GoCardless</span>
                    <Badge variant="success">Domiciliacion SEPA</Badge>
                  </div>
                  <a
                    href="https://developer.gocardless.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand flex items-center gap-1 hover:underline"
                  >
                    Documentacion <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="text-xs text-ink-3 space-y-1">
                  <p><code className="bg-bg-2 px-1.5 py-0.5 rounded">GOCARDLESS_ACCESS_TOKEN</code> — API access token</p>
                  <p><code className="bg-bg-2 px-1.5 py-0.5 rounded">GOCARDLESS_ENVIRONMENT</code> — &apos;sandbox&apos; o &apos;live&apos;</p>
                  <p><code className="bg-bg-2 px-1.5 py-0.5 rounded">GOCARDLESS_WEBHOOK_SECRET</code> — Para verificar webhooks</p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <AlertCircle className="w-3.5 h-3.5 text-warn" />
                    <span className="text-ink-3">
                      Webhook URL: <code className="bg-bg-2 px-1.5 py-0.5 rounded">/api/gocardless/webhook</code>
                    </span>
                  </div>
                </div>
              </div>

              {/* General */}
              <div className="p-4 bg-bg-2 rounded-xl space-y-3">
                <span className="font-semibold text-sm text-ink">General</span>
                <div className="text-xs text-ink-3 space-y-1">
                  <p><code className="bg-bg-2 px-1.5 py-0.5 rounded">NEXT_PUBLIC_APP_URL</code> — URL de la app (para webhooks)</p>
                  <p><code className="bg-bg-2 px-1.5 py-0.5 rounded">SUPABASE_SERVICE_ROLE_KEY</code> — Service role key (para webhooks server-side)</p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Admin tools — re-extract invoices */}
        {isAdmin() && (
          <Card>
            <h3 className="font-sans font-semibold text-base text-ink mb-1 flex items-center gap-2">
              <RotateCw className="w-5 h-5 text-brand" />
              Herramientas de administración
            </h3>
            <p className="text-xs text-ink-3 mb-4">
              Re-extrae todas las facturas de un cliente con el prompt de Gemini actualizado. Útil para corregir datos mal extraídos con versiones anteriores del extractor.
            </p>
            <div className="p-4 bg-bg-2 rounded-xl space-y-3">
              <span className="font-semibold text-sm text-ink block">Re-extraer facturas de un cliente</span>
              <div className="flex items-center gap-2">
                <Input
                  value={reextractName}
                  onChange={(e) => setReextractName(e.target.value)}
                  placeholder="Nombre del cliente (ej: SALEH AL SHAKRAN)"
                  className="flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && !reextractLoading && handleReextract()}
                />
                <Button
                  onClick={handleReextract}
                  disabled={reextractLoading || !reextractName.trim()}
                  size="sm"
                >
                  {reextractLoading ? <RotateCw className="w-4 h-4 animate-spin" /> : 'Re-extraer'}
                </Button>
              </div>
              {reextractResult && (
                <div className="text-xs space-y-1">
                  <p className={reextractResult.errors === 0 ? 'text-green-700' : 'text-warn'}>
                    {reextractResult.ok}/{reextractResult.total} facturas re-extraídas correctamente
                    {reextractResult.errors > 0 && ` · ${reextractResult.errors} errores`}
                  </p>
                  {reextractResult.results?.filter(r => r.status === 'error').map((r, i) => (
                    <p key={i} className="text-red-600">✗ {r.id}: {r.error}</p>
                  ))}
                </div>
              )}
            </div>

            {/* Base de conocimiento del extractor */}
            <div className="p-4 bg-bg-2 rounded-xl space-y-3 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-sm text-ink block">Base de conocimiento del extractor</span>
                  <span className="text-xs text-ink-3">Formatos de factura por comercializadora · Sistema de aprendizaje automático</span>
                </div>
                <a
                  href="/settings/formatos-factura"
                  className="flex items-center gap-1.5 text-xs bg-white border border-border px-3 py-1.5 rounded-lg hover:bg-bg-2 transition-colors text-ink"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Gestionar formatos
                </a>
              </div>
            </div>
          </Card>
        )}

        {/* Team management (admin only) */}
        {isAdmin() && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-sans font-semibold text-lg text-ink">Miembros del equipo</h2>
            </div>
            <Card>
              <div className="space-y-4">
                {teamMembers.map((member) => (
                  <div key={member.id}>
                    {editingUserId === member.id ? (
                      <div className="p-4 bg-bg-2 rounded-xl space-y-4">
                        <div className="space-y-2 pb-4 border-b border-surface-container-highest">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-ink">{member.full_name}</p>
                              <p className="text-xs text-ink-3">{member.email}</p>
                            </div>
                            <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center">
                              <span className="text-white text-xs font-bold">
                                {getUserInitials(member.full_name || member.email)?.charAt(0)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="text-sm font-medium text-ink block mb-2">Rol</label>
                          <Select
                            value={editingRole}
                            onChange={(e) => {
                              const newRole = e.target.value
                              setEditingRole(newRole)
                              // Admin always has billing access; commercial starts without it
                              if (newRole === 'admin') {
                                setEditingPermissions(prev => ({ ...prev, billing: true }))
                              } else {
                                setEditingPermissions(prev => ({ ...prev, billing: false }))
                              }
                            }}
                            options={[
                              { value: 'admin', label: 'Administrador — ve todos los clientes' },
                              { value: 'commercial', label: 'Comercial — ve solo sus clientes' },
                            ]}
                          />
                          {editingRole === 'admin' && (
                            <p className="text-xs text-ink-3 mt-1">Los administradores ven todos los clientes, suministros y datos de todos los comerciales.</p>
                          )}
                        </div>

                        {editingRole === 'commercial' && (
                          <div className="space-y-4 p-3 bg-bg-2 rounded-lg">
                            <div className="flex items-center gap-2">
                              <Shield className="w-4 h-4 text-brand" />
                              <p className="text-sm font-semibold text-ink">Accesos al sidebar</p>
                            </div>
                            {PERMISSION_GROUPS.map((group) => (
                              <div key={group.label}>
                                <p className="text-xs font-medium text-ink-3 uppercase tracking-wider mb-2">{group.label}</p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {group.items.map(({ key, label }) => (
                                    <label key={key} className="flex items-center gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-line/40 transition-colors">
                                      <input
                                        type="checkbox"
                                        checked={editingPermissions[key] || false}
                                        onChange={(e) =>
                                          setEditingPermissions({
                                            ...editingPermissions,
                                            [key]: e.target.checked,
                                          })
                                        }
                                        className="w-4 h-4 rounded accent-primary cursor-pointer flex-shrink-0"
                                      />
                                      <span className="text-sm text-ink">{label}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2 justify-end pt-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditingUserId(null)}
                          >
                            Cancelar
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleSavePermissions(member.id)}
                          >
                            <Save className="w-4 h-4" />
                            Guardar cambios
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 hover:bg-bg-2 transition-colors rounded-lg flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-sm font-bold">
                              {getUserInitials(member.full_name || member.email)?.charAt(0)}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-ink">{member.full_name}</p>
                            <p className="text-xs text-ink-3">{member.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Badge variant={member.role === 'admin' ? 'success' : 'default'}>
                              {member.role === 'admin' ? 'Admin' : 'Comercial'}
                            </Badge>
                            <Badge variant={member.active ? 'success' : 'error'}>
                              {member.active ? 'Activo' : 'Inactivo'}
                            </Badge>
                          </div>
                          <Button
                            size="sm"
                            variant="tertiary"
                            onClick={() => startEditingPermissions(member.id, member.role, member.permissions || {})}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="tertiary"
                            onClick={() => handleResetPassword(member.id, member.email, member.full_name || member.email)}
                            title="Restablecer contraseña"
                            className="text-ink-3 hover:text-brand"
                          >
                            <Key className="w-4 h-4" />
                          </Button>
                          {member.id !== user?.id && (
                            <Button
                              size="sm"
                              variant="tertiary"
                              onClick={() => handleDeleteUser(member.id, member.full_name || member.email)}
                              className="text-err hover:bg-err-container/30"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {teamMembers.length === 0 && (
                  <p className="text-sm text-ink-3 py-8 text-center">
                    No hay miembros del equipo
                  </p>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
