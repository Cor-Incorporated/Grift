import { type ChangeEvent, type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  apiClient,
  caseTypeLabels,
  caseTypeOptions,
  DEFAULT_TENANT_ID,
  getApiErrorMessage,
  type CaseType,
} from '@/lib/api-client'

type FormValues = {
  title: string
  type: CaseType | ''
  companyName: string
  contactName: string
  contactEmail: string
  existingSystemUrl: string
}

type FormErrors = Partial<Record<keyof FormValues, string>>

const initialFormValues: FormValues = {
  title: '',
  type: '',
  companyName: '',
  contactName: '',
  contactEmail: '',
  existingSystemUrl: '',
}

function isValidOptionalUrl(value: string) {
  if (!value) {
    return true
  }

  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function isValidOptionalEmail(value: string) {
  if (!value) {
    return true
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
}

function validateForm(values: FormValues): FormErrors {
  const errors: FormErrors = {}

  if (!values.title.trim()) {
    errors.title = 'Title is required.'
  }

  if (!values.type) {
    errors.type = 'Type is required.'
  }

  if (!isValidOptionalEmail(values.contactEmail.trim())) {
    errors.contactEmail = 'Enter a valid email address.'
  }

  if (!isValidOptionalUrl(values.existingSystemUrl.trim())) {
    errors.existingSystemUrl = 'Enter a valid URL.'
  }

  return errors
}

export function CaseCreate() {
  const navigate = useNavigate()
  const [values, setValues] = useState<FormValues>(initialFormValues)
  const [errors, setErrors] = useState<FormErrors>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function handleFieldChange(
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    const { name, value } = event.target
    const fieldName = name as keyof FormValues

    setValues((currentValues) => ({
      ...currentValues,
      [fieldName]: value,
    }))

    setErrors((currentErrors) => {
      const nextErrors = { ...currentErrors }
      delete nextErrors[fieldName]
      return nextErrors
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextErrors = validateForm(values)
    setErrors(nextErrors)
    setErrorMessage(null)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setIsSubmitting(true)

    try {
      const { data, error } = await apiClient.POST('/v1/cases', {
        params: {
          header: { 'X-Tenant-ID': DEFAULT_TENANT_ID },
        },
        body: {
          title: values.title.trim(),
          type: values.type as CaseType,
          ...(values.companyName.trim()
            ? { company_name: values.companyName.trim() }
            : {}),
          ...(values.contactName.trim()
            ? { contact_name: values.contactName.trim() }
            : {}),
          ...(values.contactEmail.trim()
            ? { contact_email: values.contactEmail.trim() }
            : {}),
          ...(values.existingSystemUrl.trim()
            ? { existing_system_url: values.existingSystemUrl.trim() }
            : {}),
        },
      })

      if (error) {
        setErrorMessage(getApiErrorMessage(error, 'Unable to create case.'))
        setIsSubmitting(false)
        return
      }

      const createdCase = data?.data

      if (!createdCase?.id) {
        setErrorMessage('The API response did not include a case id.')
        setIsSubmitting(false)
        return
      }

      navigate(`/cases/${createdCase.id}`)
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Unable to create case.'))
      setIsSubmitting(false)
    }
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm font-medium text-slate-500">Cases</p>
        <h1 className="text-balance text-3xl font-semibold text-slate-950">
          Create a new case
        </h1>
        <p className="max-w-2xl text-pretty text-sm text-slate-600">
          Capture the intake basics first. You can add more context after the
          case is created.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <form className="space-y-6" onSubmit={handleSubmit} noValidate>
          <div className="grid gap-6 md:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
              <span>Title</span>
              <input
                name="title"
                value={values.title}
                onChange={handleFieldChange}
                aria-invalid={Boolean(errors.title)}
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
                placeholder="Enterprise operations dashboard refresh"
              />
              {errors.title ? (
                <span className="text-sm text-rose-700">{errors.title}</span>
              ) : null}
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Type</span>
              <select
                name="type"
                value={values.type}
                onChange={handleFieldChange}
                aria-invalid={Boolean(errors.type)}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
              >
                <option value="">Select a type</option>
                {caseTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {caseTypeLabels[type]}
                  </option>
                ))}
              </select>
              {errors.type ? (
                <span className="text-sm text-rose-700">{errors.type}</span>
              ) : null}
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Existing system URL</span>
              <input
                name="existingSystemUrl"
                type="url"
                value={values.existingSystemUrl}
                onChange={handleFieldChange}
                aria-invalid={Boolean(errors.existingSystemUrl)}
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
                placeholder="https://example.com"
              />
              {errors.existingSystemUrl ? (
                <span className="text-sm text-rose-700">
                  {errors.existingSystemUrl}
                </span>
              ) : null}
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Company name</span>
              <input
                name="companyName"
                value={values.companyName}
                onChange={handleFieldChange}
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
                placeholder="Acme Corp."
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Contact name</span>
              <input
                name="contactName"
                value={values.contactName}
                onChange={handleFieldChange}
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
                placeholder="Keiko Tanaka"
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Contact email</span>
              <input
                name="contactEmail"
                type="email"
                value={values.contactEmail}
                onChange={handleFieldChange}
                aria-invalid={Boolean(errors.contactEmail)}
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
                placeholder="keiko.tanaka@example.com"
              />
              {errors.contactEmail ? (
                <span className="text-sm text-rose-700">
                  {errors.contactEmail}
                </span>
              ) : null}
            </label>
          </div>

          {errorMessage ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create case'}
            </button>
            <Link
              to="/cases"
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950"
            >
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </main>
  )
}
