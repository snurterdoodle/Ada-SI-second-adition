export type ChatMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type SkillUiField = {
  key: string
  label: string
  type?: 'string' | 'text' | 'date' | 'boolean' | 'number'
}

export type SkillUiConfig = {
  template: 'calendar' | 'list' | 'table' | 'custom'
  freeform?: boolean
  entry?: string
  title_field?: string
  date_field?: string
  end_date_field?: string
  done_field?: string
  fields?: SkillUiField[]
  actions?: Record<string, string | undefined>
}

export type ToolSummary = {
  name: string
  description?: string
  kind?: 'headless' | 'interactive'
  display_name?: string
  icon?: string
  ui?: SkillUiConfig
  operations?: string[]
}

export type SkillDataDocument = {
  records: Array<Record<string, unknown>>
}

export type PipPackage = {
  name: string
  version?: string
  used_by?: string[]
}

export type SecretKey =
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'GEMINI_API_KEY'
  | 'GROQ_API_KEY'
  | 'ELEVENLABS_API_KEY'

export type SecretStatus = {
  configured: boolean
  hint: string
  source?: '' | 'env' | 'file'
}

export type SecretsStatusMap = Partial<Record<SecretKey, SecretStatus>>

export type TtsVoice = {
  voice_id: string
  name: string
}

export type PromptsConfig = {
  scout_orchestrator_prefix: string
  scout_orchestrator_suffix: string
  scout_additional_directives: string
  forge_runtime_context: string
  forge_plan_prompt: string
  forge_revise_plan_prompt: string
  forge_edit_plan_prompt: string
  forge_code_headless_prompt: string
  forge_code_interactive_builtin_prompt: string
  forge_code_interactive_custom_prompt: string
  forge_edit_code_headless_prompt: string
  forge_edit_code_interactive_builtin_prompt: string
  forge_edit_code_interactive_custom_prompt: string
  forge_preview_review_prompt: string
  forge_fix_preview_prompt: string
  forge_revise_preview_builtin_prompt: string
  forge_revise_preview_custom_prompt: string
  forge_fix_test_prompt: string
  forge_fix_codegen_prompt: string
  forge_fix_validation_prompt: string
  forge_fix_runtime_prompt: string
  tool_generate_new_description: string
  tool_edit_existing_description: string
  tool_propose_batch_description: string
}

export type EffectivePrompts = {
  scout_orchestrator: string
  scout_composed_system: string
  forge_plan: string
  forge_revise_plan: string
  forge_edit_plan: string
  forge_code_headless: string
  forge_code_interactive_builtin: string
  forge_code_interactive_custom: string
  forge_edit_code_headless: string
  forge_edit_code_interactive_builtin: string
  forge_edit_code_interactive_custom: string
  forge_preview_review: string
  forge_fix_preview: string
  forge_revise_preview_builtin: string
  forge_revise_preview_custom: string
  forge_fix_test: string
  forge_fix_codegen: string
  forge_fix_validation: string
  forge_fix_runtime: string
}

export type PromptsResponse = {
  prompts: PromptsConfig
  effective: EffectivePrompts
}

export type PersonaFileKey =
  | 'agents'
  | 'soul'
  | 'identity'
  | 'user'
  | 'tools'
  | 'memory'
  | 'heartbeat'

export type PersonaConfig = {
  heartbeat_enabled: boolean
  heartbeat_interval_minutes: number
}

export type PersonaResponse = {
  files: Record<PersonaFileKey, string>
  config: PersonaConfig
  heartbeat: Record<string, unknown>
  bootstrap_present: boolean
  persona_dir: string
  display_name?: string
  ok?: boolean
  suggested_opener?: string
}

/** @deprecated Use PromptsConfig */
export type ForgerGuidance = {
  forger_runtime_context: string
}

export type AppConfig = {
  lite_model?: string
  tool_creator_model?: string
  chat_model?: string
  second_model?: string
  tools?: ToolSummary[]
  tool_runtime_available?: boolean
  tool_runtime_url?: string
  lite_model_reasoning_effort?: string
}

export type ModelsResponse = {
  data?: Array<{ id: string }>
}

export type ProcessStepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'

export type ProcessStep = {
  stepId: string
  label: string
  status: ProcessStepStatus
  model?: string
  detail?: string
}

export type ProcessRun = {
  runId: string
  prompt: string
  steps: ProcessStep[]
}

export type PhaseStatus = 'pending' | 'active' | 'done' | 'error'

export type PipInstallState = {
  pipId: string
  packages: string[]
  alreadyInstalled?: string[]
  busy?: boolean
}

export type UiPreviewState = {
  previewId: string
  busy?: boolean
  feedback?: string
}

export type ToolPlanMode =
  | 'draft'
  | 'pending'
  | 'building'
  | 'success'
  | 'collapsed'

export type ToolPlanCardState = {
  id: string
  runId: string
  planId?: string
  toolName: string
  kind?: 'edit'
  mode: ToolPlanMode
  draftThinking: string
  draftPlanText: string
  planMarkdown: string
  feedback: string
  busy: boolean
  resultError?: string
  viewerPhases: Record<string, PhaseStatus>
  viewerOutput: string[]
  codeThinking: string
  codeStream: string
  toolCode: string
  testCode: string
  codeTab: 'tool' | 'test' | 'output'
  codePanelTitle: string
  showCodeTabs: boolean
  showCodeStream: boolean
  pipInstall?: PipInstallState
  uiPreview?: UiPreviewState
  collapsedSummary?: string
  collapsedStatus?: string
  collapsedStatusClass?: string
  lastSuccessMessage?: string
  showRetry: boolean
}

export type UserFeedItem = {
  id: string
  type: 'user'
  content: string
}

export type SearchSource = {
  title: string
  url: string
}

export type AssistantFeedItem = {
  id: string
  type: 'assistant'
  reasoningText: string
  content: string
  streaming: boolean
  hidden?: boolean
  searchSources?: SearchSource[]
}

export type ToolPlanFeedItem = {
  id: string
  type: 'tool-plan'
  card: ToolPlanCardState
}

export type FeedItem = UserFeedItem | AssistantFeedItem | ToolPlanFeedItem

export type AdaEventType =
  | 'process_step'
  | 'run_cancelled'
  | 'tool_plan_draft_started'
  | 'tool_plan_thinking_delta'
  | 'tool_plan_content_delta'
  | 'tool_plan_pending'
  | 'tool_plan_revised'
  | 'tool_plan_revise_failed'
  | 'tool_code_thinking_delta'
  | 'tool_code_delta'
  | 'tool_code_ready'
  | 'tool_build_phase'
  | 'tool_build_log'
  | 'pip_install_pending'
  | 'ui_preview_pending'
  | 'preview_skill_app'
  | 'tool_installed'
  | 'tool_build_failed'
  | 'open_skill_app'
  | 'skill_data_changed'
  | 'chat_error'
  | 'search_sources'
  | 'forge_batch_proposed'
  | 'forge_batch_plan_phase_started'
  | 'forge_batch_plan_phase_done'
  | 'forge_batch_plan_started'
  | 'forge_batch_plan_thinking_delta'
  | 'forge_batch_plan_content_delta'
  | 'forge_batch_plan_ready'
  | 'forge_batch_plan_failed'
  | 'forge_batch_build_started'
  | 'forge_batch_build_done'
  | 'forge_batch_complete'
  | 'forge_batch_code_thinking_delta'
  | 'forge_batch_code_delta'

export type ForgeBatchColumnStatus =
  | 'queued'
  | 'drafting'
  | 'plan_ready'
  | 'plan_approved'
  | 'building'
  | 'pip_pending'
  | 'ui_preview_pending'
  | 'done'
  | 'failed'
  | 'skipped'

export type ForgeBatchToolColumn = {
  planId: string
  toolName: string
  description: string
  status: ForgeBatchColumnStatus
  draftThinking: string
  draftPlanText: string
  planMarkdown: string
  feedback: string
  busy: boolean
  viewerPhases: Record<string, PhaseStatus>
  viewerOutput: string[]
  codeThinking: string
  codeStream: string
  toolCode: string
  testCode: string
  pipInstall?: PipInstallState
  uiPreview?: UiPreviewState
  resultError?: string
  lastSuccessMessage?: string
}

export type ForgeBatchModalMode = 'confirming' | 'expanded' | 'minimized' | 'closed'

export type ForgeBatchState = {
  batchId: string
  runId: string
  summary: string
  modalMode: ForgeBatchModalMode
  tools: ForgeBatchToolColumn[]
  proposedTools: Array<{ tool_name: string; description: string; plan_id: string }>
}

export type ProcessStepEvent = {
  ada_event: 'process_step'
  run_id: string
  step_id: string
  label: string
  status: ProcessStepStatus
  model?: string
  detail?: string
}

export type AdaEvent =
  | ProcessStepEvent
  | { ada_event: 'run_cancelled'; run_id: string }
  | {
      ada_event: 'tool_plan_draft_started'
      run_id: string
      plan_id?: string
      tool_name?: string
      kind?: 'edit'
    }
  | {
      ada_event: 'tool_plan_thinking_delta'
      run_id: string
      plan_id?: string
      delta?: string
    }
  | {
      ada_event: 'tool_plan_content_delta'
      run_id: string
      plan_id?: string
      delta?: string
    }
  | {
      ada_event: 'tool_plan_pending'
      run_id: string
      plan_id: string
      tool_name: string
      plan: string
      kind?: 'edit'
    }
  | { ada_event: 'tool_plan_revised'; plan: string }
  | { ada_event: 'tool_plan_revise_failed'; reason?: string }
  | { ada_event: 'tool_code_thinking_delta'; delta?: string }
  | { ada_event: 'tool_code_delta'; delta?: string }
  | {
      ada_event: 'tool_code_ready'
      tool_code: string
      test_code: string
    }
  | {
      ada_event: 'tool_build_phase'
      phase: string
      status: PhaseStatus
    }
  | {
      ada_event: 'tool_build_log'
      message: string
      level?: 'info' | 'warn' | 'error'
    }
  | {
      ada_event: 'pip_install_pending'
      pip_id: string
      run_id: string
      tool_name?: string
      packages?: string[]
      already_installed?: string[]
    }
  | {
      ada_event: 'ui_preview_pending'
      preview_id: string
      run_id: string
      plan_id?: string
      tool_name?: string
    }
  | { ada_event: 'preview_skill_app'; run_id: string; skill_name: string }
  | { ada_event: 'tool_installed'; message: string }
  | {
      ada_event: 'tool_build_failed'
      reason?: string
      logs?: string
    }
  | { ada_event: 'open_skill_app'; run_id: string; skill_name: string }
  | { ada_event: 'skill_data_changed'; run_id: string; skill_name: string }
  | { ada_event: 'persona_updated'; run_id: string; tool?: string; display_name?: string }
  | { ada_event: 'chat_error'; run_id?: string; detail?: string }
  | {
      ada_event: 'search_sources'
      run_id: string
      sources: SearchSource[]
    }
  | {
      ada_event: 'forge_batch_proposed'
      run_id: string
      batch_id: string
      summary: string
      tools: Array<{ tool_name: string; description: string; plan_id: string }>
    }
  | {
      ada_event: 'forge_batch_plan_phase_started' | 'forge_batch_plan_phase_done'
      run_id: string
      batch_id: string
    }
  | {
      ada_event: 'forge_batch_plan_started'
      run_id: string
      batch_id: string
      plan_id: string
      tool_name: string
    }
  | {
      ada_event: 'forge_batch_plan_thinking_delta' | 'forge_batch_plan_content_delta'
      run_id: string
      batch_id: string
      plan_id: string
      tool_name?: string
      delta?: string
    }
  | {
      ada_event: 'forge_batch_plan_ready'
      run_id: string
      batch_id: string
      plan_id: string
      tool_name: string
      plan: string
    }
  | {
      ada_event: 'forge_batch_plan_failed'
      run_id: string
      batch_id: string
      plan_id: string
      tool_name?: string
      reason?: string
    }
  | {
      ada_event: 'forge_batch_build_started' | 'forge_batch_build_done'
      run_id: string
      batch_id: string
      plan_id: string
      tool_name?: string
      status?: string
    }
  | {
      ada_event: 'forge_batch_complete'
      run_id: string
      batch_id: string
      summary: string
    }
  | {
      ada_event: 'forge_batch_code_thinking_delta' | 'forge_batch_code_delta'
      run_id: string
      batch_id: string
      plan_id: string
      tool_name?: string
      delta?: string
    }

export type OpenAIStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string
      reasoning_content?: string
      reasoning?: string
      thinking?: string
      thinking_blocks?: Array<string | { thinking?: string; text?: string }>
    }
  }>
  ada_event?: AdaEventType
}

export type StreamPayload = AdaEvent | OpenAIStreamChunk

export function isAdaEvent(payload: StreamPayload): payload is AdaEvent {
  return typeof (payload as AdaEvent).ada_event === 'string'
}

export function extractReasoningFromDelta(
  delta: NonNullable<OpenAIStreamChunk['choices']>[0]['delta'],
): string {
  if (!delta) return ''
  let reasoning = delta.reasoning_content || delta.reasoning || delta.thinking || ''
  const blocks = delta.thinking_blocks
  if (Array.isArray(blocks)) {
    reasoning += blocks
      .map((block) =>
        typeof block === 'string' ? block : block.thinking || block.text || '',
      )
      .join('')
  }
  return reasoning
}

export function createDefaultViewerPhases(): Record<string, PhaseStatus> {
  return {
    generate_code: 'pending',
    validate_code: 'pending',
    sandbox_test: 'pending',
    validate_ui: 'pending',
    contract_test: 'pending',
    preview_review: 'pending',
    ui_preview: 'pending',
    pip_review: 'pending',
    runtime_verify: 'pending',
    install_tool: 'pending',
  }
}

export function createForgeBatchColumn(
  partial: Pick<ForgeBatchToolColumn, 'planId' | 'toolName' | 'description'> &
    Partial<ForgeBatchToolColumn>,
): ForgeBatchToolColumn {
  return {
    status: 'queued',
    draftThinking: '',
    draftPlanText: '',
    planMarkdown: '',
    feedback: '',
    busy: false,
    viewerPhases: createDefaultViewerPhases(),
    viewerOutput: [],
    codeThinking: '',
    codeStream: '',
    toolCode: '',
    testCode: '',
    ...partial,
  }
}

export function createToolPlanCard(
  partial: Partial<ToolPlanCardState> & Pick<ToolPlanCardState, 'id' | 'runId' | 'toolName'>,
): ToolPlanCardState {
  return {
    mode: 'draft',
    draftThinking: '',
    draftPlanText: '',
    planMarkdown: '',
    feedback: '',
    busy: false,
    viewerPhases: createDefaultViewerPhases(),
    viewerOutput: [],
    codeThinking: '',
    codeStream: '',
    toolCode: '',
    testCode: '',
    codeTab: 'tool',
    codePanelTitle: 'Generating…',
    showCodeTabs: false,
    showCodeStream: true,
    showRetry: false,
    ...partial,
  }
}
