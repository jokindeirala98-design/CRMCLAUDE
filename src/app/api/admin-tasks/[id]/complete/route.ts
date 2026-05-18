/**
 * POST /api/admin-tasks/[id]/complete
 *
 * Recibe un archivo (multipart/form-data, campo "file") y completa una tarea
 * de tipo "estudio_economico_pendiente":
 *   1. Sube el archivo a Supabase Storage bucket "estudios-economicos"
 *      bajo la ruta {supply_id}/{filename-saneado}.
 *   2. Guarda la URL pública en supplies.economic_study_url + filename + uploaded_by.
 *   3. Marca la admin_task como completed + completed_by/at.
 *
 * Validaciones:
 *   - Solo admins.
 *   - Tipos aceptados: pdf, xlsx, xls, csv.
 *   - Tamaño máximo: 20 MB.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 30

const ACCEPTED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  // xlsx
  'application/vnd.ms-excel',                                             // xls
  'text/csv',
])
const MAX_BYTES = 20 * 1024 * 1024 // 20 MB

function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('users_profile').select('id, role').eq('id', user.id).single()
    const isAdmin = profile?.role === 'admin'

    const taskId = params.id
    if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

    // 1. Cargar la tarea — debe existir y estar pendiente
    const { data: task } = await supabase
      .from('admin_tasks')
      .select('id, type, supply_id, client_id, status')
      .eq('id', taskId)
      .single()
    if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })
    if (task.status !== 'pending') {
      return NextResponse.json({ error: 'La tarea ya está cerrada' }, { status: 409 })
    }
    if (!task.supply_id) {
      return NextResponse.json({ error: 'Tarea sin supply asociado' }, { status: 400 })
    }

    // Autorización: admin O comercial responsable del cliente
    if (!isAdmin) {
      const { data: clientRow } = await supabase
        .from('clients').select('commercial_id').eq('id', task.client_id).single()
      if (clientRow?.commercial_id !== user.id) {
        return NextResponse.json(
          { error: 'No tienes permisos para subir el estudio de este cliente.' },
          { status: 403 },
        )
      }
    }

    // 2. Recibir archivo
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Archivo demasiado grande (máx. 20 MB)' }, { status: 413 })
    }
    if (file.type && !ACCEPTED_MIMES.has(file.type)) {
      return NextResponse.json({ error: `Tipo no aceptado: ${file.type}. Sube PDF, XLSX, XLS o CSV.` }, { status: 415 })
    }

    // 3. Subir a Storage
    const filename = sanitizeFilename(file.name || `estudio_${Date.now()}.pdf`)
    const storagePath = `${task.supply_id}/${Date.now()}_${filename}`
    const bytes = new Uint8Array(await file.arrayBuffer())

    const doUpload = async () => supabase.storage
      .from('estudios-economicos')
      .upload(storagePath, bytes, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })

    let { error: upErr } = await doUpload()

    // Auto-crear bucket si no existe (idempotente)
    if (upErr && /Bucket not found|bucket/i.test(upErr.message)) {
      await supabase.storage.createBucket('estudios-economicos', {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,    // 10 MB
        allowedMimeTypes: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'application/pdf',
          'text/csv',
          'application/octet-stream',
        ],
      }).catch(() => null)
      const retry = await doUpload()
      upErr = retry.error
    }

    if (upErr) {
      return NextResponse.json({ error: `Error subiendo a Storage: ${upErr.message}` }, { status: 500 })
    }

    const { data: urlData } = supabase.storage
      .from('estudios-economicos')
      .getPublicUrl(storagePath)
    const publicUrl = urlData?.publicUrl || null

    // 4. Actualizar supply con la URL del estudio
    const { error: supErr } = await supabase
      .from('supplies')
      .update({
        economic_study_url: publicUrl,
        economic_study_filename: filename,
        economic_study_uploaded_at: new Date().toISOString(),
        economic_study_uploaded_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.supply_id)
    if (supErr) {
      return NextResponse.json({ error: `Storage OK pero supply update falló: ${supErr.message}` }, { status: 500 })
    }

    // 4b. Insertar en `studies` para que aparezca en el "Gestor de documentos"
    // del supply (la UI del CRM lista los informes desde esa tabla).
    const nowIso = new Date().toISOString()
    await supabase.from('studies').insert({
      supply_id: task.supply_id,
      type: 'economico',
      report_url: publicUrl,
      status: 'completed',
      created_by: user.id,
      created_at: nowIso,
      completed_at: nowIso,
    })

    // 5. Marcar tarea completada
    const { error: taskErr } = await supabase
      .from('admin_tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: user.id,
      })
      .eq('id', taskId)
    if (taskErr) {
      return NextResponse.json({ error: `Estudio guardado pero tarea no se cerró: ${taskErr.message}` }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      task_id: taskId,
      supply_id: task.supply_id,
      filename,
      url: publicUrl,
    })
  } catch (e: any) {
    console.error('[POST /api/admin-tasks/[id]/complete]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
