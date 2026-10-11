import { useCallback, useEffect, useRef, useState } from 'react'
import type { PetDescriptor } from '@pidex/agent-protocol'
import type { DesktopPetSettings } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { useDesktopSettings } from '../settings/UseDesktopSettings.js'
import {
  getPetPresentationBridge,
  presentationFromPetSettings,
  type PetPresentation,
} from './PetPresentation.js'

const PET_SIZE_SAVE_DEBOUNCE_MS = 100

type Options = {
  onError: (message: string) => void
}

export function usePetSettingsController({ onError }: Options): {
  busy: boolean
  flushPendingSize: () => void
  pets: readonly PetDescriptor[]
  previewSize: (size: number) => void
  refreshPets: () => Promise<readonly PetDescriptor[]>
  selectPet: (selectedPetId: string | null) => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
  settings: DesktopPetSettings
  updatePet: (patch: Partial<DesktopPetSettings>, autoSave?: boolean) => void
} {
  const { draft } = useDesktopSettings()
  const [pets, setPets] = useState<readonly PetDescriptor[]>([])
  const [busy, setBusy] = useState(false)
  const settings = draft.values.pet
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const committedPresentationRef = useRef(presentationFromPetSettings(settings))
  const desiredPresentationRef = useRef(presentationFromPetSettings(settings))
  const draftRef = useRef(draft)
  draftRef.current = draft
  const sizeSaveTimerRef = useRef<number | null>(null)
  const saveSequenceRef = useRef(Promise.resolve())

  const updatePet = useCallback((patch: Partial<typeof settings>, autoSave = true): void => {
    settingsRef.current = { ...settingsRef.current, ...patch }
    draftRef.current.setValue('pet', (current) => ({ ...current, ...patch }))
    if (autoSave) draftRef.current.autoSave()
  }, [])

  const previewPresentation = useCallback(
    (presentation: PetPresentation): void => {
      const previewer = getPetPresentationBridge()?.previewPetPresentation
      if (typeof previewer !== 'function') return
      void Promise.resolve(previewer(presentation)).catch((error) => {
        onError(messageOf(error))
      })
    },
    [onError],
  )

  const commitPresentation = useCallback(
    (presentation: PetPresentation): Promise<void> => {
      saveSequenceRef.current = saveSequenceRef.current.then(async () => {
        try {
          const saved = await draftRef.current.save()
          const canonical = presentationFromPetSettings(saved.pet)
          committedPresentationRef.current = canonical
          previewPresentation(canonical)
        } catch (error) {
          if (!samePresentation(desiredPresentationRef.current, presentation)) {
            return
          }
          const rollback = committedPresentationRef.current
          draftRef.current.setValue('pet', (current) => ({
            ...current,
            selectedPetId: rollback.selectedPetId,
            size: rollback.size,
          }))
          previewPresentation(rollback)
          onError(messageOf(error))
        }
      })
      return saveSequenceRef.current
    },
    [onError, previewPresentation],
  )

  const flushPendingSize = useCallback((): void => {
    if (sizeSaveTimerRef.current === null) return
    window.clearTimeout(sizeSaveTimerRef.current)
    sizeSaveTimerRef.current = null
    void commitPresentation(presentationFromPetSettings(settingsRef.current))
  }, [commitPresentation])

  const selectPet = useCallback(
    (selectedPetId: string | null): Promise<void> => {
      if (sizeSaveTimerRef.current !== null) {
        window.clearTimeout(sizeSaveTimerRef.current)
        sizeSaveTimerRef.current = null
      }
      const presentation = {
        ...presentationFromPetSettings(settingsRef.current),
        selectedPetId,
      }
      updatePet({ selectedPetId }, false)
      desiredPresentationRef.current = presentation
      previewPresentation(presentation)
      return commitPresentation(presentation)
    },
    [commitPresentation, previewPresentation, updatePet],
  )

  const refreshPets = useCallback(async (): Promise<readonly PetDescriptor[]> => {
    setBusy(true)
    try {
      const next = await desktopClient.listPets()
      setPets(next)
      const selectedPetId = settingsRef.current.selectedPetId
      if (selectedPetId && !next.some((pet) => pet.id === selectedPetId)) {
        await selectPet(next[0]?.id ?? null)
      }
      return next
    } catch (error) {
      onError(messageOf(error))
      return []
    } finally {
      setBusy(false)
    }
  }, [onError, selectPet])

  const previewSize = useCallback(
    (size: number): void => {
      const presentation = {
        ...presentationFromPetSettings(settingsRef.current),
        size,
      }
      updatePet({ size }, false)
      desiredPresentationRef.current = presentation
      previewPresentation(presentation)
      if (sizeSaveTimerRef.current !== null) {
        window.clearTimeout(sizeSaveTimerRef.current)
      }
      sizeSaveTimerRef.current = window.setTimeout(() => {
        sizeSaveTimerRef.current = null
        void commitPresentation(presentation)
      }, PET_SIZE_SAVE_DEBOUNCE_MS)
    },
    [commitPresentation, previewPresentation, updatePet],
  )

  const setEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      try {
        if (enabled) await window.DesktopBridge?.openPetOverlay()
        else await window.DesktopBridge?.hidePetOverlay()
        updatePet({ enabled })
      } catch (error) {
        onError(messageOf(error))
      }
    },
    [onError, updatePet],
  )

  useEffect(() => {
    void refreshPets()
  }, [refreshPets])

  useEffect(() => {
    return desktopClient.onDesktopSettingsChange((change) => {
      const canonical = presentationFromPetSettings(change.settings.pet)
      committedPresentationRef.current = canonical
      if (sizeSaveTimerRef.current === null) {
        desiredPresentationRef.current = canonical
        previewPresentation(canonical)
      }
    })
  }, [previewPresentation])

  useEffect(() => {
    return () => {
      if (sizeSaveTimerRef.current !== null) {
        window.clearTimeout(sizeSaveTimerRef.current)
        sizeSaveTimerRef.current = null
        void commitPresentation(presentationFromPetSettings(settingsRef.current))
      }
    }
  }, [commitPresentation])

  return {
    busy,
    flushPendingSize,
    pets,
    previewSize,
    refreshPets,
    selectPet,
    setEnabled,
    settings,
    updatePet,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function samePresentation(left: PetPresentation, right: PetPresentation): boolean {
  return left.selectedPetId === right.selectedPetId && left.size === right.size
}
