import { parseErrorMessage } from '../utils/text'
import type { StreamPayload } from '../types/events'

export function parseSseChunks(
  buffer: string,
  onData: (payload: string) => void,
): string {
  const parts = buffer.split('\n\n')
  const remainder = parts.pop() || ''

  for (const part of parts) {
    const lines = part.split('\n')
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (!payload || payload === '[DONE]') continue
      onData(payload)
    }
  }

  return remainder
}

export type SseStreamOptions = {
  url: string
  body: Record<string, unknown>
  signal?: AbortSignal
  onPayload: (payload: StreamPayload) => void | boolean
}

export async function consumeSseStream({
  url,
  body,
  signal,
  onPayload,
}: SseStreamOptions): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    throw new Error(parseErrorMessage(await response.text()))
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    buffer = parseSseChunks(buffer, (payload) => {
      try {
        const json = JSON.parse(payload) as StreamPayload
        onPayload(json)
      } catch {
        // Ignore malformed chunks
      }
    })
  }
}

export type BuildStreamResult =
  | { status: 'success'; message: string }
  | { status: 'failed'; reason?: string; logs?: string }
  | { status: 'pip_pending' }
  | { status: 'preview_pending' }
  | null

export async function consumeBuildStream(
  response: Response,
  onPayload: (payload: StreamPayload) => void | boolean,
): Promise<BuildStreamResult> {
  const reader = response.body?.getReader()
  if (!reader) return null

  const decoder = new TextDecoder()
  let buffer = ''
  let buildResult: BuildStreamResult = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    buffer = parseSseChunks(buffer, (payload) => {
      try {
        const json = JSON.parse(payload) as StreamPayload & {
          ada_event?: string
          message?: string
          reason?: string
          logs?: string
        }
        const stop = onPayload(json)
        if (stop === false) return

        if (json.ada_event === 'pip_install_pending') {
          buildResult = { status: 'pip_pending' }
        } else if (json.ada_event === 'ui_preview_pending') {
          buildResult = { status: 'preview_pending' }
        } else if (json.ada_event === 'tool_installed') {
          buildResult = { status: 'success', message: json.message || 'Skill installed.' }
        } else if (json.ada_event === 'tool_build_failed') {
          buildResult = {
            status: 'failed',
            reason: json.reason,
            logs: json.logs,
          }
        }
      } catch {
        // Ignore malformed chunks
      }
    })
  }

  return buildResult
}
