/**
 * Google Sheets API integration via Service Account
 * Uses native Web Crypto / Node crypto for JWT — no external packages needed.
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  (client_email from JSON)
 *   GOOGLE_PRIVATE_KEY            (private_key from JSON, with literal \n)
 *   VOLTIS_CONTRATACIONES_SHEET_ID (the spreadsheet ID)
 */

const SHEET_ID = process.env.VOLTIS_CONTRATACIONES_SHEET_ID!
const SHEET_NAME = 'Contrataciones'

// ── JWT helpers ──────────────────────────────────────────────────────────────

function base64url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function signRS256(data: string, pemKey: string): Promise<string> {
  // Clean up PEM key
  const key = pemKey
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '')

  const binaryKey = Buffer.from(key, 'base64')

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    Buffer.from(data)
  )

  return Buffer.from(signature)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!
  const privateKey = process.env.GOOGLE_PRIVATE_KEY!
  const scope = 'https://www.googleapis.com/auth/spreadsheets'
  const now = Math.floor(Date.now() / 1000)

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({
    iss: email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }))

  const unsigned = `${header}.${payload}`
  const sig = await signRS256(unsigned, privateKey)
  const jwt = `${unsigned}.${sig}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  const json = await res.json()
  if (!json.access_token) throw new Error(`Google OAuth failed: ${JSON.stringify(json)}`)
  return json.access_token
}

// ── Column mapping ───────────────────────────────────────────────────────────
// Must match the exact order of columns in VOLTIS CONTRATACIONES sheet:
// A: Comercial  B: Column1(internal)  C: Fecha firma  D: Fecha activacion
// E: Nombre y apellidos  F: NIF/CIF  G: Firmante  H: DNI firmante
// I: Column8(comercializadora)  J: Servicio  K: Mail  L: Teléfono
// M: IBAN Cuenta  N: Dirección suministro  O: Dirección fiscal  P: CUPS
// Q: PRODUCTO  R: Trámite  S: Observaciones  T: CONSUMO
// U: Comisión neta  V: SVA  W: Plan trimestral  X: Total facturado
// Y: Pagado  Z: Com. comercial  AA: Estado

export interface ContratacionRow {
  comercial: string           // A - nombre comercial (Xabi, Jokin...)
  fechaFirma: string          // C - dd-mm-yyyy
  fechaActivacion?: string    // D - dd-mm-yyyy (puede quedar vacía)
  nombre: string              // E - nombre cliente / razón social
  nifCif: string              // F
  firmante?: string           // G - solo si empresa/ayto
  dniFirmante?: string        // H - solo si empresa/ayto
  comercializadora: string    // I
  servicio: string            // J - Energía / GAS / Telefonía
  mail?: string               // K
  telefono?: string           // L
  iban?: string               // M
  direccionSuministro?: string // N
  direccionFiscal?: string    // O
  cups?: string               // P
  producto?: string           // Q - tarifa / producto
  tramite?: string            // R - NUEVA CONTRATACION, CAMBIO, etc.
  observaciones?: string      // S
  consumo?: number | string   // T - kWh anuales
  // U-Y: comisión neta, SVA, plan trimestral, total facturado, pagado → vacías
  comComercial?: string       // Z - mismo que comercial normalmente
  estado?: string             // AA - PENDIENTE por defecto
}

function rowToValues(row: ContratacionRow): (string | number | null)[] {
  const fmt = (d?: string) => d || ''
  return [
    row.comercial,                        // A
    '',                                   // B (Column 1 interno)
    row.fechaFirma,                       // C
    fmt(row.fechaActivacion),             // D
    row.nombre,                           // E
    row.nifCif,                           // F
    fmt(row.firmante),                    // G
    fmt(row.dniFirmante),                 // H
    row.comercializadora,                 // I
    row.servicio,                         // J
    fmt(row.mail),                        // K
    fmt(row.telefono),                    // L
    fmt(row.iban),                        // M
    fmt(row.direccionSuministro),         // N
    fmt(row.direccionFiscal),             // O
    fmt(row.cups),                        // P
    fmt(row.producto),                    // Q
    fmt(row.tramite),                     // R
    fmt(row.observaciones),               // S
    row.consumo != null ? String(row.consumo) : '', // T
    '',                                   // U comisión neta (manual)
    '',                                   // V SVA (manual)
    '',                                   // W plan trimestral (manual)
    '',                                   // X total facturado (manual)
    '',                                   // Y pagado (manual)
    fmt(row.comComercial) || row.comercial, // Z
    row.estado || 'PENDIENTE',            // AA
  ]
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Append a new contract row to VOLTIS CONTRATACIONES.
 * Returns the updated range (e.g. "Contrataciones!A15:AA15").
 */
export async function appendContractRow(row: ContratacionRow): Promise<string> {
  const token = await getAccessToken()
  const range = encodeURIComponent(`${SHEET_NAME}!A:AA`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [rowToValues(row)],
    }),
  })

  const json = await res.json()
  if (!res.ok) throw new Error(`Sheets append failed: ${JSON.stringify(json)}`)
  return json.updates?.updatedRange || 'ok'
}

/**
 * Mark a client as "caído" in the sheet by adding a note to their row.
 * We find the row by CUPS (column P) and update Estado (column AA) to "CAÍDO".
 */
export async function markClientFallen(cups: string, fallen: boolean): Promise<void> {
  const token = await getAccessToken()

  // 1. Find all rows
  const range = encodeURIComponent(`${SHEET_NAME}!A:AA`)
  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`
  const getRes = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const getData = await getRes.json()
  const rows: string[][] = getData.values || []

  // Column P = index 15 (CUPS), Column AA = index 26 (Estado)
  const rowsToUpdate: { row: number; estado: string }[] = []
  rows.forEach((r, i) => {
    if (i === 0) return // skip header
    if (r[15] && r[15].trim() === cups.trim()) {
      rowsToUpdate.push({ row: i + 1, estado: fallen ? 'CAÍDO' : 'PENDIENTE' })
    }
  })

  if (rowsToUpdate.length === 0) return

  // 2. Batch update Estado column for matching rows
  const data = rowsToUpdate.map(({ row, estado }) => ({
    range: `${SHEET_NAME}!AA${row}`,
    values: [[estado]],
  }))

  const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`
  await fetch(updateUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  })
}

/**
 * Read all contract rows for liquidación generation.
 * Returns raw rows as string arrays (skip header row 1).
 */
export async function getContratacionRows(): Promise<string[][]> {
  const token = await getAccessToken()
  const range = encodeURIComponent(`${SHEET_NAME}!A:AA`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await res.json()
  const rows: string[][] = json.values || []
  return rows.slice(1) // skip header
}
