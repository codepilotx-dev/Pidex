import { describe, expect, test } from 'bun:test'
import {
  normalizeDesktopPetPresentation,
  PET_OVERLAY_CHANNELS,
} from '@pidex/shared/desktop-pet-overlay'
import { DESKTOP_SETTINGS_IPC_CHANNELS } from '@pidex/shared/desktop-settings-ipc'

describe('pet overlay shared contracts', () => {
  test('normalizes presentation identity and clamps avatar size', () => {
    expect(
      normalizeDesktopPetPresentation({
        selectedPetId: 'friendly_pet-2',
        size: 199.6,
      }),
    ).toEqual({ selectedPetId: 'friendly_pet-2', size: 200 })
    expect(
      normalizeDesktopPetPresentation({
        selectedPetId: '../outside',
        size: 999,
      }),
    ).toEqual({ selectedPetId: null, size: 224 })
    expect(normalizeDesktopPetPresentation(null)).toEqual({ selectedPetId: null, size: 80 })
  })

  test('keeps preload-facing channel names centralized', () => {
    expect(PET_OVERLAY_CHANNELS.previewPresentation).toBe(
      'desktop-pet-overlay:preview-presentation',
    )
    expect(PET_OVERLAY_CHANNELS.presentationPreview).toBe(
      'desktop-pet-overlay:presentation-preview',
    )
    expect(PET_OVERLAY_CHANNELS.getGlobalPointerPosition).toBe(
      'desktop-pet-overlay:get-global-pointer-position',
    )
    expect(DESKTOP_SETTINGS_IPC_CHANNELS.changed).toBe('desktop-settings:changed')
  })
})
