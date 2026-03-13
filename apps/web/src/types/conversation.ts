export interface ConversationTurnMetadata {
  category?: string
  confidence_score?: number
  is_complete?: boolean
  question_type?: 'open' | 'choice' | 'confirmation'
  choices?: string[]
  [key: string]: unknown
}

export interface ConversationTurn {
  id: string
  case_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata?: ConversationTurnMetadata
  created_at: string
}

export interface SendMessageRequest {
  content: string
}

export interface NDJSONContentChunk {
  type: 'content'
  content: string
  data_classification?: 'public' | 'internal' | 'confidential' | 'restricted'
}

export interface NDJSONErrorChunk {
  type: 'error'
  error: string
  data_classification?: 'public' | 'internal' | 'confidential' | 'restricted'
}

export interface NDJSONDoneChunk {
  type: 'done'
  done: boolean
  turn_id?: string
  event_type?: 'conversation.turn.completed'
  data_classification?: 'public' | 'internal' | 'confidential' | 'restricted'
}

export type NDJSONChunk = NDJSONContentChunk | NDJSONErrorChunk | NDJSONDoneChunk

export interface ListConversationsResponse {
  data: ConversationTurn[]
  total: number
}

export interface SendMessageResponse {
  data: ConversationTurn
}
