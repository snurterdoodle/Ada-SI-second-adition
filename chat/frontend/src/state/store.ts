import { create } from 'zustand'
import {
  BUILD_STEPS,
  CHAT_MODEL_STORAGE_KEY,
  SECOND_MODEL_STORAGE_KEY,
  SYSTEM_STORAGE_KEY,
  VIEWER_PHASES,
} from '../constants'
import type {
  AppConfig,
  AssistantFeedItem,
  FeedItem,
  PhaseStatus,
  PipPackage,
  ProcessRun,
  ProcessStep,
  ProcessStepStatus,
  ToolPlanCardState,
  ToolPlanFeedItem,
  ToolSummary,
} from '../types/events'
import { createDefaultViewerPhases, createToolPlanCard } from '../types/events'
import { onSkillInstalled } from './progressionActions'
import { createFeedId } from '../utils/id'

type SidePanelTab = 'tools' | 'packages'

type AppState = {
  appConfig: AppConfig
  models: string[]
  chatModel: string
  toolCreatorModel: string
  systemInstructions: string
  systemPanelOpen: boolean
  conversation: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  feed: FeedItem[]
  processRuns: ProcessRun[]
  activeRunId: string | null
  isSending: boolean
  status: string
  statusIsError: boolean
  activeSidePanelTab: SidePanelTab
  tools: ToolSummary[]
  packages: PipPackage[]
  showScrollBottom: boolean
  abortController: AbortController | null
  runAbortControllers: Map<string, AbortController>

  setAppConfig: (config: AppConfig) => void
  setModels: (models: string[]) => void
  setChatModel: (model: string) => void
  setToolCreatorModel: (model: string) => void
  setSystemInstructions: (text: string) => void
  setSystemPanelOpen: (open: boolean) => void
  setStatus: (text: string, isError?: boolean) => void
  setIsSending: (active: boolean) => void
  setActiveSidePanelTab: (tab: SidePanelTab) => void
  setTools: (tools: ToolSummary[]) => void
  setPackages: (packages: PipPackage[]) => void
  setShowScrollBottom: (show: boolean) => void
  setAbortController: (controller: AbortController | null) => void
  bindRunAbortController: (runId: string) => AbortController
  clearRunAbortController: (runId: string) => void

  startNewChat: () => void
  addUserMessage: (content: string) => string
  addAssistantMessage: () => string
  updateAssistantMessage: (
    id: string,
    patch: Partial<Pick<AssistantFeedItem, 'reasoningText' | 'content' | 'streaming' | 'hidden'>>,
  ) => void
  removeFeedItem: (id: string) => void
  pushConversation: (message: { role: 'user' | 'assistant' | 'system'; content: string }) => void
  popConversation: () => void

  startProcessRun: (prompt: string, model: string) => string
  clearProcessRuns: () => void
  updateProcessStep: (
    runId: string,
    stepId: string,
    patch: { label: string; status: ProcessStepStatus; model?: string; detail?: string },
  ) => void
  registerBuildSteps: (runId: string) => void
  skipRemainingBuildSteps: (runId: string) => void
  stopActiveProcessStep: (runId: string, label?: string) => void
  setActiveRunId: (runId: string | null) => void

  findToolPlanByRun: (runId: string, planDraft?: boolean) => ToolPlanFeedItem | undefined
  findToolPlanByPlanId: (planId: string) => ToolPlanFeedItem | undefined
  ensureToolPlanDraft: (params: {
    runId: string
    planId?: string
    toolName?: string
    kind?: 'edit'
  }) => string
  updateToolPlanCard: (id: string, patch: Partial<ToolPlanCardState>) => void
  removeToolPlanCard: (id: string) => void
  completePlanDraft: (id: string) => void
  enterBuildingMode: (id: string, toolName: string) => void
  collapseToolPlan: (
    id: string,
    summary: string,
    status: string,
    statusClass: string,
  ) => void
  expandToolPlan: (id: string) => void
  collapseOtherToolPlans: (exceptId: string) => void
  setPipInstall: (id: string, pip: ToolPlanCardState['pipInstall']) => void
  appendViewerLog: (id: string, message: string, level?: 'info' | 'warn' | 'error') => void
  updateViewerPhase: (id: string, phaseId: string, status: PhaseStatus) => void
  showViewerSuccess: (id: string, message: string) => void
}

function loadStorage(key: string): string {
  return localStorage.getItem(key) || ''
}

function getProcessRun(runs: ProcessRun[], runId: string): ProcessRun | undefined {
  return runs.find((run) => run.runId === runId)
}

export const useAppStore = create<AppState>((set, get) => ({
  appConfig: {},
  models: [],
  chatModel: loadStorage(CHAT_MODEL_STORAGE_KEY),
  toolCreatorModel: loadStorage(SECOND_MODEL_STORAGE_KEY),
  systemInstructions: loadStorage(SYSTEM_STORAGE_KEY),
  systemPanelOpen: Boolean(loadStorage(SYSTEM_STORAGE_KEY)),
  conversation: [],
  feed: [],
  processRuns: [],
  activeRunId: null,
  isSending: false,
  status: '',
  statusIsError: false,
  activeSidePanelTab: 'tools',
  tools: [],
  packages: [],
  showScrollBottom: false,
  abortController: null,
  runAbortControllers: new Map(),

  setAppConfig: (config) => set({ appConfig: config }),
  setModels: (models) => set({ models }),
  setChatModel: (model) => {
    localStorage.setItem(CHAT_MODEL_STORAGE_KEY, model)
    set({ chatModel: model })
  },
  setToolCreatorModel: (model) => {
    localStorage.setItem(SECOND_MODEL_STORAGE_KEY, model)
    set({ toolCreatorModel: model })
  },
  setSystemInstructions: (text) => {
    localStorage.setItem(SYSTEM_STORAGE_KEY, text)
    set({ systemInstructions: text })
  },
  setSystemPanelOpen: (open) => set({ systemPanelOpen: open }),
  setStatus: (text, isError = false) => set({ status: text, statusIsError: isError }),
  setIsSending: (active) => set({ isSending: active }),
  setActiveSidePanelTab: (tab) => set({ activeSidePanelTab: tab }),
  setTools: (tools) => set({ tools }),
  setPackages: (packages) => set({ packages }),
  setShowScrollBottom: (show) => set({ showScrollBottom: show }),
  setAbortController: (controller) => set({ abortController: controller }),

  bindRunAbortController: (runId) => {
    const controller = new AbortController()
    const map = new Map(get().runAbortControllers)
    map.set(runId, controller)
    set({ runAbortControllers: map, abortController: controller })
    return controller
  },

  clearRunAbortController: (runId) => {
    const map = new Map(get().runAbortControllers)
    map.delete(runId)
    const current = get().abortController
    set({
      runAbortControllers: map,
      abortController: map.get(runId) === current ? null : current,
    })
  },

  startNewChat: () => {
    const { abortController, runAbortControllers } = get()
    if (abortController) abortController.abort()
    for (const controller of runAbortControllers.values()) {
      controller.abort()
    }
    set({
      conversation: [],
      feed: [],
      processRuns: [],
      activeRunId: null,
      status: '',
      statusIsError: false,
      showScrollBottom: false,
      abortController: null,
      runAbortControllers: new Map(),
    })
  },

  addUserMessage: (content) => {
    const id = createFeedId()
    set((state) => ({
      feed: [...state.feed, { id, type: 'user', content }],
    }))
    return id
  },

  addAssistantMessage: () => {
    const id = createFeedId()
    set((state) => ({
      feed: [
        ...state.feed,
        {
          id,
          type: 'assistant',
          reasoningText: '',
          content: '',
          streaming: true,
        },
      ],
    }))
    return id
  },

  updateAssistantMessage: (id, patch) => {
    set((state) => ({
      feed: state.feed.map((item) =>
        item.type === 'assistant' && item.id === id ? { ...item, ...patch } : item,
      ),
    }))
  },

  removeFeedItem: (id) => {
    set((state) => ({
      feed: state.feed.filter((item) => item.id !== id),
    }))
  },

  pushConversation: (message) => {
    set((state) => ({ conversation: [...state.conversation, message] }))
  },

  popConversation: () => {
    set((state) => ({ conversation: state.conversation.slice(0, -1) }))
  },

  startProcessRun: (prompt, model) => {
    const runId = crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '')
      : `run${Date.now().toString(36)}`

    const initialStep: ProcessStep = {
      stepId: 'lite_model',
      label: 'Lite model processing',
      status: 'active',
      model,
    }

    set((state) => ({
      processRuns: [
        ...state.processRuns,
        { runId, prompt, steps: [initialStep] },
      ],
      activeRunId: runId,
    }))

    return runId
  },

  clearProcessRuns: () => {
    const { runAbortControllers } = get()
    for (const controller of runAbortControllers.values()) {
      controller.abort()
    }
    set({
      processRuns: [],
      activeRunId: null,
      runAbortControllers: new Map(),
      abortController: null,
    })
  },

  updateProcessStep: (runId, stepId, patch) => {
    set((state) => ({
      processRuns: state.processRuns.map((run) => {
        if (run.runId !== runId) return run
        const existing = run.steps.find((s) => s.stepId === stepId)
        if (existing) {
          return {
            ...run,
            steps: run.steps.map((s) =>
              s.stepId === stepId ? { ...s, ...patch } : s,
            ),
          }
        }
        return {
          ...run,
          steps: [
            ...run.steps,
            { stepId, label: patch.label, status: patch.status, model: patch.model, detail: patch.detail },
          ],
        }
      }),
    }))
  },

  registerBuildSteps: (runId) => {
    for (const step of BUILD_STEPS) {
      get().updateProcessStep(runId, step.step_id, {
        label: step.label,
        status: 'pending',
      })
    }
  },

  skipRemainingBuildSteps: (runId) => {
    set((state) => ({
      processRuns: state.processRuns.map((run) => {
        if (run.runId !== runId) return run
        return {
          ...run,
          steps: run.steps.map((step) =>
            BUILD_STEPS.some((s) => s.step_id === step.stepId) &&
            step.status === 'pending'
              ? { ...step, status: 'skipped' as ProcessStepStatus }
              : step,
          ),
        }
      }),
    }))
  },

  stopActiveProcessStep: (runId, label = 'Stopped by user') => {
    const run = getProcessRun(get().processRuns, runId)
    if (!run) return
    for (const step of run.steps) {
      if (step.status === 'active') {
        get().updateProcessStep(runId, step.stepId, { label, status: 'error' })
      }
    }
    get().skipRemainingBuildSteps(runId)
  },

  setActiveRunId: (runId) => set({ activeRunId: runId }),

  findToolPlanByRun: (runId, planDraft) => {
    return get().feed.find(
      (item): item is ToolPlanFeedItem =>
        item.type === 'tool-plan' &&
        item.card.runId === runId &&
        (planDraft === undefined ||
          (planDraft
            ? item.card.mode === 'draft'
            : item.card.mode !== 'draft')),
    ) as ToolPlanFeedItem | undefined
  },

  findToolPlanByPlanId: (planId) => {
    return get().feed.find(
      (item): item is ToolPlanFeedItem =>
        item.type === 'tool-plan' && item.card.planId === planId,
    )
  },

  ensureToolPlanDraft: ({ runId, planId, toolName, kind }) => {
    const existing = get().findToolPlanByRun(runId, true)
    if (existing) {
      if (planId) {
        get().updateToolPlanCard(existing.id, { planId, toolName: toolName || existing.card.toolName, kind })
      }
      return existing.id
    }

    const id = createFeedId()
    const card = createToolPlanCard({
      id,
      runId,
      planId,
      toolName: toolName || 'Tool',
      kind,
      mode: 'draft',
    })

    set((state) => ({
      feed: [...state.feed, { id, type: 'tool-plan', card }],
    }))

    get().collapseOtherToolPlans(id)
    return id
  },

  updateToolPlanCard: (id, patch) => {
    set((state) => ({
      feed: state.feed.map((item) =>
        item.type === 'tool-plan' && item.id === id
          ? { ...item, card: { ...item.card, ...patch } }
          : item,
      ),
    }))
  },

  removeToolPlanCard: (id) => {
    set((state) => ({
      feed: state.feed.filter((item) => item.id !== id),
    }))
  },

  completePlanDraft: (id) => {
    get().updateToolPlanCard(id, { mode: 'pending' })
  },

  enterBuildingMode: (id, toolName) => {
    get().updateToolPlanCard(id, {
      mode: 'building',
      toolName,
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
      pipInstall: undefined,
    })
    get().collapseOtherToolPlans(id)
  },

  collapseToolPlan: (id, summary, status, statusClass) => {
    get().updateToolPlanCard(id, {
      mode: 'collapsed',
      collapsedSummary: summary,
      collapsedStatus: status,
      collapsedStatusClass: statusClass,
      busy: false,
    })
  },

  expandToolPlan: (id) => {
    const item = get().feed.find((f) => f.id === id && f.type === 'tool-plan') as
      | ToolPlanFeedItem
      | undefined
    if (!item) return
    const nextMode = item.card.lastSuccessMessage ? 'success' : 'building'
    get().updateToolPlanCard(id, { mode: nextMode })
    get().collapseOtherToolPlans(id)
  },

  collapseOtherToolPlans: (exceptId) => {
    const state = get()
    for (const item of state.feed) {
      if (item.type !== 'tool-plan' || item.id === exceptId) continue
      const { card } = item
      if (card.mode === 'collapsed') continue
      if (card.mode === 'success' || card.lastSuccessMessage) {
        get().collapseToolPlan(
          item.id,
          card.lastSuccessMessage || '',
          'Bound',
          'success',
        )
      } else if (card.mode === 'pending') {
        get().collapseToolPlan(item.id, '', 'Plan pending', 'pending')
      }
    }
  },

  setPipInstall: (id, pip) => {
    get().updateToolPlanCard(id, { pipInstall: pip })
  },

  appendViewerLog: (id, message, level = 'info') => {
    const item = get().feed.find((f) => f.id === id && f.type === 'tool-plan') as
      | ToolPlanFeedItem
      | undefined
    if (!item) return
    const prefix = level === 'error' ? '[ERROR] ' : level === 'warn' ? '[WARN] ' : ''
    get().updateToolPlanCard(id, {
      viewerOutput: [...item.card.viewerOutput, `${prefix}${message}`],
      codeTab: level === 'error' ? 'output' : item.card.codeTab,
      showCodeTabs: level === 'error' ? true : item.card.showCodeTabs,
    })
  },

  updateViewerPhase: (id, phaseId, status) => {
    const item = get().feed.find((f) => f.id === id && f.type === 'tool-plan') as
      | ToolPlanFeedItem
      | undefined
    if (!item) return
    get().updateToolPlanCard(id, {
      viewerPhases: { ...item.card.viewerPhases, [phaseId]: status },
    })
  },

  showViewerSuccess: (id, message) => {
    const item = get().feed.find(
      (f) => f.id === id && f.type === 'tool-plan',
    ) as ToolPlanFeedItem | undefined
    const toolName = item?.card.toolName || 'New Skill'
    const phases = Object.fromEntries(
      VIEWER_PHASES.map((p) => [p.id, 'done' as PhaseStatus]),
    )
    get().updateToolPlanCard(id, {
      viewerPhases: phases,
      viewerOutput: [...(item?.card.viewerOutput || []), message],
      codePanelTitle: 'Complete',
      codeTab: 'output',
      showCodeTabs: true,
      showRetry: false,
      lastSuccessMessage: message,
      mode: 'success',
      busy: false,
    })
    get().collapseToolPlan(id, message, 'Bound', 'success')
    onSkillInstalled(toolName)
  },
}))

export function buildMessages(): Array<{ role: string; content: string }> {
  const { systemInstructions, conversation } = useAppStore.getState()
  const messages: Array<{ role: string; content: string }> = []
  if (systemInstructions.trim()) {
    messages.push({ role: 'system', content: systemInstructions.trim() })
  }
  return messages.concat(conversation)
}

export function runHasActiveStep(runId: string): boolean {
  const run = getProcessRun(useAppStore.getState().processRuns, runId)
  return run?.steps.some((s) => s.status === 'active') ?? false
}
