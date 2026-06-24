import { useCallback } from 'react'
import {
  approveAllForgeBatchPlans,
  approveForgeBatchPlan,
  cancelForgeBatch,
  cancelRun,
  rejectForgeBatchPlan,
} from '../api/client'
import { consumeBuildStream, consumeSseStream } from '../api/sse'
import { useAppStore } from '../state/store'
import {
  createDefaultViewerPhases,
  createForgeBatchColumn,
  isAdaEvent,
  type AdaEvent,
  type PhaseStatus,
} from '../types/events'
import { captureSkillAppForTool } from '../utils/captureSkillAppScreenshot'
import { runScoutResumeStream } from '../lib/runScoutResumeStream'

function resolvePlanId(json: AdaEvent & { plan_id?: string; tool_name?: string }): string | undefined {
  if ('plan_id' in json && json.plan_id) {
    return json.plan_id
  }
  const toolName = 'tool_name' in json ? json.tool_name : undefined
  if (!toolName) return undefined
  const col = useAppStore.getState().forgeBatch?.tools.find((t) => t.toolName === toolName)
  return col?.planId
}

export function useForgeBatchStream() {
  const store = useAppStore()

  const appendColumnLog = useCallback(
    (planId: string, message: string, level: 'info' | 'warn' | 'error' = 'info') => {
      const col = store.findForgeBatchColumn(planId)
      if (!col) return
      const prefix = level === 'error' ? '[ERROR] ' : level === 'warn' ? '[WARN] ' : ''
      store.updateForgeBatchColumn(planId, {
        viewerOutput: [...col.viewerOutput, `${prefix}${message}`],
      })
    },
    [store],
  )

  const updateColumnPhase = useCallback(
    (planId: string, phaseId: string, status: PhaseStatus) => {
      const col = store.findForgeBatchColumn(planId)
      if (!col) return
      store.updateForgeBatchColumn(planId, {
        viewerPhases: { ...col.viewerPhases, [phaseId]: status },
      })
    },
    [store],
  )

  const handleBatchBuildEvent = useCallback(
    (json: AdaEvent): boolean => {
      const planId = resolvePlanId(json as AdaEvent & { plan_id?: string })
      if (!planId) return false

      if (json.ada_event === 'tool_build_phase') {
        updateColumnPhase(planId, json.phase, json.status)
        return false
      }
      if (json.ada_event === 'tool_build_log') {
        appendColumnLog(planId, json.message, json.level || 'info')
        return false
      }
      if (
        json.ada_event === 'forge_batch_code_thinking_delta' ||
        json.ada_event === 'tool_code_thinking_delta'
      ) {
        const col = store.findForgeBatchColumn(planId)
        if (col) {
          store.updateForgeBatchColumn(planId, {
            codeThinking: col.codeThinking + (json.delta || ''),
          })
        }
        return false
      }
      if (json.ada_event === 'forge_batch_code_delta' || json.ada_event === 'tool_code_delta') {
        const col = store.findForgeBatchColumn(planId)
        if (col) {
          store.updateForgeBatchColumn(planId, {
            codeStream: col.codeStream + (json.delta || ''),
            status: 'building',
          })
        }
        return false
      }
      if (json.ada_event === 'tool_code_ready') {
        store.updateForgeBatchColumn(planId, {
          toolCode: json.tool_code,
          testCode: json.test_code,
          status: 'building',
        })
        return false
      }
      if (json.ada_event === 'pip_install_pending') {
        store.updateForgeBatchColumn(planId, {
          status: 'pip_pending',
          pipInstall: {
            pipId: json.pip_id,
            packages: json.packages || [],
            alreadyInstalled: json.already_installed,
          },
        })
        appendColumnLog(
          planId,
          `New pip packages require approval: ${(json.packages || []).join(', ')}`,
          'warn',
        )
        return false
      }
      if (json.ada_event === 'ui_preview_pending') {
        store.updateForgeBatchColumn(planId, {
          status: 'ui_preview_pending',
          uiPreview: { previewId: json.preview_id, feedback: '' },
        })
        appendColumnLog(planId, 'Interactive app preview ready — try the popup.', 'info')
        return false
      }
      if (json.ada_event === 'preview_skill_app') {
        void import('../api/client').then(({ fetchTools, fetchConfig }) => {
          Promise.all([fetchTools(), fetchConfig()]).then(([tools, config]) => {
            store.setTools(tools)
            store.setAppConfig(config)
            store.openSkillApp(json.skill_name)
          })
        })
        return false
      }
      if (json.ada_event === 'tool_installed') {
        store.showForgeBatchColumnSuccess(planId, json.message)
        return false
      }
      if (json.ada_event === 'tool_build_failed') {
        store.updateForgeBatchColumn(planId, {
          status: 'failed',
          resultError: json.reason || 'Build failed.',
          busy: false,
        })
        if (json.logs) appendColumnLog(planId, json.logs, 'error')
        return false
      }
      if (json.ada_event === 'forge_batch_build_done') {
        return false
      }
      return false
    },
    [store, appendColumnLog, updateColumnPhase],
  )

  const handlePlanStreamEvent = useCallback(
    (json: AdaEvent) => {
      const planId = resolvePlanId(json as AdaEvent & { plan_id?: string })
      if (!planId) return

      if (json.ada_event === 'forge_batch_plan_started') {
        store.updateForgeBatchColumn(planId, {
          status: 'drafting',
          draftThinking: '',
          draftPlanText: '',
        })
        return
      }
      if (json.ada_event === 'forge_batch_plan_thinking_delta') {
        const col = store.findForgeBatchColumn(planId)
        if (col) {
          store.updateForgeBatchColumn(planId, {
            draftThinking: col.draftThinking + (json.delta || ''),
          })
        }
        return
      }
      if (json.ada_event === 'forge_batch_plan_content_delta') {
        const col = store.findForgeBatchColumn(planId)
        if (col) {
          store.updateForgeBatchColumn(planId, {
            draftPlanText: col.draftPlanText + (json.delta || ''),
          })
        }
        return
      }
      if (json.ada_event === 'forge_batch_plan_ready') {
        store.updateForgeBatchColumn(planId, {
          status: 'plan_ready',
          planMarkdown: json.plan,
          draftPlanText: json.plan,
          busy: false,
        })
        return
      }
      if (json.ada_event === 'forge_batch_plan_failed') {
        store.updateForgeBatchColumn(planId, {
          status: 'failed',
          resultError: json.reason || 'Plan drafting failed.',
          busy: false,
        })
      }
    },
    [store],
  )

  const resumeAgentAfterBatch = useCallback(async () => {
    const batch = useAppStore.getState().forgeBatch
    if (!batch) return

    await runScoutResumeStream({
      url: '/api/forge_batch/resume_agent',
      runId: batch.runId,
      body: { batch_id: batch.batchId },
    })
  }, [])

  const refreshToolsAfterBatch = useCallback(() => {
    void import('../api/client').then(({ fetchTools, fetchPipPackages }) => {
      Promise.all([fetchTools(), fetchPipPackages()]).then(([tools, packages]) => {
        store.setTools(tools)
        store.setPackages(packages)
      })
    })
  }, [store])

  const finishBatch = useCallback(async () => {
    await resumeAgentAfterBatch()
    refreshToolsAfterBatch()
    store.closeForgeBatch()
  }, [store, resumeAgentAfterBatch, refreshToolsAfterBatch])

  const maybeFinalizeBatch = useCallback(async () => {
    const batch = useAppStore.getState().forgeBatch
    if (!batch) return false

    const allTerminal = batch.tools.every((col) =>
      ['done', 'failed', 'skipped'].includes(col.status),
    )
    if (!allTerminal) return false

    await finishBatch()
    return true
  }, [finishBatch])

  const confirmBatch = useCallback(async () => {
    const batch = useAppStore.getState().forgeBatch
    if (!batch) return

    const columns = batch.proposedTools.map((tool) =>
      createForgeBatchColumn({
        planId: tool.plan_id,
        toolName: tool.tool_name,
        description: tool.description,
        status: 'queued',
      }),
    )
    store.initForgeBatchColumns(columns)

    const controller = store.bindRunAbortController(batch.runId)
    try {
      await consumeSseStream({
        url: '/api/forge_batch/confirm',
        body: { batch_id: batch.batchId, gemini_google_search: store.geminiGoogleSearch },
        signal: controller.signal,
        onPayload: (json) => {
          if (!isAdaEvent(json)) return
          handlePlanStreamEvent(json)
        },
      })
    } catch (error) {
      const err = error as Error
      if (err.name !== 'AbortError') {
        store.setStatus(`Batch plan drafting failed: ${err.message}`, true)
      }
    } finally {
      store.clearRunAbortController(batch.runId)
    }
  }, [store, handlePlanStreamEvent])

  const declineBatch = useCallback(async () => {
    const batch = useAppStore.getState().forgeBatch
    if (!batch) return
    try {
      await cancelForgeBatch(batch.batchId)
    } catch {
      // ignore
    }
    store.closeForgeBatch()
  }, [store])

  const approvePlan = useCallback(
    async (planId: string) => {
      const batch = useAppStore.getState().forgeBatch
      if (!batch) return
      try {
        await approveForgeBatchPlan(batch.batchId, planId)
        store.updateForgeBatchColumn(planId, { status: 'plan_approved' })
      } catch (error) {
        const err = error as Error
        store.setStatus(err.message, true)
      }
    },
    [store],
  )

  const approveAllPlans = useCallback(async () => {
    const batch = useAppStore.getState().forgeBatch
    if (!batch) return
    try {
      await approveAllForgeBatchPlans(batch.batchId)
      batch.tools.forEach((col) => {
        if (col.status === 'plan_ready') {
          store.updateForgeBatchColumn(col.planId, { status: 'plan_approved' })
        }
      })
    } catch (error) {
      const err = error as Error
      store.setStatus(err.message, true)
    }
  }, [store])

  const rejectPlan = useCallback(
    async (planId: string) => {
      const batch = useAppStore.getState().forgeBatch
      if (!batch) return
      try {
        await rejectForgeBatchPlan(batch.batchId, planId)
        store.updateForgeBatchColumn(planId, { status: 'skipped' })
      } catch (error) {
        const err = error as Error
        store.setStatus(err.message, true)
      }
    },
    [store],
  )

  const revisePlan = useCallback(
    async (planId: string, feedback: string) => {
      const batch = useAppStore.getState().forgeBatch
      if (!batch || !feedback.trim()) return

      store.updateForgeBatchColumn(planId, { busy: true, status: 'drafting' })
      const controller = store.bindRunAbortController(batch.runId)
      try {
        await consumeSseStream({
          url: '/api/forge_batch/revise_plan',
          body: {
            batch_id: batch.batchId,
            plan_id: planId,
            feedback,
            reasoning_effort: store.thinkingEffort,
            gemini_google_search: store.geminiGoogleSearch,
          },
          signal: controller.signal,
          onPayload: (json) => {
            if (!isAdaEvent(json)) return
            handlePlanStreamEvent(json)
          },
        })
      } catch (error) {
        const err = error as Error
        if (err.name !== 'AbortError') {
          store.setStatus(`Plan revision failed: ${err.message}`, true)
        }
      } finally {
        store.updateForgeBatchColumn(planId, { busy: false })
        store.clearRunAbortController(batch.runId)
      }
    },
    [store, handlePlanStreamEvent],
  )

  const startBuild = useCallback(
    async (planId?: string) => {
      const batch = useAppStore.getState().forgeBatch
      if (!batch) return

      const targetIds = planId
        ? [planId]
        : batch.tools.filter((c) => c.status === 'plan_approved').map((c) => c.planId)

      targetIds.forEach((id) => {
        store.updateForgeBatchColumn(id, {
          status: 'building',
          busy: true,
          viewerPhases: createDefaultViewerPhases(),
          viewerOutput: [],
          codeThinking: '',
          codeStream: '',
        })
      })

      const controller = store.bindRunAbortController(batch.runId)
      try {
        const response = await fetch('/api/forge_batch/start_build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batch_id: batch.batchId,
            plan_id: planId || undefined,
            tool_creator_model: store.toolCreatorModel,
            reasoning_effort: store.thinkingEffort,
            gemini_google_search: store.geminiGoogleSearch,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const { parseErrorMessage } = await import('../utils/text')
          throw new Error(parseErrorMessage(await response.text()))
        }

        let batchComplete = false
        await consumeBuildStream(response, (json) => {
          if (!isAdaEvent(json)) return
          if (json.ada_event === 'forge_batch_complete') {
            batchComplete = true
            return false
          }
          handleBatchBuildEvent(json)
          return false
        })

        if (batchComplete) {
          await finishBatch()
        }
      } catch (error) {
        const err = error as Error
        if (err.name !== 'AbortError') {
          store.setStatus(`Batch build failed: ${err.message}`, true)
        }
      } finally {
        targetIds.forEach((id) => store.updateForgeBatchColumn(id, { busy: false }))
        store.clearRunAbortController(batch.runId)
      }
    },
    [store, handleBatchBuildEvent, finishBatch],
  )

  const approvePipForColumn = useCallback(
    async (planId: string) => {
      const batch = useAppStore.getState().forgeBatch
      const col = store.findForgeBatchColumn(planId)
      if (!batch || !col?.pipInstall) return

      const { pipId } = col.pipInstall
      store.updateForgeBatchColumn(planId, {
        pipInstall: { ...col.pipInstall, busy: true },
      })

      const controller = store.bindRunAbortController(batch.runId)
      try {
        const response = await fetch('/api/approve_pip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pip_id: pipId,
            run_id: batch.runId,
            reasoning_effort: store.thinkingEffort,
            gemini_google_search: store.geminiGoogleSearch,
          }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const { parseErrorMessage } = await import('../utils/text')
          throw new Error(parseErrorMessage(await response.text()))
        }
        let batchComplete = false
        await consumeBuildStream(response, (json) => {
          if (!isAdaEvent(json)) return
          if (json.ada_event === 'forge_batch_complete') {
            batchComplete = true
            return false
          }
          handleBatchBuildEvent(json)
          return false
        })
        const after = store.findForgeBatchColumn(planId)
        store.updateForgeBatchColumn(planId, {
          pipInstall: undefined,
          busy: false,
          ...(after?.status === 'pip_pending' ? { status: 'building' } : {}),
        })
        if (batchComplete) {
          await finishBatch()
        } else {
          await maybeFinalizeBatch()
        }
      } catch (error) {
        const err = error as Error
        appendColumnLog(planId, err.message, 'error')
        store.updateForgeBatchColumn(planId, { pipInstall: undefined, busy: false })
      } finally {
        store.clearRunAbortController(batch.runId)
      }
    },
    [store, handleBatchBuildEvent, appendColumnLog, finishBatch, maybeFinalizeBatch],
  )

  const approvePreviewForColumn = useCallback(
    async (planId: string) => {
      const batch = useAppStore.getState().forgeBatch
      const col = store.findForgeBatchColumn(planId)
      if (!batch || !col?.uiPreview) return

      const controller = store.bindRunAbortController(batch.runId)
      try {
        const response = await fetch('/api/approve_preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            preview_id: col.uiPreview.previewId,
            run_id: batch.runId,
            reasoning_effort: store.thinkingEffort,
            gemini_google_search: store.geminiGoogleSearch,
          }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const { parseErrorMessage } = await import('../utils/text')
          throw new Error(parseErrorMessage(await response.text()))
        }
        let batchComplete = false
        await consumeBuildStream(response, (json) => {
          if (!isAdaEvent(json)) return
          if (json.ada_event === 'forge_batch_complete') {
            batchComplete = true
            return false
          }
          handleBatchBuildEvent(json)
          return false
        })
        const after = store.findForgeBatchColumn(planId)
        store.updateForgeBatchColumn(planId, {
          uiPreview: undefined,
          busy: false,
          ...(after?.status === 'ui_preview_pending' ? { status: 'building' } : {}),
        })
        if (batchComplete) {
          await finishBatch()
        } else {
          await maybeFinalizeBatch()
        }
      } catch (error) {
        const err = error as Error
        appendColumnLog(planId, err.message, 'error')
        store.updateForgeBatchColumn(planId, { uiPreview: undefined, busy: false })
      } finally {
        store.clearRunAbortController(batch.runId)
      }
    },
    [store, handleBatchBuildEvent, appendColumnLog, finishBatch, maybeFinalizeBatch],
  )

  const revisePreviewForColumn = useCallback(
    async (planId: string) => {
      const batch = useAppStore.getState().forgeBatch
      const col = store.findForgeBatchColumn(planId)
      if (!batch || !col?.uiPreview) return
      const feedback = col.uiPreview.feedback || ''
      if (!feedback.trim()) {
        store.setStatus('Describe preview changes first.', true)
        return
      }

      const screenshotBase64 = await captureSkillAppForTool(col.toolName)
      const controller = store.bindRunAbortController(batch.runId)
      try {
        const response = await fetch('/api/revise_preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            preview_id: col.uiPreview.previewId,
            run_id: batch.runId,
            feedback,
            screenshot_base64: screenshotBase64,
            reasoning_effort: store.thinkingEffort,
            gemini_google_search: store.geminiGoogleSearch,
          }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const { parseErrorMessage } = await import('../utils/text')
          throw new Error(parseErrorMessage(await response.text()))
        }
        await consumeBuildStream(response, (json) => {
          if (!isAdaEvent(json)) return
          handleBatchBuildEvent(json)
          return false
        })
      } catch (error) {
        const err = error as Error
        appendColumnLog(planId, err.message, 'error')
      } finally {
        store.clearRunAbortController(batch.runId)
      }
    },
    [store, handleBatchBuildEvent, appendColumnLog],
  )

  const cancelBatchRun = useCallback(async () => {
    const batch = useAppStore.getState().forgeBatch
    if (!batch) return
    await cancelRun(batch.runId)
  }, [])

  const allPlansDrafted = useCallback(() => {
    const batch = useAppStore.getState().forgeBatch
    if (!batch || batch.tools.length === 0) return false
    return batch.tools.every(
      (col) =>
        col.status === 'plan_ready' ||
        col.status === 'plan_approved' ||
        col.status === 'skipped' ||
        col.status === 'failed',
    )
  }, [])

  const countApproved = useCallback(() => {
    return (
      useAppStore.getState().forgeBatch?.tools.filter((c) => c.status === 'plan_approved')
        .length ?? 0
    )
  }, [])

  return {
    confirmBatch,
    declineBatch,
    approvePlan,
    approveAllPlans,
    rejectPlan,
    revisePlan,
    startBuild,
    approvePipForColumn,
    approvePreviewForColumn,
    revisePreviewForColumn,
    cancelBatchRun,
    allPlansDrafted,
    countApproved,
  }
}
