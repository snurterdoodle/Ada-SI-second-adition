import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { audioManager } from '../../audio/AudioManager'
import { MAX_TEXTAREA_ROWS } from '../../constants'
import { useChatStream } from '../../hooks/useChatStream'
import { useAppStore } from '../../state/store'

export function Composer() {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isSending = useAppStore((s) => s.isSending)
  const status = useAppStore((s) => s.status)
  const statusIsError = useAppStore((s) => s.statusIsError)
  const { sendMessage, stopGeneration } = useChatStream()

  const autoResize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22
    const maxHeight = lineHeight * MAX_TEXTAREA_ROWS
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isSending) return
    const content = input.trim()
    if (!content) return
    audioManager.unlock()
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.rows = 1
    }
    await sendMessage(content)
    textareaRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isSending) {
        void handleSubmit(e as unknown as FormEvent)
      }
    }
  }

  return (
    <footer className="composer">
      <form className="composer-form" onSubmit={handleSubmit}>
        <div className="composer-input-wrap">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="Speak to ADA…"
            value={input}
            disabled={isSending}
            onChange={(e) => {
              setInput(e.target.value)
              autoResize()
            }}
            onKeyDown={onKeyDown}
            required
          />
        </div>
        <button
          type="submit"
          className={`btn-send${isSending ? ' hidden' : ''}`}
          title="Send message"
          aria-label="Send message"
          disabled={isSending}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
        <button
          type="button"
          className={`btn-stop-round${isSending ? '' : ' hidden'}`}
          title="Stop generation"
          aria-label="Stop generation"
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
