import type {
  AppConfig,
  ModelsResponse,
  PipPackage,
  PromptsConfig,
  PromptsResponse,
  SkillDataDocument,
  ToolSummary,
} from '../types/events'
import { parseErrorMessage } from '../utils/text'

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(parseErrorMessage(await response.text()))
  }
  return response.json() as Promise<T>
}

export async function fetchPrompts(): Promise<PromptsResponse> {
  return requestJson<PromptsResponse>('/api/prompts')
}

export async function savePrompts(prompts: PromptsConfig): Promise<PromptsResponse> {
  return requestJson<PromptsResponse>('/api/prompts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompts }),
  })
}

export async function resetPrompts(): Promise<PromptsResponse> {
  return requestJson<PromptsResponse>('/api/prompts/reset', { method: 'POST' })
}

export async function fetchConfig(): Promise<AppConfig> {
  try {
    return await requestJson<AppConfig>('/api/config')
  } catch {
    return {}
  }
}

export async function fetchModels(): Promise<string[]> {
  const data = await requestJson<ModelsResponse>('/api/models')
  return (data.data || []).map((item) => item.id).filter(Boolean)
}

export async function fetchTools(): Promise<ToolSummary[]> {
  const data = await requestJson<{ tools: ToolSummary[] }>('/api/tools')
  return data.tools || []
}

export async function fetchSkillData(skillName: string): Promise<SkillDataDocument> {
  return requestJson<SkillDataDocument>(`/api/skills/${encodeURIComponent(skillName)}/data`)
}

export async function saveSkillData(
  skillName: string,
  data: SkillDataDocument,
): Promise<SkillDataDocument> {
  return requestJson<SkillDataDocument>(`/api/skills/${encodeURIComponent(skillName)}/data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteTool(toolName: string): Promise<void> {
  await requestJson(`/api/tools/${encodeURIComponent(toolName)}`, { method: 'DELETE' })
}

export async function fetchPipPackages(): Promise<PipPackage[]> {
  const data = await requestJson<{ packages: PipPackage[] }>('/api/pip/packages')
  return data.packages || []
}

export async function deletePipPackage(packageName: string): Promise<void> {
  await requestJson(`/api/pip/packages/${encodeURIComponent(packageName)}`, {
    method: 'DELETE',
  })
}

export async function cancelRun(runId: string): Promise<void> {
  try {
    await fetch('/api/cancel_run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: runId }),
    })
  } catch {
    // Best-effort
  }
}

export async function rejectTool(planId: string): Promise<void> {
  await requestJson('/api/reject_tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_id: planId }),
  })
}

export async function rejectPip(pipId: string, runId: string): Promise<void> {
  await requestJson('/api/reject_pip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pip_id: pipId, run_id: runId }),
  })
}

export async function rejectPreview(previewId: string, runId: string): Promise<void> {
  await requestJson('/api/reject_preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preview_id: previewId, run_id: runId }),
  })
}
