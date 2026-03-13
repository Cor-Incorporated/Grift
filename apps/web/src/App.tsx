import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { CaseCreate } from '@/pages/CaseCreate'
import { CaseDetail } from '@/pages/CaseDetail'
import { CaseList } from '@/pages/CaseList'
import { Dashboard } from '@/pages/Dashboard'
import { CaseConversation } from '@/pages/cases/CaseConversation'
import { NotFound } from '@/pages/NotFound'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'cases', element: <CaseList /> },
      { path: 'cases/new', element: <CaseCreate /> },
      { path: 'cases/:caseId', element: <CaseDetail /> },
      { path: 'cases/:caseId/conversation', element: <CaseConversation /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
