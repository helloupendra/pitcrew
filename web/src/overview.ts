import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { Overview } from '../../src/core/types'
import { get, serialLoader, useChanges } from './api'

/**
 * One copy of the overview for the whole page: the top bar's waiting count and the session list read
 * the same data, asked for once. It is asked again on every change the server reports and every
 * 10 seconds (statuses depend on time passing), while anything on the page uses it.
 */
const REFRESH_MS = 10_000

let data: Overview | undefined
let problem: unknown
const subscribers = new Set<() => void>()
const errorHandlers = new Set<(e: unknown) => void>()
let users = 0
let timer: ReturnType<typeof setInterval> | undefined

const emit = () => subscribers.forEach((f) => f())

export const refreshOverview = serialLoader(async () => {
  try {
    data = await get<Overview>('/api/overview')
    problem = undefined
  } catch (e) {
    problem = e
    errorHandlers.forEach((f) => f(e))
  }
  emit()
})

function subscribe(f: () => void): () => void {
  subscribers.add(f)
  return () => {
    subscribers.delete(f)
  }
}

export function useOverview(onError?: (e: unknown) => void): Overview | undefined {
  const snapshot = useSyncExternalStore(subscribe, () => data)

  useEffect(() => {
    users++
    if (users === 1) {
      refreshOverview()
      timer = setInterval(refreshOverview, REFRESH_MS)
    }
    return () => {
      users--
      if (!users && timer) {
        clearInterval(timer)
        timer = undefined
      }
    }
  }, [])

  useEffect(() => {
    if (!onError) return
    errorHandlers.add(onError)
    if (problem) onError(problem)
    return () => {
      errorHandlers.delete(onError)
    }
  }, [onError])

  useChanges(useCallback(() => refreshOverview(), []))
  return snapshot
}
