/**
 * Aplica los datos de un documento de identidad (DNI / CIF / certificado
 * bancario) a la ficha de cliente respetando el rol de cada documento:
 *
 *   DNI (persona física):
 *     - Cliente PARTICULAR  → es el titular. Guardamos `nif`, `cif_nif`,
 *       `name` (si está vacío), `fiscal_address`, `nif_file_url`.
 *     - Cliente EMPRESA     → es el REPRESENTANTE LEGAL que firmará en
 *       su nombre. Guardamos `signer_name`, `signer_nif`, `nif_file_url`.
 *       Nunca tocamos `name`, `cif`, `cif_nif` de la empresa.
 *
 *   CIF (empresa):
 *     - Pertenece a la empresa. Guardamos `cif`, `cif_nif`, `cif_file_url`,
 *       `name` (si está vacío), `fiscal_address`. Garantizamos `type=empresa`.
 *
 *   Certificado bancario:
 *     - Guardamos `iban`, `iban_file_url`. Si el titular es persona
 *       (NIF) y el cliente es empresa, lo tratamos como representante;
 *       si es CIF, va al cliente.
 *
 * Esta función NO crea clientes — el caller la llama con un cliente ya
 * resuelto. Devuelve true si aplicó algún cambio.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type IdentityDocumentType = 'dni' | 'nie' | 'cif' | 'cert_bancario' | 'desconocido' | string

export interface IdentityExtracted {
  documentType: IdentityDocumentType
  /** DNI / NIE / NIF de una persona física. */
  dni?: string | null
  /** CIF de una empresa. */
  cif?: string | null
  /** Nombre completo (persona física). */
  full_name?: string | null
  /** Razón social (empresa). */
  company_name?: string | null
  /** Dirección fiscal. */
  fiscal_address?: string | null
  /** Solo cert. bancario. */
  iban?: string | null
  account_holder?: string | null
  account_holder_id?: string | null
}

export interface ApplyIdentityResult {
  patched: boolean
  /** Resumen de qué se guardó (útil para el mensaje de Telegram). */
  summary: string
  /** Campos actualizados. */
  fieldsPatched: string[]
}

export async function applyIdentityToClient(
  supabase: SupabaseClient,
  clientId: string,
  identity: IdentityExtracted,
  fileUrl: string | null | undefined,
): Promise<ApplyIdentityResult> {
  if (!clientId) {
    return { patched: false, summary: 'sin cliente', fieldsPatched: [] }
  }

  // Cargar tipo y nombre actuales del cliente para decidir rol del documento
  const { data: client } = await supabase
    .from('clients')
    .select('id, type, name, cif, nif, cif_nif')
    .eq('id', clientId)
    .single()
  if (!client) {
    return { patched: false, summary: 'cliente no encontrado', fieldsPatched: [] }
  }

  const isEmpresa = client.type === 'empresa'
  const patch: Record<string, any> = {}
  const dt = identity.documentType

  if (dt === 'dni' || dt === 'nie') {
    // El DNI/NIE es de una persona física.
    if (isEmpresa) {
      // Representante legal de la empresa.
      if (fileUrl) patch.nif_file_url = fileUrl
      if (identity.dni) patch.signer_nif = identity.dni
      if (identity.full_name) patch.signer_name = identity.full_name
      // NUNCA tocamos name/cif/cif_nif aquí — son de la empresa
    } else {
      // Particular: el DNI es del titular.
      if (fileUrl) patch.nif_file_url = fileUrl
      if (identity.dni) { patch.nif = identity.dni; patch.cif_nif = identity.dni }
      if (identity.full_name && !client.name) patch.name = identity.full_name
      if (identity.fiscal_address) patch.fiscal_address = identity.fiscal_address
    }
  } else if (dt === 'cif') {
    // El CIF siempre es de la empresa.
    if (fileUrl) patch.cif_file_url = fileUrl
    if (identity.cif) { patch.cif = identity.cif; patch.cif_nif = identity.cif }
    if (identity.company_name && !client.name) patch.name = identity.company_name
    if (identity.fiscal_address) patch.fiscal_address = identity.fiscal_address
    // Si el cliente no estaba marcado como empresa, asegurar tipo correcto
    if (client.type !== 'empresa') patch.type = 'empresa'
  } else if (dt === 'cert_bancario') {
    if (fileUrl) patch.iban_file_url = fileUrl
    if (identity.iban) patch.iban = identity.iban
    if (identity.account_holder_id) {
      const id = identity.account_holder_id.toUpperCase().replace(/[\s.-]/g, '')
      const isCif = /^[A-HJNP-SUVW]\d{7}[0-9A-J]$/.test(id)
      if (isCif) {
        if (!client.cif) { patch.cif = id; if (!client.cif_nif) patch.cif_nif = id }
      } else {
        if (isEmpresa) {
          // El titular del certificado bancario en empresa es el firmante
          patch.signer_nif = id
          if (identity.account_holder) patch.signer_name = identity.account_holder
        } else {
          if (!client.nif) { patch.nif = id; if (!client.cif_nif) patch.cif_nif = id }
          if (identity.account_holder && !client.name) patch.name = identity.account_holder
        }
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    return { patched: false, summary: 'documento procesado, sin campos nuevos', fieldsPatched: [] }
  }

  const { error } = await supabase.from('clients').update(patch).eq('id', clientId)
  if (error) {
    return { patched: false, summary: `error: ${error.message}`, fieldsPatched: [] }
  }

  // Resumen legible (en español, conciso)
  let summary = ''
  if (dt === 'dni' || dt === 'nie') {
    summary = isEmpresa
      ? 'guardado como representante legal'
      : 'guardado como titular'
  } else if (dt === 'cif') {
    summary = 'CIF guardado en empresa'
  } else if (dt === 'cert_bancario') {
    summary = 'IBAN guardado'
  }

  return { patched: true, summary, fieldsPatched: Object.keys(patch) }
}
