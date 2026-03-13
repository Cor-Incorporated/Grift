export type DataClassification =
  | 'public'
  | 'internal'
  | 'confidential'
  | 'restricted'

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
  data_classification?: DataClassification
}

export interface NDJSONErrorChunk {
  type: 'error'
  error: string
  data_classification?: DataClassification
}

export interface NDJSONDoneChunk {
  type: 'done'
  done: boolean
  turn_id?: string
  event_type?: 'conversation.turn.completed'
  data_classification?: DataClassification
}

export type NDJSONChunk = NDJSONContentChunk | NDJSONErrorChunk | NDJSONDoneChunk

export interface SourceDocument {
  id: string
  case_id: string
  file_name: string
  file_type?: string
  file_size?: number
  source_kind?: 'file_upload' | 'repository_url' | 'website_url'
  source_url?: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  // NOTE: gcs_path is intentionally omitted — it is an internal GCS storage
  // path that should not be exposed to the frontend. The control-api may still
  // include it in responses, but we do not type it here to prevent accidental
  // rendering or leakage to end users.
  analysis_result?: Record<string, unknown>
  created_at: string
}

export interface RequirementArtifact {
  id: string
  case_id: string
  version: number
  markdown: string
  source_chunks?: string[]
  citations?: Array<{
    chunk_id: string
    source_id: string
    chunk_index: number
    offset_start: number
    offset_end: number
    content_sha256: string
  }>
  status: 'draft' | 'finalized'
  created_by_uid?: string
  created_at?: string
  updated_at?: string
}

export interface QualityScore {
  confidence: number
  completeness: number
  coherence: number
  rationale?: string
  needs_followup: boolean
  is_complete: boolean
}

export interface ObservationQAPair {
  id: string
  case_id: string
  session_id: string
  question_text: string
  answer_text: string
  quality: QualityScore
  created_at: string
}

export interface ChecklistItem {
  id: string
  label: string
  completeness: number
  isComplete: boolean
  needsFollowup: boolean
  rationale?: string | undefined
  lastUpdatedAt?: string | undefined
}

export type ChecklistMap = Record<string, ChecklistItem>

export interface MissingInfoPrompt {
  id: string
  label: string
  detail?: string | undefined
  completeness: number
  needsFollowup: boolean
}

export interface HearingSessionState {
  turns: ConversationTurn[]
  sourceDocuments: SourceDocument[]
  requirementArtifact: RequirementArtifact | null
  qaPairs: ObservationQAPair[]
  checklist: ChecklistMap
  missingInfoPrompts: MissingInfoPrompt[]
  completeness: number
  streamingContent: string
  isLoading: boolean
  isStreaming: boolean
  isUploading: boolean
  isRefreshingObservations: boolean
  isRefreshingArtifact: boolean
  error: string | null
  uploadError: string | null
  uploadNotice: string | null
}

export interface ListConversationsResponse {
  data: ConversationTurn[]
  total: number
}

export interface SendMessageResponse {
  data: ConversationTurn
}

export interface ListSourceDocumentsResponse {
  data: SourceDocument[]
  total: number
}

export interface GetRequirementArtifactResponse {
  data?: RequirementArtifact
}

export interface UploadSourceDocumentResponse {
  data?: SourceDocument
  job_id?: string
}

export interface ListObservationQAPairsResponse {
  data: ObservationQAPair[]
  total: number
}
