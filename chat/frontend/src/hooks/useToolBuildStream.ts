import { useCallback } from 'react'
import { rejectPip, rejectTool } from '../api/client'
import { consumeBuildStream, consumeSseStream } from '../api/sse'
import { VIEWER_PHASES } from '../constants'
import { awardPlanApprovedXp } from '../state/progressionActions'
import { useAppStore } from '../state/store'
import { isAdaEvent, type AdaEvent } from '../types/events'

export function useToolBuildStream() {
  const store = useAppStore()

  const handleAdaEvent = useCallback((json: AdaEvent): boolean => {
    if (json.ada_event === 'process_step') {
      store.updateProcessStep(json.run_id, json.step_id, {
        label: json.label,
        status: json.status,
        model: json.model,
        detail: json.detail,
      })
      return true
    }
    if (json.ada_event === 'run_cancelled') {
      store.stopActiveProcessStep(json.run_id)
      return true
    }
    return false
  }, [store])

  const handleBuildSseEvent = useCallback(
    (cardId: string, json: AdaEvent): boolean => {
      if (json.ada_event === 'tool_build_phase') {
        store.updateViewerPhase(cardId, json.phase, json.status)
        if (json.phase === 'pip_review' && json.status === 'done') {
          void refreshPackages()
        }
        return false
      }
      if (json.ada_event === 'tool_build_log') {
        store.appendViewerLog(cardId, json.message, json.level || 'info')
        return false
      }
      if (json.ada_event === 'tool_code_thinking_delta') {
        const item = useAppStore.getState().feed.find(
          (f) => f.id === cardId && f.type === 'tool-plan',
        )
        if (item && item.type === 'tool-plan') {
          store.updateToolPlanCard(cardId, {
            codeThinking: item.card.codeThinking + (json.delta || ''),
          })
        }
        return false
      }
      if (json.ada_event === 'tool_code_delta') {
        const item = useAppStore.getState().feed.find(
          (f) => f.id === cardId && f.type === 'tool-plan',
        )
        if (item && item.type === 'tool-plan') {
          store.updateToolPlanCard(cardId, {
            codeStream: item.card.codeStream + (json.delta || ''),
          })
        }
        return false
      }
      if (json.ada_event === 'tool_code_ready') {
        store.updateToolPlanCard(cardId, {
          toolCode: json.tool_code,
          testCode: json.test_code,
          codePanelTitle: 'Generated code',
          showCodeTabs: true,
          showCodeStream: false,
          codeTab: 'tool',
        })
        return false
      }
      if (json.ada_event === 'pip_install_pending') {
        store.updateViewerPhase(cardId, 'pip_review', 'active')
        const pkgList = (json.packages || []).join(', ')
        store.appendViewerLog(
          cardId,
          `New pip packages require approval: ${pkgList}`,
          'warn',
        )
        store.setPipInstall(cardId, {
          pipId: json.pip_id,
          packages: json.packages || [],
          alreadyInstalled: json.already_installed,
        })
        return false
      }
      if (json.ada_event === 'process_step') {
        const mapped = VIEWER_PHASES.find((p) => p.id === json.step_id)
        if (mapped && json.status !== 'skipped') {
          store.updateViewerPhase(cardId, json.step_id, json.status)
        }
        return true
      }
      return true
    },
    [store],
  )

  const refreshTools = useCallback(async () => {
    try {
      const { fetchTools, fetchConfig } = await import('../api/client')
      const tools = await fetchTools()
      store.setTools(tools)
      const config = await fetchConfig()
      store.setAppConfig(config)
    } catch {
      // ignore
    }
  }, [store])

  const refreshPackages = useCallback(async () => {
    try {
      const { fetchPipPackages } = await import('../api/client')
      const packages = await fetchPipPackages()
      store.setPackages(packages)
    } catch {
      // ignore
    }
  }, [store])

  const runToolBuild = useCallback(
    async (cardId: string, planId: string, runId: string) => {
      const item = useAppStore.getState().feed.find(
        (f) => f.id === cardId && f.type === 'tool-plan',
      )
      if (!item || item.type !== 'tool-plan') return

      const toolName = item.card.toolName
      const effectiveRunId = runId || item.card.runId
      const controller = store.bindRunAbortController(effectiveRunId)

      store.enterBuildingMode(cardId, toolName)
      store.updateToolPlanCard(cardId, { busy: true, showRetry: false })
      store.setStatus('')
      awardPlanApprovedXp()

      try {
        const response = await fetch('/api/approve_tool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan_id: planId,
            run_id: effectiveRunId,
            tool_creator_model: store.toolCreatorModel,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const { parseErrorMessage } = await import('../utils/text')
          throw new Error(parseErrorMessage(await response.text()))
        }

        const buildResult = await consumeBuildStream(response, (json) => {
          if (isAdaEvent(json) && handleAdaEvent(json)) return
          return handleBuildSseEvent(cardId, json as AdaEvent)
        })

        if (buildResult?.status === 'success') {
          store.showViewerSuccess(cardId, buildResult.message)
          store.pushConversation({
            role: 'assistant',
            content: `[System] ${buildResult.message}`,
          })
          await refreshTools()
          await refreshPackages()
          store.setStatus('')
        } else if (buildResult?.status === 'pip_pending') {
          store.updateToolPlanCard(cardId, { busy: false })
          store.setStatus('New pip packages require your approval.')
        } else if (buildResult?.status === 'failed') {
          const reason = buildResult.reason || 'Build failed.'
          store.appendViewerLog(cardId, reason, 'error')
          if (buildResult.logs) store.appendViewerLog(cardId, buildResult.logs, 'error')
          store.updateToolPlanCard(cardId, { busy: false, showRetry: true })
          const isCodegen =
            /json|tool_code|parse|missing tool_code/i.test(reason) && !buildResult.logs
          store.setStatus(
            isCodegen ? 'Code generation failed.' : 'Tool verification failed.',
            true,
          )
        }
      } catch (error) {
        const err = error as Error
        if (err.name === 'AbortError') {
          store.appendViewerLog(cardId, 'Build stopped by user.', 'warn')
          store.updateToolPlanCard(cardId, { busy: false, showRetry: true })
          return
        }
        store.appendViewerLog(cardId, err.message, 'error')
        store.updateToolPlanCard(cardId, { busy: false, showRetry: true })
        store.setStatus(`Approval failed: ${err.message}`, true)
      } finally {
        store.clearRunAbortController(effectiveRunId)
      }
    },
    [store, handleAdaEvent, handleBuildSseEvent, refreshTools, refreshPackages],
  )

  const runPipContinuation = useCallback(
    async (cardId: string, pipId: string, runId: string) => {
      const item = useAppStore.getState().feed.find(
        (f) => f.id === cardId && f.type === 'tool-plan',
      )
      if (!item || item.type !== 'tool-plan') return

      const effectiveRunId = runId || item.card.runId
      const controller = store.bindRunAbortController(effectiveRunId)

      store.updateToolPlanCard(cardId, {
        pipInstall: { ...item.card.pipInstall!, busy: true },
      })
      store.appendViewerLog(cardId, 'Installing approved pip packages…')

      try {
        const response = await fetch('/api/approve_pip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pip_id: pipId, run_id: effectiveRunId }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const { parseErrorMessage } = await import('../utils/text')
          throw new Error(parseErrorMessage(await response.text()))
        }

        const buildResult = await consumeBuildStream(response, (json) => {
          if (isAdaEvent(json) && handleAdaEvent(json)) return
          if (
            isAdaEvent(json) &&
            json.ada_event === 'pip_install_pending'
          ) {
            store.setPipInstall(cardId, {
              pipId: json.pip_id,
              packages: json.packages || [],
              alreadyInstalled: json.already_installed,
            })
            return false
          }
          return handleBuildSseEvent(cardId, json as AdaEvent)
        })

        store.setPipInstall(cardId, undefined)

        if (buildResult?.status === 'success') {
          store.showViewerSuccess(cardId, buildResult.message)
          store.pushConversation({
            role: 'assistant',
            content: `[System] ${buildResult.message}`,
          })
          await refreshTools()
          await refreshPackages()
          store.setStatus('')
        } else if (buildResult?.status === 'failed') {
          const reason = buildResult.reason || 'Build failed after pip install.'
          store.appendViewerLog(cardId, reason, 'error')
          if (buildResult.logs) store.appendViewerLog(cardId, buildResult.logs, 'error')
          store.updateToolPlanCard(cardId, { busy: false, showRetry: true })
          store.setStatus('Tool verification failed.', true)
        } else if (buildResult?.status === 'pip_pending') {
          store.updateToolPlanCard(cardId, { busy: false })
          store.setStatus('Additional pip packages require approval.')
        }
      } catch (error) {
        const err = error as Error
        if (err.name === 'AbortError') {
          store.appendViewerLog(cardId, 'Pip install stopped by user.', 'warn')
          store.updateToolPlanCard(cardId, {
            pipInstall: item.card.pipInstall
              ? { ...item.card.pipInstall, busy: false }
              : undefined,
          })
          return
        }
        store.appendViewerLog(cardId, err.message, 'error')
        store.updateToolPlanCard(cardId, {
          pipInstall: item.card.pipInstall
            ? { ...item.card.pipInstall, busy: false }
            : undefined,
        })
        store.setStatus(`Pip approval failed: ${err.message}`, true)
      } finally {
        store.clearRunAbortController(effectiveRunId)
      }
    },
    [store, handleAdaEvent, handleBuildSseEvent, refreshTools, refreshPackages],
  )

  const handlePipRejection = useCallback(
    async (cardId: string, pipId: string, runId: string) => {
      try {
        await rejectPip(pipId, runId)
        store.setPipInstall(cardId, undefined)
        store.updateViewerPhase(cardId, 'pip_review', 'error')
        store.appendViewerLog(cardId, 'Pip install rejected — build cancelled.', 'error')
        store.updateToolPlanCard(cardId, { busy: false, showRetry: true })
        store.setStatus('Pip install rejected.')
      } catch (error) {
        store.setStatus(`Reject failed: ${(error as Error).message}`, true)
      }
    },
    [store],
  )

  const handleToolRevision = useCallback(
    async (cardId: string, planId: string, runId: string, feedback: string) => {
      if (!feedback.trim()) {
        store.setStatus('Describe the changes you want before requesting a revision.', true)
        return
      }

      const effectiveRunId = runId
      const controller = store.bindRunAbortController(effectiveRunId)
      store.updateToolPlanCard(cardId, { busy: true, resultError: undefined, mode: 'draft' })

      try {
        await consumeSseStream({
          url: '/api/revise_tool',
          body: {
            plan_id: planId,
            run_id: effectiveRunId,
            feedback,
            tool_creator_model: store.toolCreatorModel,
          },
          signal: controller.signal,
          onPayload: (json) => {
            if (isAdaEvent(json)) {
              if (handleAdaEvent(json)) return
              if (json.ada_event === 'tool_plan_draft_started') {
                store.ensureToolPlanDraft({
                  runId: json.run_id,
                  planId: json.plan_id,
                  toolName: json.tool_name,
                  kind: json.kind,
                })
                return
              }
              if (json.ada_event === 'tool_plan_thinking_delta') {
                const item = store.findToolPlanByRun(json.run_id, true)
                if (item) {
                  store.updateToolPlanCard(item.id, {
                    draftThinking: item.card.draftThinking + (json.delta || ''),
                  })
                }
                return
              }
              if (json.ada_event === 'tool_plan_content_delta') {
                const item = store.findToolPlanByRun(json.run_id, true)
                if (item) {
                  store.updateToolPlanCard(item.id, {
                    draftPlanText: item.card.draftPlanText + (json.delta || ''),
                  })
                }
                return
              }
              if (json.ada_event === 'tool_plan_revised') {
                store.updateToolPlanCard(cardId, {
                  planMarkdown: json.plan,
                  mode: 'pending',
                  feedback: '',
                })
                store.completePlanDraft(cardId)
                store.pushConversation({
                  role: 'assistant',
                  content: `[System] Tool plan revised based on your feedback: "${feedback}"`,
                })
                store.setStatus('')
                return
              }
              if (json.ada_event === 'tool_plan_revise_failed') {
                throw new Error(json.reason || 'Plan revision failed.')
              }
            }
          },
        })

        const item = useAppStore.getState().feed.find(
          (f) => f.id === cardId && f.type === 'tool-plan',
        )
        if (item && item.type === 'tool-plan' && item.card.mode === 'draft' && !item.card.planMarkdown) {
          throw new Error('Plan revision failed.')
        }
      } catch (error) {
        const err = error as Error
        if (err.name === 'AbortError') {
          store.completePlanDraft(cardId)
          return
        }
        store.completePlanDraft(cardId)
        store.updateToolPlanCard(cardId, { resultError: err.message })
        store.setStatus(`Revision failed: ${err.message}`, true)
      } finally {
        store.updateToolPlanCard(cardId, { busy: false })
        store.clearRunAbortController(effectiveRunId)
      }
    },
    [store, handleAdaEvent],
  )

  const handleToolRejection = useCallback(
    async (cardId: string, planId: string, runId: string) => {
      store.updateToolPlanCard(cardId, { busy: true })
      try {
        await rejectTool(planId)
        if (runId) {
          store.updateProcessStep(runId, 'awaiting_approval', {
            label: 'Plan discarded',
            status: 'error',
          })
          store.skipRemainingBuildSteps(runId)
        }
        store.removeToolPlanCard(cardId)
        store.setStatus('')
      } catch (error) {
        store.updateToolPlanCard(cardId, {
          busy: false,
          resultError: (error as Error).message,
        })
        store.setStatus(`Discard failed: ${(error as Error).message}`, true)
      }
    },
    [store],
  )

  return {
    runToolBuild,
    runPipContinuation,
    handlePipRejection,
    handleToolRevision,
    handleToolRejection,
    refreshTools,
    refreshPackages,
  }
}
