import { useCallback } from 'react'
import { consumeSseStream } from '../api/sse'
import { cancelRun } from '../api/client'
import {
  extractReasoningFromDelta,
  isAdaEvent,
  type AdaEvent,
} from '../types/events'
import { audioManager } from '../audio/AudioManager'
import { awardChatTurnXp } from '../state/progressionActions'
import { buildMessages, useAppStore } from '../state/store'

export function useChatStream() {
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

  const handlePlanDraftStarted = useCallback(
    (json: AdaEvent & { ada_event: 'tool_plan_draft_started' }) => {
      store.ensureToolPlanDraft({
        runId: json.run_id,
        planId: json.plan_id,
        toolName: json.tool_name,
        kind: json.kind,
      })
    },
    [store],
  )

  const handlePlanThinkingDelta = useCallback(
    (json: AdaEvent & { ada_event: 'tool_plan_thinking_delta' }) => {
      const item =
        store.findToolPlanByPlanId(json.plan_id || '') ||
        store.findToolPlanByRun(json.run_id, true)
      if (!item) {
        store.ensureToolPlanDraft({ runId: json.run_id, planId: json.plan_id })
        const created = store.findToolPlanByRun(json.run_id, true)
        if (created) {
          store.updateToolPlanCard(created.id, {
            draftThinking: created.card.draftThinking + (json.delta || ''),
          })
        }
        return
      }
      store.updateToolPlanCard(item.id, {
        draftThinking: item.card.draftThinking + (json.delta || ''),
      })
    },
    [store],
  )

  const handlePlanContentDelta = useCallback(
    (json: AdaEvent & { ada_event: 'tool_plan_content_delta' }) => {
      let item =
        store.findToolPlanByPlanId(json.plan_id || '') ||
        store.findToolPlanByRun(json.run_id, true)
      if (!item) {
        store.ensureToolPlanDraft({ runId: json.run_id, planId: json.plan_id })
        item = store.findToolPlanByRun(json.run_id, true)!
        if (!item) return
      }
      store.updateToolPlanCard(item.id, {
        draftPlanText: item.card.draftPlanText + (json.delta || ''),
      })
    },
    [store],
  )

  const handlePlanPending = useCallback(
    (json: AdaEvent & { ada_event: 'tool_plan_pending' }, assistantId: string | null) => {
      const runId = json.run_id
      store.registerBuildSteps(runId)

      let item = store.findToolPlanByRun(runId, true)
      if (item) {
        store.updateToolPlanCard(item.id, {
          planId: json.plan_id,
          toolName: json.tool_name,
          kind: json.kind,
          planMarkdown: json.plan,
          mode: 'pending',
          draftThinking: item.card.draftThinking,
          draftPlanText: item.card.draftPlanText,
        })
        store.completePlanDraft(item.id)
        store.collapseOtherToolPlans(item.id)
      } else {
        const id = store.ensureToolPlanDraft({
          runId,
          planId: json.plan_id,
          toolName: json.tool_name,
          kind: json.kind,
        })
        store.updateToolPlanCard(id, {
          planMarkdown: json.plan,
          mode: 'pending',
        })
        store.completePlanDraft(id)
      }

      if (assistantId) store.removeFeedItem(assistantId)
    },
    [store],
  )

  const sendMessage = useCallback(
    async (content: string) => {
      if (store.isSending) return

      const model = store.chatModel
      if (!model) {
        store.setStatus('Select or enter a model first.', true)
        return
      }

      const controller = new AbortController()
      store.setAbortController(controller)

      const runId = store.startProcessRun(content, model)
      const runControllers = new Map(store.runAbortControllers)
      runControllers.set(runId, controller)
      useAppStore.setState({ runAbortControllers: runControllers })

      store.setIsSending(true)
      store.setStatus('')
      audioManager.unlock()
      void audioManager.play('send')
      store.pushConversation({ role: 'user', content })
      store.addUserMessage(content)

      const assistantId = store.addAssistantMessage()
      let planReceived = false

      try {
        await consumeSseStream({
          url: '/api/chat',
          body: {
            model,
            tool_creator_model: store.toolCreatorModel,
            messages: buildMessages(),
            run_id: runId,
            stream: true,
          },
          signal: controller.signal,
          onPayload: (json) => {
            if (isAdaEvent(json)) {
              if (handleAdaEvent(json)) return
              if (json.ada_event === 'chat_error') {
                void audioManager.play('error')
                throw new Error(json.detail || 'Chat failed.')
              }
              if (json.ada_event === 'tool_plan_draft_started') {
                store.removeFeedItem(assistantId)
                handlePlanDraftStarted(json)
                return
              }
              if (json.ada_event === 'tool_plan_thinking_delta') {
                handlePlanThinkingDelta(json)
                return
              }
              if (json.ada_event === 'tool_plan_content_delta') {
                handlePlanContentDelta(json)
                return
              }
              if (json.ada_event === 'tool_plan_pending') {
                planReceived = true
                handlePlanPending(json, assistantId)
                return
              }
            }

            const delta = 'choices' in json ? json.choices?.[0]?.delta : undefined
            if (!delta) return

            const reasoning = extractReasoningFromDelta(delta)
            const text = delta.content || ''
            const current = useAppStore
              .getState()
              .feed.find((f) => f.id === assistantId && f.type === 'assistant')

            if (!current || current.type !== 'assistant') return

            store.updateAssistantMessage(assistantId, {
              reasoningText: current.reasoningText + reasoning,
              content: current.content + text,
            })
          },
        })

        if (planReceived) {
          store.pushConversation({
            role: 'assistant',
            content: '[System] A new tool plan is pending your approval.',
          })
          store.setStatus('')
        } else {
          const current = useAppStore
            .getState()
            .feed.find((f) => f.id === assistantId && f.type === 'assistant')
          if (current && current.type === 'assistant') {
            let finalContent = current.content
            if (!finalContent && !current.reasoningText) {
              finalContent = '(No response)'
            }
            store.updateAssistantMessage(assistantId, {
              content: finalContent,
              streaming: false,
            })
            if (finalContent) {
              store.pushConversation({ role: 'assistant', content: finalContent })
              awardChatTurnXp(finalContent.length)
              void audioManager.play('receive')
            }
          }
          store.setStatus('')
        }
      } catch (error) {
        const err = error as Error
        if (store.activeRunId) {
          store.updateProcessStep(store.activeRunId, 'lite_model', {
            label: 'Request failed',
            status: 'error',
            detail: err.message,
          })
        }
        if (err.name === 'AbortError') {
          const current = useAppStore
            .getState()
            .feed.find((f) => f.id === assistantId && f.type === 'assistant')
          if (current && current.type === 'assistant' && (current.content || current.reasoningText)) {
            store.updateAssistantMessage(assistantId, { streaming: false })
            if (current.content) {
              store.pushConversation({ role: 'assistant', content: current.content })
            }
            store.setStatus('Generation stopped.')
          } else {
            store.removeFeedItem(assistantId)
            store.popConversation()
            store.setStatus('Generation stopped.')
          }
        } else {
          store.removeFeedItem(assistantId)
          store.popConversation()
          void audioManager.play('error')
          store.setStatus(`Chat failed: ${err.message}`, true)
        }
      } finally {
        store.clearRunAbortController(runId)
        store.setIsSending(false)
        store.setShowScrollBottom(false)
      }
    },
    [
      store,
      handleAdaEvent,
      handlePlanDraftStarted,
      handlePlanThinkingDelta,
      handlePlanContentDelta,
      handlePlanPending,
    ],
  )

  const stopGeneration = useCallback(() => {
    const { activeRunId, abortController, runAbortControllers } = useAppStore.getState()
    if (activeRunId) {
      runAbortControllers.get(activeRunId)?.abort()
      runAbortControllers.delete(activeRunId)
      cancelRun(activeRunId)
      store.stopActiveProcessStep(activeRunId)
      if (store.isSending) {
        store.setIsSending(false)
        store.setAbortController(null)
      }
      store.setStatus('Quest stopped.')
      return
    }
    abortController?.abort()
  }, [store])

  return { sendMessage, stopGeneration }
}
