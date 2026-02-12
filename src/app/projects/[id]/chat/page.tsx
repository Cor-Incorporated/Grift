'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { ChatMessages } from '@/components/chat/chat-messages'
import { ChatInput } from '@/components/chat/chat-input'
import { ChatHeader } from '@/components/chat/chat-header'
import { ProgressBar } from '@/components/chat/progress-bar'
import type { Conversation, ConversationMetadata } from '@/types/database'

interface AIResponseData {
  text: string
  metadata: ConversationMetadata
  confirmed_categories: string[]
}

export default function ChatPage() {
  const params = useParams()
  const projectId = params.id as string

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [confirmedCategories, setConfirmedCategories] = useState<string[]>([])
  const [isComplete, setIsComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const initialMessageSentRef = useRef(false)

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
  }, [conversations, scrollToBottom])

  useEffect(() => {
    if (conversations.length === 0 && !isLoading && !initialMessageSentRef.current) {
      initialMessageSentRef.current = true
      sendInitialMessage()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length, isLoading])

  const sendInitialMessage = async () => {
    setIsSending(true)
    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          content: 'はじめまして。よろしくお願いいたします。',
        }),
      })

      const result = await response.json()
      if (result.success) {
        updateFromAIResponse(result.data.ai_response)
        await reloadConversations()
      }
    } catch {
      setError('初期メッセージの送信に失敗しました')
    } finally {
      setIsSending(false)
    }
  }

  const reloadConversations = async () => {
    const response = await fetch(`/api/conversations?project_id=${projectId}`)
    const result = await response.json()
    if (result.success) {
      setConversations(result.data)
    }
  }

  const updateFromAIResponse = (aiResponse: AIResponseData) => {
    if (aiResponse.confirmed_categories) {
      setConfirmedCategories(aiResponse.confirmed_categories)
    }
    if (aiResponse.metadata.is_complete) {
      setIsComplete(true)
    }
  }

  const handleSendMessage = async (content: string) => {
    if (isSending || isComplete) return

    setIsSending(true)
    setError(null)

    const optimisticMessage: Conversation = {
      id: `temp-${Date.now()}`,
      project_id: projectId,
      role: 'user',
      content,
      metadata: {},
      created_at: new Date().toISOString(),
    }
    setConversations((prev) => [...prev, optimisticMessage])

    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          content,
        }),
      })

      const result = await response.json()

      if (!result.success) {
        setError(result.error)
        setConversations((prev) =>
          prev.filter((c) => c.id !== optimisticMessage.id)
        )
        return
      }

      updateFromAIResponse(result.data.ai_response)
      await reloadConversations()
    } catch {
      setError('メッセージの送信に失敗しました')
      setConversations((prev) =>
        prev.filter((c) => c.id !== optimisticMessage.id)
      )
    } finally {
      setIsSending(false)
    }
  }

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
            <ChatMessages conversations={conversations} />
          )}
          {isSending && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <div className="flex gap-1">
                <span className="animate-bounce">.</span>
                <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
              </div>
              AI 執事が回答を考えています
            </div>
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
        onAttachmentUpdated={reloadConversations}
        disabled={isSending || isComplete}
        choices={choices}
        isComplete={isComplete}
      />
    </div>
  )
}
