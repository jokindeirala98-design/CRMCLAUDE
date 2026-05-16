/**
 * Tipos del Agente IA Comercial.
 *
 * Convenciones:
 * - Colecciones del corpus: 'a&c_youtube', 'a&c_linkedin', 'a&c_instagram',
 *   'voltis_kb', 'voltis_tarjetas_tecnicas'.
 * - Intent del agente: 'consejo_tactico', 'redactar_email',
 *   'analizar_conversacion', 'preparar_reunion', 'chat_libre'.
 */

export type AgentRole = 'piloto' | 'comercial' | 'admin'

export type KbCollection =
  | 'a&c_youtube'
  | 'a&c_linkedin'
  | 'a&c_instagram'
  | 'voltis_kb'
  | 'voltis_tarjetas_tecnicas'

export interface KbChunk {
  id: string
  collection: KbCollection
  source: string
  content: string
  citation?: string | null
  metadata?: Record<string, any>
  similarity?: number
}

export type AgentIntent =
  | 'consejo_tactico'
  | 'redactar_email'
  | 'analizar_conversacion'
  | 'preparar_reunion'
  | 'chat_libre'

export type AgentMessageRole = 'user' | 'assistant' | 'tool' | 'system'

export interface AgentMessage {
  id: string
  conversationId: string
  role: AgentMessageRole
  content?: string | null
  audioUrl?: string | null
  transcript?: string | null
  toolCalls?: AgentToolCall[] | null
  toolName?: string | null
  toolResult?: any
  tokensIn?: number | null
  tokensOut?: number | null
  latencyMs?: number | null
  modelUsed?: string | null
  costEstimateUsd?: number | null
  userRating?: -1 | 0 | 1 | null
  userFeedback?: string | null
  createdAt: string
}

export interface AgentConversation {
  id: string
  telegramUserId: number
  commercialName?: string | null
  referencedClientId?: string | null
  summary?: string | null
  lastMessageAt: string
  createdAt: string
}

export interface AgentToolCall {
  name: string
  args: Record<string, any>
}

export interface AgentAuthorizedUser {
  telegramUserId: number
  name: string
  email?: string | null
  role: AgentRole
  commercialId?: string | null
  active: boolean
  addedAt: string
}

export interface GmailCredentials {
  id: string
  telegramUserId: number
  gmailAddress: string
  refreshTokenEncrypted: string
  accessToken?: string | null
  accessTokenExpiresAt?: string | null
  scopes: string[]
  status: 'active' | 'revoked' | 'error'
  lastUsedAt?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Resultado de búsqueda RAG con cita lista para inyectar en el prompt.
 */
export interface RagResult {
  chunks: KbChunk[]
  formattedContext: string
}

/**
 * Métricas de coste por mensaje.
 * Precios Gemini 2.5 Flash (2026): $0.075/M input, $0.30/M output.
 */
export interface MessageCost {
  tokensIn: number
  tokensOut: number
  costUsd: number
  model: string
}
