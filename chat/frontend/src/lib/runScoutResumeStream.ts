import { consumeSseStream } from '../api/sse'
import { buildMessages, useAppStore } from '../state/store'
import {
  extractReasoningFromDelta,
  isAdaEvent,
  type AdaEvent,
} from '../types/events'

type ScoutResumeOptions = {
  url: string
  body?: Record<string, unknown>
  runId?: string
}

function handleScoutAdaEvent(json: AdaEvent): boolean {
  const store = useAppStore.getState()

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
  if (json.ada_event === 'open_skill_app') {
    store.openSkillApp(json.skill_name)
    return true
  }
  if (json.ada_event === 'skill_data_changed') {
    store.bumpSkillDataRevision()
    return true
  }
  return false
}

export async function runScoutResumeStream({
  url,
  body = {},
  runId,
}: ScoutResumeOptions): Promise<void> {
  const store = useAppStore.getState()
  const model = store.chatModel
  if (!model) {
    store.setStatus('Select or enter a model first.', true)
    return
  }

  const assistantId = store.addAssistantMessage()
  store.setIsSending(true)
  store.setStatus('')

  try {
    await consumeSseStream({
      url,
      body: {
        model,
        tool_creator_model: store.toolCreatorModel,
        reasoning_effort: store.thinkingEffort,
        gemini_google_search: store.geminiGoogleSearch,
        messages: buildMessages(),
        run_id: runId,
        ...body,
      },
      onPayload: (json) => {
        if (isAdaEvent(json)) {
          if (handleScoutAdaEvent(json)) return
          if (json.ada_event === 'chat_error') {
            throw new Error(json.detail || 'Scout resume failed.')
          }
          if (json.ada_event === 'search_sources') {
            store.updateAssistantMessage(assistantId, {
              searchSources: json.sources || [],
            })
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
        if (finalContent !== '(No response)') {
          store.grantXp('chat')
        }
      }
    }
    store.setStatus('')
  } catch (error) {
    const err = error as Error
    store.removeFeedItem(assistantId)
    store.setStatus(`Scout resume failed: ${err.message}`, true)
  } finally {
    store.setIsSending(false)
  }
}
