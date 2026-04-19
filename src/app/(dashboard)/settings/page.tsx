'use client'

import { useEffect, useState, useCallback } from 'react'
import { Save, UserPlus, Shield, Users, Key, ExternalLink, CheckCircle, AlertCircle, Trash2, RotateCw, Lock, Edit2, MessageCircle, Link2, Unlink, Copy, Check } from 'lucide-react'
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
  const [profile, setProfile] = useState({
    full_name: '',
    email: '',
    phone: '',
  })
  const [inviteForm, setInviteForm] = useState({
    email: '',
    full_name: '',
    role: 'commercial',
    permissions: {
      prescorings: false,
      billing: false,
      reports: false,
    },
  })

  // ── Telegram bot state ──
  const [telegramLink, setTelegramLink] = useState<any>(null)
  const [telegramLoading, setTelegramLoading] = useState(false)
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
      toast('success', 'Código generado. Envíalo al bot de Telegram.')
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
        email: user.email || '',
        phone: user.phone || '',
      })
      fetchTelegramLink()
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
        phone: profile.phone,
      })
      .eq('id', user.id)
    toast('success', 'Perfil actualizado')
  }

  const handleSendInvitation = async () => {
    if (!inviteForm.email || !inviteForm.full_name) {
      toast('error', 'Por favor completa email y nombre')
      return
    }

    setInvitationLoading(true)
    const supabase = createClient()

    try {
      const { error } = await supabase
        .from('notifications')
        .insert({
          type: 'invitation',
          user_id: user!.id,
          title: `Invitación para ${inviteForm.full_name}`,
          message: `Invitación enviada a ${inviteForm.email}`,
          metadata: {
            email: inviteForm.email,
            full_name: inviteForm.full_name,
            role: inviteForm.role,
            permissions: inviteForm.permissions,
          },
        })

      if (error) throw error

      toast('success', `Invitación enviada a ${inviteForm.email}`)
      setInviteForm({
        email: '',
        full_name: '',
        role: 'commercial',
        permissions: {
          prescorings: false,
          billing: false,
          reports: false,
        },
      })

      // Refetch invitations
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('type', 'invitation')
        .order('created_at', { ascending: false })
      setPendingInvitations(data || [])
    } catch (error) {
      toast('error', 'Error al enviar invitación')
    } finally {
      setInvitationLoading(false)
    }
  }

  const handleCancelInvitation = async (invitationId: string) => {
    const supabase = createClient()

    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', invitationId)

      if (error) throw error

      toast('success', 'Invitación cancelada')
      setPendingInvitations((prev) => prev.filter((i) => i.id !== invitationId))
    } catch (error) {
      toast('error', 'Error al cancelar invitación')
    }
  }

  const handleResendInvitation = async (invitationId: string, metadata: any) => {
    toast('success', `Invitación reenviada a ${metadata.email}`)
  }

  const startEditingPermissions = (userId: string, currentRole: string, currentPermissions: Record<string, boolean>) => {
    setEditingUserId(userId)
    setEditingRole(currentRole)
    setEditingPermissions(currentPermissions || {})
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

  const teamColumns = [
    {
      key: 'full_name',
      header: 'Nombre',
      render: (item: any) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center">
            <span className="text-white text-xs font-bold">{getUserInitials(item.full_name || item.email)?.charAt(0)}</span>
          </div>
          <span className="text-sm font-medium text-ink">{getUserInitials(item.full_name || item.email)}</span>
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
        <Badge variant={item.active ? 'success' : 'error'}>
          {item.active ? 'Activo' : 'Inactivo'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (item: any) => {
        if (editingUserId === item.id) {
          return (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => handleSavePermissions(item.id)}
              >
                Guardar
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEditingUserId(null)}
              >
                Cancelar
              </Button>
            </div>
          )
        }
        return (
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => startEditingPermissions(item.id, item.role, item.permissions || {})}
          >
            <Edit2 className="w-4 h-4" />
            Editar permisos
          </Button>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Nombre completo"
              value={profile.full_name}
              onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
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
          <div className="mt-4 flex justify-end">
            <Button onClick={handleSaveProfile}>
              <Save className="w-4 h-4" />
              Guardar
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
                <div className="p-4 bg-info-container/40 rounded-xl space-y-2">
                  <p className="text-sm font-medium text-info">Tu codigo de vinculacion:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-white rounded-lg text-lg font-mono font-bold text-info text-center">
                      {linkCode}
                    </code>
                    <button
                      onClick={copyCode}
                      className="p-2 bg-white rounded-lg hover:bg-info-container transition-colors"
                      title="Copiar comando"
                    >
                      {codeCopied ? <Check className="w-4 h-4 text-ok" /> : <Copy className="w-4 h-4 text-info" />}
                    </button>
                  </div>
                  <p className="text-xs text-info">
                    Abre <b>@VoltisBot</b> en Telegram y envía:<br />
                    <code>/start {linkCode}</code>
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Invite User Form (admin only) */}
        {isAdmin() && (
          <Card>
            <h3 className="font-sans font-semibold text-base text-ink mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-brand" />
              Invitar usuario
            </h3>
            <p className="text-sm text-ink-3 mb-4">
              Envía una invitación a un nuevo miembro del equipo. Establece su rol y permisos.
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Email"
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  placeholder="usuario@example.com"
                />
                <Input
                  label="Nombre completo"
                  value={inviteForm.full_name}
                  onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })}
                  placeholder="Juan Pérez"
                />
              </div>

              <Select
                label="Rol"
                value={inviteForm.role}
                onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                options={[
                  { value: 'admin', label: 'Administrador' },
                  { value: 'commercial', label: 'Comercial' },
                ]}
              />

              {inviteForm.role === 'commercial' && (
                <div className="p-4 bg-bg-2 rounded-xl space-y-3">
                  <p className="text-sm font-medium text-ink">Permisos</p>
                  <div className="space-y-2">
                    {['prescorings', 'billing', 'reports'].map((permission) => (
                      <label key={permission} className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={inviteForm.permissions[permission as keyof typeof inviteForm.permissions] || false}
                          onChange={(e) =>
                            setInviteForm({
                              ...inviteForm,
                              permissions: {
                                ...inviteForm.permissions,
                                [permission]: e.target.checked,
                              },
                            })
                          }
                          className="w-4 h-4 rounded accent-primary cursor-pointer"
                        />
                        <span className="text-sm text-ink capitalize">
                          {permission === 'prescorings' && 'Prescorings'}
                          {permission === 'billing' && 'Facturación'}
                          {permission === 'reports' && 'Reportes'}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={handleSendInvitation}
                  loading={invitationLoading}
                >
                  <UserPlus className="w-4 h-4" />
                  Enviar invitación
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Pending Invitations (admin only) */}
        {isAdmin() && pendingInvitations.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-sans font-semibold text-lg text-ink">Invitaciones pendientes</h2>
            </div>
            <Card>
              <DataTable
                columns={invitationColumns}
                data={pendingInvitations}
                keyExtractor={(item) => item.id}
                loading={false}
                emptyMessage="No hay invitaciones pendientes"
              />
            </Card>
          </div>
        )}

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
                            onChange={(e) => setEditingRole(e.target.value)}
                            options={[
                              { value: 'admin', label: 'Administrador' },
                              { value: 'commercial', label: 'Comercial' },
                            ]}
                          />
                        </div>

                        {editingRole === 'commercial' && (
                          <div className="space-y-3 p-3 bg-bg-2 rounded-lg">
                            <p className="text-sm font-medium text-ink">Permisos</p>
                            <div className="space-y-2">
                              {['prescorings', 'billing', 'reports'].map((permission) => (
                                <label key={permission} className="flex items-center gap-3 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={editingPermissions[permission] || false}
                                    onChange={(e) =>
                                      setEditingPermissions({
                                        ...editingPermissions,
                                        [permission]: e.target.checked,
                                      })
                                    }
                                    className="w-4 h-4 rounded accent-primary cursor-pointer"
                                  />
                                  <span className="text-sm text-ink capitalize">
                                    {permission === 'prescorings' && 'Prescorings'}
                                    {permission === 'billing' && 'Facturación'}
                                    {permission === 'reports' && 'Reportes'}
                                  </span>
                                </label>
                              ))}
                            </div>
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
