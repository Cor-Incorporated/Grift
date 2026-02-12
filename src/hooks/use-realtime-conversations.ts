'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Conversation } from '@/types/database'

interface UseRealtimeConversationsProps {
  projectId: string
  onNewMessage: (message: Conversation) => void
}

export function useRealtimeConversations({
  projectId,
  onNewMessage,
}: UseRealtimeConversationsProps) {
  const callbackRef = useRef(onNewMessage)

  useEffect(() => {
    callbackRef.current = onNewMessage
  }, [onNewMessage])

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`conversations:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversations',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          callbackRef.current(payload.new as Conversation)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId])
}
