import { create } from 'zustand'
import type {
  Project,
  Conversation,
  ProjectStatus,
} from '@/types/database'

interface ProjectState {
  currentProject: Project | null
  conversations: Conversation[]
  isLoading: boolean
  error: string | null
}

interface ProjectActions {
  setCurrentProject: (project: Project | null) => void
  addConversation: (conversation: Conversation) => void
  setConversations: (conversations: Conversation[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  updateProjectStatus: (status: ProjectStatus) => void
  reset: () => void
}

const initialState: ProjectState = {
  currentProject: null,
  conversations: [],
  isLoading: false,
  error: null,
}

export const useProjectStore = create<ProjectState & ProjectActions>()(
  (set) => ({
    ...initialState,

    setCurrentProject: (project) => set({ currentProject: project }),

    addConversation: (conversation) =>
      set((state) => ({
        conversations: [...state.conversations, conversation],
      })),

    setConversations: (conversations) => set({ conversations }),

    setLoading: (isLoading) => set({ isLoading }),

    setError: (error) => set({ error }),

    updateProjectStatus: (status) =>
      set((state) => ({
        currentProject: state.currentProject
          ? { ...state.currentProject, status }
          : null,
      })),

    reset: () => set(initialState),
  })
)
