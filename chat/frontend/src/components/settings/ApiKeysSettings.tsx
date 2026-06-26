import { useCallback, useEffect, useState } from 'react'

import { clearSecret, fetchSecrets, saveSecrets } from '../../api/client'
import type { SecretKey, SecretsStatusMap } from '../../types/events'

const SECRET_FIELDS: Array<{ key: SecretKey; label: string; hint: string }> = [
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI',
    hint: 'Used for GPT models via LiteLLM.',
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic',
    hint: 'Used for Claude models via LiteLLM.',
  },
  {
    key: 'GEMINI_API_KEY',
    label: 'Google Gemini',
    hint: 'Used for Gemini models via LiteLLM.',
  },
  {
    key: 'GROQ_API_KEY',
    label: 'Groq',
    hint: 'Used for Groq-hosted models via LiteLLM.',
  },
  {
    key: 'ELEVENLABS_API_KEY',
    label: 'ElevenLabs',
    hint: 'Used for read-aloud voice output. Takes effect immediately.',
  },
]

export function ApiKeysSettings() {
  const [status, setStatus] = useState<SecretsStatusMap>({})
  const [drafts, setDrafts] = useState<Partial<Record<SecretKey, string>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchSecrets()
      setStatus(data)
      setDrafts({})
    } catch (error) {
      setMessage(`Could not load API keys: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const handleSave = async () => {
    const updates = Object.fromEntries(
      Object.entries(drafts).filter(([, value]) => value !== undefined),
    ) as Partial<Record<SecretKey, string>>
    if (Object.keys(updates).length === 0) {
      setMessage('Enter at least one key to save.')
      return
    }

    setSaving(true)
    setMessage('')
    try {
      const data = await saveSecrets(updates)
      setStatus(data)
      setDrafts({})
      setMessage('API keys saved locally. They are never committed to git.')
    } catch (error) {
      setMessage(`Save failed: ${(error as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async (key: SecretKey) => {
    setSaving(true)
    setMessage('')
    try {
      const data = await clearSecret(key)
      setStatus(data)
      setDrafts((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      setMessage(`${key.replace(/_API_KEY$/, '')} key cleared.`)
    } catch (error) {
      setMessage(`Clear failed: ${(error as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="api-keys-settings">
      <div className="settings-section-header">
        <div>
          <h3>API keys</h3>
          <p className="settings-section-desc">
            Keys are stored on your machine in a gitignored file on the server. They are never
            returned after save except as masked hints.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => void loadStatus()}
          disabled={loading || saving}
        >
          Refresh
        </button>
      </div>

      {loading ? <p className="forger-guidance-hint">Loading key status…</p> : null}

      <div className="settings-fields">
        {SECRET_FIELDS.map(({ key, label, hint }) => {
          const configured = status[key]?.configured ?? false
          const maskedHint = status[key]?.hint ?? ''
          const source = status[key]?.source ?? ''
          const clearable = configured && source !== 'env'
          return (
            <div className="settings-field" key={key}>
              <label htmlFor={`secret-${key}`}>{label}</label>
              <p className="forger-guidance-hint">{hint}</p>
              {configured ? (
                <p className="forger-guidance-hint">
                  Configured: {maskedHint}
                  {source === 'env' ? ' (from .env)' : source === 'file' ? ' (saved in Settings)' : ''}
                </p>
              ) : (
                <p className="forger-guidance-hint">Not configured</p>
              )}
              <input
                id={`secret-${key}`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={configured ? 'Enter new key to replace' : 'Paste API key'}
                value={drafts[key] ?? ''}
                disabled={saving}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [key]: event.target.value }))
                }
              />
              {clearable ? (
                <button
                  type="button"
                  className="btn-secondary btn-sm settings-inline-btn"
                  disabled={saving}
                  onClick={() => void handleClear(key)}
                >
                  Clear saved key
                </button>
              ) : source === 'env' ? (
                <p className="forger-guidance-hint">
                  This key comes from your .env file. Remove it there and restart Ada-SI to clear.
                </p>
              ) : null}
            </div>
          )
        })}
      </div>

      <p className="forger-guidance-hint">
        LLM provider keys require restarting Ada-SI before new models appear. ElevenLabs keys work
        immediately for voice output.
      </p>

      <div className="settings-actions">
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : 'Save keys'}
        </button>
      </div>

      {message ? <p className="forger-guidance-hint">{message}</p> : null}
    </div>
  )
}
