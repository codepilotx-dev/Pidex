import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PetDescriptor } from '@pidex/agent-protocol'
import { desktopClient } from '../../services/desktop-client/index.js'
import { useDesktopSettings } from '../settings/UseDesktopSettings.js'
import type { DesktopPermissionDecision, DesktopSessionSnapshot } from '../../../shared/Types.js'
import {
  projectPetNotifications,
  resolvePetReplyDelivery,
  type PetNotification,
} from './PetNotificationProjector.js'
import type { PetAnimationName } from './PetAnimationModel.js'
import {
  getPetPresentationBridge,
  presentationFromPetSettings,
  type PetPresentation,
} from './PetPresentation.js'

export function usePetOverlayController(): {
  animation: PetAnimationName
  dismiss: (id: string) => void
  notification: PetNotification | null
  openThread: (threadId: string) => Promise<void>
  pet: PetDescriptor | null
  reply: (notification: PetNotification, text: string) => Promise<void>
  respond: (notification: PetNotification, decision: DesktopPermissionDecision) => Promise<void>
  size: number
} {
  const { draft } = useDesktopSettings()
  const preferences = draft.values.pet
  const [pets, setPets] = useState<readonly PetDescriptor[]>([])
  const [sessions, setSessions] = useState<readonly DesktopSessionSnapshot[]>([])
  const [notifications, setNotifications] = useState<PetNotification[]>([])
  const [presentationPreview, setPresentationPreview] = useState<PetPresentation | null>(null)
  const dismissed = useRef(new Set<string>())
  const previousSessions = useRef<readonly DesktopSessionSnapshot[]>([])
  const preferencesRef = useRef(preferences)
  const catalogRequestRef = useRef<Promise<readonly PetDescriptor[]> | null>(null)
  const missingCatalogReloadRef = useRef<string | null>(null)
  preferencesRef.current = preferences

  const loadCatalog = useCallback((): Promise<readonly PetDescriptor[]> => {
    catalogRequestRef.current ??= desktopClient.listPets().finally(() => {
      catalogRequestRef.current = null
    })
    return catalogRequestRef.current
  }, [])

  const updateSessions = useCallback((next: readonly DesktopSessionSnapshot[]) => {
    const now = Date.now()
    setNotifications(
      projectPetNotifications({
        previous: previousSessions.current,
        current: next,
        now,
        dismissedIds: dismissed.current,
        preferences: preferencesRef.current,
      }),
    )
    previousSessions.current = next
    setSessions(next)
  }, [])

  useEffect(() => {
    let disposed = false
    void loadCatalog().then((catalog) => {
      if (!disposed) setPets(catalog)
    })
    return () => {
      disposed = true
    }
  }, [loadCatalog])

  useEffect(() => {
    let disposed = false
    void desktopClient.listSessions().then((snapshots) => {
      if (disposed) return
      previousSessions.current = snapshots
      setSessions(snapshots)
      setNotifications(
        projectPetNotifications({
          previous: [],
          current: snapshots,
          now: Date.now(),
          dismissedIds: dismissed.current,
          preferences: preferencesRef.current,
        }),
      )
    })
    const unsubscribe = desktopClient.onSessionStoreChange((change) => {
      updateSessions(change.sessions)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [updateSessions])

  useEffect(() => {
    setNotifications(
      projectPetNotifications({
        previous: sessions,
        current: sessions,
        now: Date.now(),
        dismissedIds: dismissed.current,
        preferences,
      }),
    )
  }, [
    preferences.notifyAttention,
    preferences.notifyCompletion,
    preferences.notifyFailure,
    sessions,
  ])

  useEffect(() => {
    const bridge = getPetPresentationBridge()
    if (typeof bridge?.onPetPresentationPreview !== 'function') return
    return bridge.onPetPresentationPreview(setPresentationPreview)
  }, [])

  useEffect(() => {
    setPresentationPreview(null)
  }, [preferences.selectedPetId, preferences.size])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      setNotifications((current) =>
        current.filter((item) => item.expiresAt === null || item.expiresAt > now),
      )
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const presentation = presentationPreview ?? presentationFromPetSettings(preferences)

  useEffect(() => {
    const selectedPetId = presentation.selectedPetId
    if (!selectedPetId || pets.some((item) => item.id === selectedPetId)) {
      missingCatalogReloadRef.current = null
      return
    }
    if (missingCatalogReloadRef.current === selectedPetId) return
    missingCatalogReloadRef.current = selectedPetId
    let disposed = false
    void loadCatalog().then((catalog) => {
      if (!disposed) setPets(catalog)
    })
    return () => {
      disposed = true
    }
  }, [loadCatalog, pets, presentation.selectedPetId])

  const pet = useMemo(
    () => pets.find((item) => item.id === presentation.selectedPetId) ?? pets[0] ?? null,
    [pets, presentation.selectedPetId],
  )
  const notification = notifications[0] ?? null
  const animation: PetAnimationName = notification
    ? notification.kind === 'completed'
      ? 'jumping'
      : notification.kind === 'failed'
        ? 'failed'
        : 'waiting'
    : sessions.some((snapshot) => snapshot.item.status === 'running')
      ? 'running'
      : 'idle'

  return {
    animation,
    dismiss: (id) => {
      dismissed.current.add(id)
      setNotifications((current) => current.filter((item) => item.id !== id))
    },
    notification,
    openThread: async (threadId) => {
      await window.DesktopBridge?.openPetSession(threadId)
    },
    pet,
    reply: async (target, text) => {
      const snapshot = sessions.find((item) => item.item.id === target.threadId)
      const status = snapshot?.item.status
      if (resolvePetReplyDelivery(status, Boolean(target.request)) === 'follow-up') {
        await desktopClient.submitSessionFollowUp(target.threadId, { text }, 'steer')
        return
      }
      await desktopClient.sendUserMessage(target.threadId, { text })
    },
    respond: async (target, decision) => {
      if (!target.request) {
        throw new Error('这条提醒没有可处理的审批请求。')
      }
      await desktopClient.respondToPermission(target.threadId, target.request.requestId, decision)
      dismissed.current.add(target.id)
      setNotifications((current) => current.filter((item) => item.id !== target.id))
    },
    size: presentation.size,
  }
}
