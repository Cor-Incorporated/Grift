import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNDJSONStream } from '@/hooks/use-ndjson-stream'
import {
  getRequirementArtifact,
  listConversationTurns,
  listObservationQAPairs,
  listSourceDocuments,
  uploadSourceDocument,
} from '@/lib/api-client'
import type {
  ChecklistMap,
  ConversationTurn,
  HearingSessionState,
  MissingInfoPrompt,
  ObservationQAPair,
  RequirementArtifact,
  SourceDocument,
} from '@/types/conversation'

type UseHearingSessionReturn = HearingSessionState & {
  sendMessage: (content: string) => Promise<void>
  uploadFile: (file: File) => Promise<void>
  uploadFromUrl: (sourceUrl: string) => Promise<void>
  refreshSession: () => Promise<void>
}

const QA_REFRESH_DELAY_MS = 500
const ARTIFACT_REFRESH_DELAY_MS = 2_000
const SOURCE_DOCUMENT_REFRESH_DELAY_MS = 1_500

function clampScore(value: number) {
  return Math.min(1, Math.max(0, value))
}

function buildChecklist(qaPairs?: ObservationQAPair[]): ChecklistMap {
  return (qaPairs ?? []).reduce<ChecklistMap>((accumulator, pair) => {
    accumulator[pair.id] = {
      id: pair.id,
      label: pair.question_text,
      completeness: clampScore(pair.quality.completeness),
      isComplete: pair.quality.is_complete,
      needsFollowup: pair.quality.needs_followup,
      ...(pair.quality.rationale
        ? { rationale: pair.quality.rationale }
        : {}),
      lastUpdatedAt: pair.created_at,
    }
    return accumulator
  }, {})
}

function buildMissingInfoPrompts(
  qaPairs?: ObservationQAPair[],
): MissingInfoPrompt[] {
  return (qaPairs ?? [])
    .filter(
      (pair) => pair.quality.needs_followup || !pair.quality.is_complete,
    )
    .map((pair) => ({
      id: pair.id,
      label: pair.question_text,
      ...(pair.quality.rationale ? { detail: pair.quality.rationale } : {}),
      completeness: clampScore(pair.quality.completeness),
      needsFollowup: pair.quality.needs_followup,
    }))
}

function buildCompleteness(qaPairs?: ObservationQAPair[]) {
  if (!qaPairs || qaPairs.length === 0) {
    return 0
  }

  const total = qaPairs.reduce(
    (sum, pair) => sum + clampScore(pair.quality.completeness),
    0,
  )

  return clampScore(total / qaPairs.length)
}

export function useHearingSession(caseId?: string): UseHearingSessionReturn {
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [sourceDocuments, setSourceDocuments] = useState<SourceDocument[]>([])
  const [requirementArtifact, setRequirementArtifact] =
    useState<RequirementArtifact | null>(null)
  const [qaPairs, setQaPairs] = useState<ObservationQAPair[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isRefreshingObservations, setIsRefreshingObservations] =
    useState(false)
  const [isRefreshingArtifact, setIsRefreshingArtifact] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadNotice, setUploadNotice] = useState<string | null>(null)
  const postTurnTimeoutsRef = useRef<number[]>([])
  const uploadTimeoutsRef = useRef<number[]>([])
  const isMountedRef = useRef(true)

  const {
    streamingContent,
    isStreaming,
    error: streamError,
    sendStreamMessage,
    cancelStream,
  } = useNDJSONStream()

  const clearPostTurnTimers = useCallback(() => {
    postTurnTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId)
    })
    postTurnTimeoutsRef.current = []
  }, [])

  const clearUploadTimers = useCallback(() => {
    uploadTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId)
    })
    uploadTimeoutsRef.current = []
  }, [])

  const refreshTurns = useCallback(async () => {
    if (!caseId) return
    const nextTurns = await listConversationTurns(caseId)
    setTurns(nextTurns)
  }, [caseId])

  const refreshSourceDocs = useCallback(async () => {
    if (!caseId) return
    const nextDocuments = await listSourceDocuments(caseId)
    setSourceDocuments(nextDocuments)
  }, [caseId])

  const refreshArtifact = useCallback(async () => {
    if (!caseId) return

    setIsRefreshingArtifact(true)
    try {
      const nextArtifact = await getRequirementArtifact(caseId)
      setRequirementArtifact(nextArtifact)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to refresh requirement artifact'
      setError(message)
    } finally {
      setIsRefreshingArtifact(false)
    }
  }, [caseId])

  const refreshObservations = useCallback(async () => {
    if (!caseId) return

    setIsRefreshingObservations(true)
    try {
      const nextPairs = await listObservationQAPairs(caseId)
      setQaPairs(nextPairs ?? [])
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to refresh observations'
      setError(message)
    } finally {
      setIsRefreshingObservations(false)
    }
  }, [caseId])

  const refreshSession = useCallback(async () => {
    if (!caseId) {
      setTurns([])
      setSourceDocuments([])
      setRequirementArtifact(null)
      setQaPairs([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const [nextTurns, nextDocuments, nextArtifact] = await Promise.all([
        listConversationTurns(caseId),
        listSourceDocuments(caseId),
        getRequirementArtifact(caseId),
      ])

      setTurns(nextTurns)
      setSourceDocuments(nextDocuments)
      setRequirementArtifact(nextArtifact)
      setError(null)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load hearing session'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [caseId])

  const schedulePostTurnRefreshes = useCallback(() => {
    clearPostTurnTimers()

    const qaTimeoutId = window.setTimeout(() => {
      void Promise.allSettled([refreshTurns(), refreshObservations()]).then(
        (results) => {
          const rejection = results.find((result) => result.status === 'rejected')
          if (rejection?.status === 'rejected') {
            const message =
              rejection.reason instanceof Error
                ? rejection.reason.message
                : 'Failed to refresh hearing session'
            setError(message)
          }
        },
      )
    }, QA_REFRESH_DELAY_MS)

    const artifactTimeoutId = window.setTimeout(() => {
      void refreshArtifact()
    }, ARTIFACT_REFRESH_DELAY_MS)

    postTurnTimeoutsRef.current = [qaTimeoutId, artifactTimeoutId]
  }, [clearPostTurnTimers, refreshArtifact, refreshObservations, refreshTurns])

  useEffect(() => {
    void refreshSession()
  }, [refreshSession])

  useEffect(() => {
    if (streamError) {
      setError(streamError)
    }
  }, [streamError])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      clearPostTurnTimers()
      clearUploadTimers()
      cancelStream()
    }
  }, [cancelStream, clearPostTurnTimers, clearUploadTimers])

  const sendMessage = useCallback(
    async (content: string) => {
      if (!caseId) return

      const optimisticTurn: ConversationTurn = {
        id: crypto.randomUUID(),
        case_id: caseId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      }

      setTurns((previousTurns) => [...previousTurns, optimisticTurn])
      setError(null)

      const assistantTurn = await sendStreamMessage(caseId, content)
      if (!assistantTurn || !isMountedRef.current) {
        return
      }

      setTurns((previousTurns) => [...previousTurns, assistantTurn])
      schedulePostTurnRefreshes()
    },
    [caseId, schedulePostTurnRefreshes, sendStreamMessage],
  )

  const appendUploadedDocument = useCallback(
    (document: SourceDocument | null) => {
      if (!document) return

      setSourceDocuments((previousDocuments) => [
        document,
        ...previousDocuments.filter((item) => item.id !== document.id),
      ])
    },
    [],
  )

  const uploadFile = useCallback(
    async (file: File) => {
      if (!caseId) return

      setIsUploading(true)
      setUploadError(null)
      setUploadNotice(null)

      try {
        const document = await uploadSourceDocument(caseId, { file })
        appendUploadedDocument(document)
        setUploadNotice('Source document queued for processing.')
        uploadTimeoutsRef.current.push(
          window.setTimeout(() => {
            void refreshSourceDocs()
          }, SOURCE_DOCUMENT_REFRESH_DELAY_MS),
        )
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to upload source document'
        setUploadError(message)
      } finally {
        setIsUploading(false)
      }
    },
    [appendUploadedDocument, caseId, refreshSourceDocs],
  )

  const uploadFromUrl = useCallback(
    async (sourceUrl: string) => {
      if (!caseId) return

      setIsUploading(true)
      setUploadError(null)
      setUploadNotice(null)

      try {
        const document = await uploadSourceDocument(caseId, { sourceUrl })
        appendUploadedDocument(document)
        setUploadNotice('Source URL queued for processing.')
        uploadTimeoutsRef.current.push(
          window.setTimeout(() => {
            void refreshSourceDocs()
          }, SOURCE_DOCUMENT_REFRESH_DELAY_MS),
        )
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to upload source document'
        setUploadError(message)
      } finally {
        setIsUploading(false)
      }
    },
    [appendUploadedDocument, caseId, refreshSourceDocs],
  )

  const checklist = useMemo(() => buildChecklist(qaPairs), [qaPairs])
  const missingInfoPrompts = useMemo(
    () => buildMissingInfoPrompts(qaPairs),
    [qaPairs],
  )
  const completeness = useMemo(() => buildCompleteness(qaPairs), [qaPairs])

  return {
    turns,
    sourceDocuments,
    requirementArtifact,
    qaPairs,
    checklist,
    missingInfoPrompts,
    completeness,
    streamingContent,
    isLoading,
    isStreaming,
    isUploading,
    isRefreshingObservations,
    isRefreshingArtifact,
    error: error ?? streamError,
    uploadError,
    uploadNotice,
    sendMessage,
    uploadFile,
    uploadFromUrl,
    refreshSession,
  }
}
