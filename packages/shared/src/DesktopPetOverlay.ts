import { isRecord } from './Guards'
export const PET_OVERLAY_CHANNELS = {
  open: 'pet-overlay:open',
  hide: 'pet-overlay:hide',
  getState: 'pet-overlay:get-state',
  previewPresentation: 'desktop-pet-overlay:preview-presentation',
  presentationPreview: 'desktop-pet-overlay:presentation-preview',
  getGlobalPointerPosition: 'desktop-pet-overlay:get-global-pointer-position',
  beginDrag: 'pet-overlay:drag-begin',
  updateDrag: 'pet-overlay:drag-update',
  endDrag: 'pet-overlay:drag-end',
  setPointerPassthrough: 'pet-overlay:pointer-passthrough',
  requestKeyboardFocus: 'pet-overlay:keyboard-focus',
  openSession: 'pet-overlay:open-session',
} as const

export const PET_AVATAR_MIN_SIZE = 80
export const PET_AVATAR_MAX_SIZE = 224

export type DesktopPetOverlayBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type DesktopPetOverlayWindowState = {
  open: boolean
  bounds: DesktopPetOverlayBounds
}

export type DesktopPetPresentation = {
  selectedPetId: string | null
  size: number
}

export type DesktopPetGlobalPointerPosition = {
  x: number
  y: number
}

export interface DesktopPetOverlayBridge {
  openPetOverlay(): Promise<void>
  hidePetOverlay(): Promise<void>
  getPetOverlayWindowState(): Promise<DesktopPetOverlayWindowState>
  previewPetPresentation(presentation: DesktopPetPresentation): Promise<DesktopPetPresentation>
  onPetPresentationPreview(listener: (presentation: DesktopPetPresentation) => void): () => void
  getPetGlobalPointerPosition(): Promise<DesktopPetGlobalPointerPosition>
  beginPetDrag(): void
  updatePetDrag(): void
  endPetDrag(): void
  setPetPointerPassthrough(passthrough: boolean): void
  requestPetKeyboardFocus(focused: boolean): Promise<void>
  openPetSession(sessionId: string): Promise<void>
  onPetOpenSession(listener: (sessionId: string) => void): () => void
}

export function normalizeDesktopPetPresentation(value: unknown): DesktopPetPresentation {
  const record = isRecord(value) ? value : {}
  const selectedPetId =
    typeof record.selectedPetId === 'string' &&
    record.selectedPetId.length > 0 &&
    record.selectedPetId.length <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(record.selectedPetId)
      ? record.selectedPetId
      : null
  const rawSize =
    typeof record.size === 'number' && Number.isFinite(record.size)
      ? Math.round(record.size)
      : PET_AVATAR_MIN_SIZE
  return {
    selectedPetId,
    size: Math.min(PET_AVATAR_MAX_SIZE, Math.max(PET_AVATAR_MIN_SIZE, rawSize)),
  }
}
