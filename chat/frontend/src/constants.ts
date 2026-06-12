export const CHAT_MODEL_STORAGE_KEY = 'ada-si-chat-model'
export const SECOND_MODEL_STORAGE_KEY = 'ada-si-second-model'
export const SYSTEM_STORAGE_KEY = 'ada-si-system-instructions'
export const PROGRESS_STORAGE_KEY = 'ada-si-progress'
export const SOUND_STORAGE_KEY = 'ada-si-sound'
export const SCROLL_THRESHOLD = 80
export const MAX_TEXTAREA_ROWS = 6

export const COMPANION_NAME = 'ADA'

export const BUILD_STEPS = [
  { step_id: 'generate_code', label: 'Forging skill code' },
  { step_id: 'validate_code', label: 'Validating blueprint' },
  { step_id: 'sandbox_test', label: 'Trial in the sandbox' },
  { step_id: 'pip_review', label: 'Reviewing modules' },
  { step_id: 'runtime_verify', label: 'Runtime verification' },
  { step_id: 'install_tool', label: 'Binding skill to ADA' },
] as const

export const VIEWER_PHASES = [
  { id: 'generate_code', label: 'Forge' },
  { id: 'validate_code', label: 'Validate' },
  { id: 'sandbox_test', label: 'Trial' },
  { id: 'pip_review', label: 'Modules' },
  { id: 'runtime_verify', label: 'Runtime' },
  { id: 'install_tool', label: 'Bind' },
] as const

export const XP_CHAT_BASE = 20
export const XP_CHAT_LENGTH_BONUS_MAX = 15
export const XP_PLAN_APPROVED = 50
export const XP_SKILL_INSTALLED = 500
export const XP_AWARD_COOLDOWN_MS = 800
