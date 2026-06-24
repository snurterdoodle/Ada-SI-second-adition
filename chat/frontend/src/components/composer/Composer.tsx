import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { MAX_TEXTAREA_ROWS } from '../../constants'
import { useChatStream } from '../../hooks/useChatStream'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import { useAppStore } from '../../state/store'

const DEFAULT_PLACEHOLDER = 'Send a message to ADA...'
const LISTENING_PLACEHOLDER = 'Listening...'

export function Composer() {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const prefixRef = useRef('')
  const isSending = useAppStore((s) => s.isSending)
  const status = useAppStore((s) => s.status)
  const statusIsError = useAppStore((s) => s.statusIsError)
  const setStatus = useAppStore((s) => s.setStatus)
  const { sendMessage, stopGeneration } = useChatStream()
  const speech = useSpeechRecognition()

  const autoResize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22
    const maxHeight = lineHeight * MAX_TEXTAREA_ROWS
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }

  const resetTextarea = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.rows = 1
    }
  }

  const submitContent = async (content: string) => {
    if (isSending) return
    const trimmed = content.trim()
    if (!trimmed) return
    setInput('')
    resetTextarea()
    await sendMessage(trimmed)
    textareaRef.current?.focus()
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await submitContent(input)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isSending && !speech.isListening) {
        void handleSubmit(e as unknown as FormEvent)
      }
    }
  }

  useEffect(() => {
    if (!speech.isListening) return
    const combined = prefixRef.current + speech.transcript
    setInput(combined)
    requestAnimationFrame(autoResize)
  }, [speech.isListening, speech.transcript])

  useEffect(() => {
    if (!speech.error) return
    setStatus(speech.error, true)
  }, [speech.error, setStatus])

  const toggleMic = () => {
    if (isSending) return

    if (speech.isListening) {
      speech.stop({
        onEnd: (transcript) => {
          const content = (prefixRef.current + transcript).trim()
          prefixRef.current = ''
          if (!content) {
            setInput('')
            resetTextarea()
            setStatus('No speech detected.', true)
            return
          }
          void submitContent(content)
        },
      })
      return
    }

    prefixRef.current = input
    speech.start()
  }

  const placeholder = speech.isListening ? LISTENING_PLACEHOLDER : DEFAULT_PLACEHOLDER

  return (
    <footer className="composer">
      <form className="composer-form" onSubmit={handleSubmit}>
        <div className="composer-input-wrap">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={placeholder}
            value={input}
            disabled={isSending || speech.isListening}
            onChange={(e) => {
              if (speech.isListening) return
              setInput(e.target.value)
              autoResize()
            }}
            onKeyDown={onKeyDown}
            required
          />
          {speech.isSupported && (
            <button
              type="button"
              className={`btn-mic${speech.isListening ? ' recording' : ''}`}
              title={speech.isListening ? 'Stop and send' : 'Start voice input'}
              aria-label={speech.isListening ? 'Stop recording and send' : 'Start voice input'}
              aria-pressed={speech.isListening}
              disabled={isSending}
              onClick={toggleMic}
            >
              {speech.isListening ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
          )}
        </div>
        <button
          type="submit"
          className={`btn-send${isSending ? ' hidden' : ''}`}
          title="Launch message"
          aria-label="Launch message"
          disabled={isSending || speech.isListening}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
        <button
          type="button"
          className={`btn-stop-round${isSending ? '' : ' hidden'}`}
          title="Halt response"
          aria-label="Halt response"
          onClick={stopGeneration}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </button>
      </form>
      <p className={`status${statusIsError ? ' error' : ''}`}>{status}</p>
    </footer>
  )
}
