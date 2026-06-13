export const PROGRESSION_STORAGE_KEY = 'ada-player-progress'

export const THINKING_EFFORT_STORAGE_KEY = 'ada-thinking-effort'

export const CHAT_MODEL_STORAGE_KEY = 'ada-si-chat-model'
export const SECOND_MODEL_STORAGE_KEY = 'ada-si-second-model'
export const SCROLL_THRESHOLD = 80
export const MAX_TEXTAREA_ROWS = 6

export const BUILD_STEPS = [
  { step_id: 'generate_code', label: 'Blueprint skill code' },
  { step_id: 'validate_code', label: 'Inspect module structure' },
  { step_id: 'sandbox_test', label: 'Trial in sandbox' },
  { step_id: 'ui_preview', label: 'Preview interactive app' },
  { step_id: 'pip_review', label: 'Review supply packages' },
  { step_id: 'runtime_verify', label: 'Verify skill runtime' },
  { step_id: 'install_tool', label: 'Unlock skill' },
] as const

export const VIEWER_PHASES = [
  { id: 'generate_code', label: 'Blueprint' },
  { id: 'validate_code', label: 'Inspect' },
  { id: 'sandbox_test', label: 'Trial' },
  { id: 'ui_preview', label: 'Preview' },
  { id: 'pip_review', label: 'Supplies' },
  { id: 'runtime_verify', label: 'Runtime' },
  { id: 'install_tool', label: 'Unlock' },
] as const
