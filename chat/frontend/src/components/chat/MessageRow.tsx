import { useState } from 'react'
import type { AssistantFeedItem } from '../../types/events'
import { Markdown } from './Markdown'
import { ReasoningBlock } from './ReasoningBlock'

type MessageRowProps = {
  item: AssistantFeedItem | { type: 'user'; content: string }
}

export function MessageRow({ item }: MessageRowProps) {
  const [copied, setCopied] = useState(false)

  if (item.type === 'user') {
    return (
      <div className="message-row user-row">
        <span className="message-avatar user-avatar">You</span>
        <article className="message user">{item.content}</article>
      </div>
    )
  }

  const hasReasoning = Boolean(item.reasoningText)
  const hasContent = Boolean(item.content)
  const showThinking =
    hasReasoning || (item.streaming && !hasContent)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(item.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`message-row assistant-row${item.streaming ? ' streaming' : ''}`}>
      <span className="message-avatar assistant-avatar">ADA</span>
      <article className="message assistant">
        <div className="message-header">
          <div className="message-actions">
            {!item.streaming && hasContent && (
              <button type="button" className="icon-btn" title="Copy message" onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            )}
          </div>
        </div>
        <div className="message-body">
          {showThinking && (
            <ReasoningBlock
              text={item.reasoningText}
              streaming={item.streaming && !hasContent}
              open={!hasContent || item.streaming}
            />
          )}
          {hasContent && (
            <div className="message-content">
              <Markdown content={item.content} />
            </div>
          )}
        </div>
      </article>
    </div>
  )
}
