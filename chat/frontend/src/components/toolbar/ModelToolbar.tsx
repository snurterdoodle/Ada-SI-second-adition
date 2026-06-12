import { useEffect, useState } from 'react'
import { fetchConfig, fetchModels } from '../../api/client'
import { audioManager } from '../../audio/AudioManager'
import { useAppStore } from '../../state/store'
import { getModelLabel, groupModels, isWildcardModel } from '../../utils/models'
import { SystemInstructions } from './SystemInstructions'

export function ModelToolbar() {
  const [soundMuted, setSoundMuted] = useState(audioManager.muted)
  const models = useAppStore((s) => s.models)
  const chatModel = useAppStore((s) => s.chatModel)
  const toolCreatorModel = useAppStore((s) => s.toolCreatorModel)
  const setModels = useAppStore((s) => s.setModels)
  const setChatModel = useAppStore((s) => s.setChatModel)
  const setToolCreatorModel = useAppStore((s) => s.setToolCreatorModel)
  const setAppConfig = useAppStore((s) => s.setAppConfig)
  const setStatus = useAppStore((s) => s.setStatus)
  const startNewChat = useAppStore((s) => s.startNewChat)
  const setTools = useAppStore((s) => s.setTools)

  const loadModels = async () => {
    setStatus('Loading models...')
    try {
      const config = await fetchConfig()
      setAppConfig(config)
      const modelList = (await fetchModels()).filter((id) => !isWildcardModel(id))

      if (modelList.length === 0) {
        setModels([])
        setStatus('No models available. Add API keys to .env and restart.', true)
        return
      }

      setModels(modelList)

      const preferredChat =
        [chatModel, config.lite_model, config.chat_model].find(
          (v) => v && modelList.includes(v),
        ) || modelList[0]
      const preferredTool =
        [toolCreatorModel, config.tool_creator_model, config.second_model].find(
          (v) => v && modelList.includes(v),
        ) || modelList[0]

      setChatModel(preferredChat)
      setToolCreatorModel(preferredTool)
      const { fetchTools } = await import('../../api/client')
      const tools = await fetchTools()
      setTools(tools)
      setStatus('')
    } catch (error) {
      setModels([])
      setStatus(`Could not load models: ${(error as Error).message}`, true)
    }
  }

  useEffect(() => {
    void loadModels()
  }, [])

  const grouped = groupModels(models)
  const sortedProviders = [...grouped.keys()].sort((a, b) => a.localeCompare(b))

  const renderSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <div className="model-picker model-picker-compact">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={models.length === 0}
        onChange={(e) => onChange(e.target.value)}
      >
        {models.length === 0 ? (
          <option value="">No models found</option>
        ) : (
          sortedProviders.map((provider) => (
            <optgroup key={provider} label={provider}>
              {(grouped.get(provider) || [])
                .sort((a, b) => a.localeCompare(b))
                .map((model) => (
                  <option key={model} value={model}>
                    {getModelLabel(model)}
                  </option>
                ))}
            </optgroup>
          ))
        )}
      </select>
    </div>
  )

  return (
    <header className="header holo-panel">
      <div className="toolbar">
        <div className="toolbar-brand" title="ADA · Adaptive Digital Agent">
          <span className="brand-mark" aria-hidden="true">
            ◈
          </span>
          <span className="brand-name">ADA</span>
        </div>

        <div className="toolbar-models">
          {renderSelect('chat-model-select', 'Core model', chatModel, setChatModel)}
          {renderSelect('second-model-select', 'Forge model', toolCreatorModel, setToolCreatorModel)}
        </div>

        <div className="toolbar-actions">
          <button
            type="button"
            className={`btn-icon${soundMuted ? ' btn-muted' : ''}`}
            title={soundMuted ? 'Enable sound' : 'Mute sound'}
            aria-label={soundMuted ? 'Enable sound' : 'Mute sound'}
            onClick={() => {
              audioManager.unlock()
              const muted = audioManager.toggleMute()
              setSoundMuted(muted)
              if (!muted) void audioManager.play('click')
            }}
          >
            {soundMuted ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="btn-icon"
            title="Refresh models"
            aria-label="Refresh models"
            onClick={() => {
              audioManager.unlock()
              void audioManager.play('click')
              void loadModels()
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              audioManager.unlock()
              void audioManager.play('click')
              startNewChat()
            }}
          >
            New session
          </button>
        </div>
      </div>
      <SystemInstructions />
    </header>
  )
}
