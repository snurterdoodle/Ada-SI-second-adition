import type { SkillDataDocument, SkillUiConfig } from '../types/events'
import { parseErrorMessage } from '../utils/text'

export type SkillActionResponse = {
  ok: boolean
  result?: unknown
  data: SkillDataDocument
  error?: string
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text()
    try {
      const parsed = JSON.parse(text) as { detail?: { error?: string } | string }
      const detail = parsed.detail
      if (detail && typeof detail === 'object' && detail.error) {
        throw new Error(detail.error)
      }
      if (typeof detail === 'string') {
        throw new Error(detail)
      }
    } catch (err) {
      if (err instanceof Error && err.message !== text) {
        throw err
      }
    }
    throw new Error(parseErrorMessage(text))
  }
  return response.json() as Promise<T>
}

export async function fetchSkillData(skillName: string): Promise<SkillDataDocument> {
  return requestJson<SkillDataDocument>(`/api/skills/${encodeURIComponent(skillName)}/data`)
}

export async function callSkillAction(
  skillName: string,
  action: string,
  params: Record<string, unknown> = {},
): Promise<SkillActionResponse> {
  return requestJson<SkillActionResponse>(
    `/api/skills/${encodeURIComponent(skillName)}/action`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
    },
  )
}

export function resolveUiAction(
  ui: SkillUiConfig | undefined,
  key: keyof NonNullable<SkillUiConfig['actions']>,
): string | undefined {
  return ui?.actions?.[key]
}
