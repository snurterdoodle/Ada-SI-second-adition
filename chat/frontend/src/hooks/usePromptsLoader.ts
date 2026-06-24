import { fetchPrompts, savePrompts } from '../api/client'
import { useAppStore } from '../state/store'
import type { PromptsConfig } from '../types/events'

const LEGACY_SYSTEM_STORAGE_KEY = 'ada-si-system-instructions'

export function isPromptsConfigEmpty(prompts: PromptsConfig): boolean {
  return !prompts.scout_orchestrator_prefix.trim() && !prompts.forge_code_headless_prompt.trim()
}

export async function loadPromptsIntoStore(): Promise<void> {
  const { setPrompts } = useAppStore.getState()
  const promptsResponse = await fetchPrompts()
  const legacyDirectives = localStorage.getItem(LEGACY_SYSTEM_STORAGE_KEY)?.trim() || ''
  if (legacyDirectives && !promptsResponse.prompts.scout_additional_directives.trim()) {
    const migrated = {
      ...promptsResponse.prompts,
      scout_additional_directives: legacyDirectives,
    }
    const saved = await savePrompts(migrated)
    setPrompts(saved.prompts, saved.effective)
    localStorage.removeItem(LEGACY_SYSTEM_STORAGE_KEY)
    return
  }
  setPrompts(promptsResponse.prompts, promptsResponse.effective)
}
