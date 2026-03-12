export interface components {
  schemas: {
    CaseType:
      | 'new_project'
      | 'bug_report'
      | 'fix_request'
      | 'feature_addition'
      | 'undetermined'
    CaseStatus:
      | 'draft'
      | 'interviewing'
      | 'analyzing'
      | 'estimating'
      | 'proposed'
      | 'approved'
      | 'rejected'
      | 'on_hold'
    Case: {
      id: string
      tenant_id: string
      title: string
      type: components['schemas']['CaseType']
      status: components['schemas']['CaseStatus']
      priority?: 'low' | 'medium' | 'high' | 'critical'
      business_line?: string
      existing_system_url?: string
      spec_markdown?: string
      created_by_uid?: string
      created_at: string
      updated_at?: string
    }
    ConversationTurn: {
      id: string
      case_id: string
      role: 'user' | 'assistant' | 'system'
      content: string
      metadata?: {
        category?: string
        confidence_score?: number
        is_complete?: boolean
        question_type?: 'open' | 'choice' | 'confirmation'
        choices?: string[]
      }
      created_at: string
    }
    SourceDocument: {
      id: string
      case_id?: string
      source_kind?: 'file_upload' | 'repository_url' | 'website_url'
      status?: 'pending' | 'processing' | 'completed' | 'failed'
      title?: string
    }
    Estimate: {
      id: string
      case_id?: string
      estimate_mode?: 'market_comparison' | 'hours_only' | 'hybrid'
      status?: 'draft' | 'ready' | 'approved' | 'rejected'
    }
    CaseWithDetails: components['schemas']['Case'] & {
      conversations?: components['schemas']['ConversationTurn'][]
      source_documents?: components['schemas']['SourceDocument'][]
      estimates?: components['schemas']['Estimate'][]
    }
    CreateCaseRequest: {
      title: string
      type: components['schemas']['CaseType']
      existing_system_url?: string
      company_name?: string
      contact_name?: string
      contact_email?: string
    }
    ErrorResponse: {
      error?: {
        code?: string
        message?: string
        details?: Record<string, unknown>
      }
    }
  }
}

type Case = components['schemas']['Case']
type CaseStatus = components['schemas']['CaseStatus']
type CaseType = components['schemas']['CaseType']
type CaseWithDetails = components['schemas']['CaseWithDetails']
type CreateCaseRequest = components['schemas']['CreateCaseRequest']
type ErrorResponse = components['schemas']['ErrorResponse']

export interface paths {
  '/v1/cases': {
    get: {
      parameters: {
        header: {
          'X-Tenant-ID': string
        }
        query?: {
          status?: CaseStatus
          type?: CaseType
          limit?: number
          offset?: number
        }
      }
      responses: {
        200: {
          content: {
            'application/json': {
              data?: Case[]
              total?: number
            }
          }
        }
        401: {
          content: {
            'application/json': ErrorResponse
          }
        }
        403: {
          content: {
            'application/json': ErrorResponse
          }
        }
        429: {
          content: {
            'application/json': ErrorResponse
          }
        }
      }
    }
    post: {
      parameters: {
        header: {
          'X-Tenant-ID': string
        }
      }
      requestBody: {
        content: {
          'application/json': CreateCaseRequest
        }
      }
      responses: {
        201: {
          content: {
            'application/json': {
              data?: Case
            }
          }
        }
        400: {
          content: {
            'application/json': ErrorResponse
          }
        }
        401: {
          content: {
            'application/json': ErrorResponse
          }
        }
        403: {
          content: {
            'application/json': ErrorResponse
          }
        }
        429: {
          content: {
            'application/json': ErrorResponse
          }
        }
      }
    }
  }
  '/v1/cases/{caseId}': {
    get: {
      parameters: {
        header: {
          'X-Tenant-ID': string
        }
        path: {
          caseId: string
        }
      }
      responses: {
        200: {
          content: {
            'application/json': {
              data?: CaseWithDetails
            }
          }
        }
        401: {
          content: {
            'application/json': ErrorResponse
          }
        }
        403: {
          content: {
            'application/json': ErrorResponse
          }
        }
        404: {
          content: {
            'application/json': ErrorResponse
          }
        }
        429: {
          content: {
            'application/json': ErrorResponse
          }
        }
      }
    }
  }
}
