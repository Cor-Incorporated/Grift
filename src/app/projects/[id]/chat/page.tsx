'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { ChatMessages } from '@/components/chat/chat-messages'
import { ChatInput } from '@/components/chat/chat-input'
import { ChatHeader } from '@/components/chat/chat-header'
import { ProgressBar } from '@/components/chat/progress-bar'
import type { Conversation, ConversationMetadata, ProjectType } from '@/types/database'

export default function ChatPage() {
  const params = useParams()
  const projectId = params.id as string

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [confirmedCategories, setConfirmedCategories] = useState<string[]>([])
  const [isComplete, setIsComplete] = useState(false)
  const [projectType, setProjectType] = useState<ProjectType>('undetermined')
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const initialMessageSentRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const loadConversations = async () => {
      setIsLoading(true)
      try {
        const response = await fetch(
          `/api/conversations?project_id=${projectId}`
        )
        const result = await response.json()
        if (result.success) {
          setConversations(result.data)

          // Restore state from loaded conversation metadata
          const lastAssistant = [...(result.data as Conversation[])]
            .reverse()
            .find((c) => c.role === 'assistant')
          if (lastAssistant?.metadata) {
            const meta = lastAssistant.metadata as ConversationMetadata
            if (meta.is_complete) {
              setIsComplete(true)
            }
            if (meta.confirmed_categories?.length) {
              setConfirmedCategories(meta.confirmed_categories)
            }
            if (meta.classified_type) {
              setProjectType(meta.classified_type)
            }
          }
        }
      } catch {
        setError('会話履歴の読み込みに失敗しました')
      } finally {
        setIsLoading(false)
      }
    }

    loadConversations()
  }, [projectId])

  useEffect(() => {
    scrollToBottom()
  }, [conversations, streamingContent, scrollToBottom])

  useEffect(() => {
    if (conversations.length === 0 && !isLoading && !initialMessageSentRef.current) {
      initialMessageSentRef.current = true
      sendStreamingMessage('はじめまして。よろしくお願いいたします。')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length, isLoading])

  const reloadConversations = async () => {
    const response = await fetch(`/api/conversations?project_id=${projectId}`)
    const result = await response.json()
    if (result.success) {
      setConversations(result.data)
    }
  }

  const sendStreamingMessage = async (content: string) => {
    setIsStreaming(true)
    setStreamingContent('')
    setError(null)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const response = await fetch('/api/conversations/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          content,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error ?? 'メッセージの送信に失敗しました')
        setIsStreaming(false)
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        setError('ストリーミングの初期化に失敗しました')
        setIsStreaming(false)
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7).trim()
            const dataLineIndex = lines.indexOf(line) + 1
            if (dataLineIndex < lines.length && lines[dataLineIndex].startsWith('data: ')) {
              // Will be handled in the data parsing below
            }
            void eventType
          }

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if ('token' in data) {
                setStreamingContent((prev) => prev + data.token)
              }

              if ('confirmed_categories' in data) {
                if (data.confirmed_categories) {
                  setConfirmedCategories(data.confirmed_categories)
                }
                if (data.is_complete) {
                  setIsComplete(true)
                }
                if (data.classified_type) {
                  setProjectType(data.classified_type)
                }
              }

              if ('estimate_id' in data) {
                // Estimate auto-generated notification - no action needed on client
                // The estimate will be visible in the admin panel
              }

              if ('message_id' in data && !('token' in data)) {
                setStreamingContent('')
                await reloadConversations()
              }

              if ('error' in data && !('token' in data) && !('message_id' in data)) {
                setError(data.error)
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setStreamingContent('')
        await reloadConversations()
      } else {
        setError('メッセージの送信に失敗しました')
      }
    } finally {
      setIsStreaming(false)
      abortControllerRef.current = null
    }
  }

  const handleSendMessage = async (content: string) => {
    if (isStreaming || isComplete) return

    const optimisticMessage: Conversation = {
      id: `temp-${Date.now()}`,
      project_id: projectId,
      role: 'user',
      content,
      metadata: {},
      created_at: new Date().toISOString(),
    }
    setConversations((prev) => [...prev, optimisticMessage])

    await sendStreamingMessage(content)
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  const handleRetry = async (userMessageId: string) => {
    setError(null)

    const userMsgIndex = conversations.findIndex((c) => c.id === userMessageId)
    if (userMsgIndex === -1) return

    const idsToDelete: string[] = [userMessageId]
    for (let i = userMsgIndex + 1; i < conversations.length; i++) {
      if (conversations[i].role === 'assistant') {
        idsToDelete.push(conversations[i].id)
        break
      }
    }

    try {
      await Promise.all(
        idsToDelete
          .filter((id) => !id.startsWith('temp-'))
          .map((id) =>
            fetch(`/api/conversations/${id}`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project_id: projectId }),
            })
          )
      )

      setConversations((prev) =>
        prev.filter((c) => !idsToDelete.includes(c.id))
      )
    } catch {
      setError('やり直しに失敗しました')
    }
  }

  const lastUserMessage = [...conversations]
    .reverse()
    .find((c) => c.role === 'user')

  const lastAssistantMessage = [...conversations]
    .reverse()
    .find((c) => c.role === 'assistant')

  const choices =
    (lastAssistantMessage?.metadata as ConversationMetadata)?.choices ?? []

  return (
    <div className="flex h-screen flex-col bg-background">
      <ChatHeader
        projectId={projectId}
        isComplete={isComplete}
      />

      <ProgressBar
        confirmedCategories={confirmedCategories}
        isComplete={isComplete}
        projectType={projectType}
      />

      <div className="flex-1 overflow-auto px-4 py-6">
        <div className="mx-auto max-w-3xl">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-pulse text-muted-foreground">
                会話を読み込み中...
              </div>
            </div>
          ) : (
            <ChatMessages
              conversations={conversations}
              streamingContent={streamingContent}
              isStreaming={isStreaming}
              onRetry={handleRetry}
              lastUserMessageId={lastUserMessage?.id}
            />
          )}
          {error && (
            <div className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <ChatInput
        projectId={projectId}
        onSend={handleSendMessage}
        onStop={handleStop}
        onAttachmentUpdated={reloadConversations}
        disabled={isStreaming || isComplete}
        isStreaming={isStreaming}
        choices={choices}
        isComplete={isComplete}
      />
    </div>
  )
}
