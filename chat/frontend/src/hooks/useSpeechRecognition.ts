import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message?: string
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

export type SpeechStopOptions = {
  onEnd?: (transcript: string) => void
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

function formatSpeechError(error: string): string {
  switch (error) {
    case 'not-allowed':
      return 'Microphone access denied.'
    case 'no-speech':
      return 'No speech detected.'
    case 'audio-capture':
      return 'No microphone found.'
    case 'network':
      return 'Speech recognition network error.'
    default:
      return 'Speech recognition failed.'
  }
}

export function useSpeechRecognition() {
  const Ctor = getSpeechRecognitionCtor()
  const isSupported = Ctor !== null

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const finalTranscriptRef = useRef('')
  const sendOnEndRef = useRef(false)
  const onEndRef = useRef<((transcript: string) => void) | null>(null)

  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!Ctor) return

    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-US'

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) {
          finalTranscriptRef.current += text
        } else {
          interim += text
        }
      }
      setTranscript(finalTranscriptRef.current + interim)
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'aborted') return
      setError(formatSpeechError(event.error))
      setIsListening(false)
      sendOnEndRef.current = false
      onEndRef.current = null
    }

    recognition.onend = () => {
      const finalText = finalTranscriptRef.current.trim()
      setIsListening(false)

      if (sendOnEndRef.current) {
        sendOnEndRef.current = false
        onEndRef.current?.(finalText)
        onEndRef.current = null
      }
    }

    recognitionRef.current = recognition

    return () => {
      recognition.abort()
      recognitionRef.current = null
    }
  }, [Ctor])

  const start = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition || isListening) return

    finalTranscriptRef.current = ''
    sendOnEndRef.current = false
    onEndRef.current = null
    setTranscript('')
    setError(null)
    setIsListening(true)

    try {
      recognition.start()
    } catch {
      setIsListening(false)
      setError('Could not start speech recognition.')
    }
  }, [isListening])

  const stop = useCallback((options?: SpeechStopOptions) => {
    const recognition = recognitionRef.current
    if (!recognition) return

    if (options?.onEnd) {
      sendOnEndRef.current = true
      onEndRef.current = options.onEnd
    } else {
      sendOnEndRef.current = false
      onEndRef.current = null
    }

    try {
      recognition.stop()
    } catch {
      setIsListening(false)
      sendOnEndRef.current = false
      onEndRef.current = null
    }
  }, [])

  return {
    isSupported,
    isListening,
    transcript,
    error,
    start,
    stop,
  }
}
