import React, { useCallback, useEffect, useRef, useState } from 'react'

import { Input } from '../../components/ui/Input.js'
import type { DesktopSystemFontFace, DesktopThemeFontFace } from '../../../shared/Types.js'
import {
  getCachedSystemFontsPromise,
  isMonospaceFamily,
  listSystemFonts,
} from '../theme/ThemeSystemFonts.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import {
  DEFAULT_FACE_VALUE,
  LOADING_OPTION_VALUE,
  SYSTEM_DEFAULT_FAMILY_VALUE,
  buildFamilyOptions,
  buildStyleOptions,
  facesOfFamily,
  fontPatchForSelection,
  fontPickerCurrentFamilyLabel,
  fontPickerCurrentFamilyValue,
  selectedStyleValue,
  type FontPickerKind,
  type FontPickerOption,
} from './ThemeFontPickerModel.js'

type ThemeFontPickerProps = {
  ariaLabel: string
  placeholder: string
  family: string | null
  face: DesktopThemeFontFace | null
  kind: FontPickerKind
  controls?: 'family' | 'style' | 'both'
  onCommit: (family: string | null, face: DesktopThemeFontFace | null) => void
}

/**
 * Free-text fallback used when the system font enumeration is unavailable or
 * denied. Committing an unchanged family keeps the stored face; editing the
 * family text clears it so a stale face never rides along.
 */
function FontInput({
  ariaLabel,
  placeholder,
  value,
  onCommit,
}: {
  ariaLabel: string
  placeholder: string
  value: string | null
  onCommit: (value: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  const focusedRef = useRef(false)
  const skipBlurCommitRef = useRef(false)
  const latestValueRef = useRef(value)

  useEffect(() => {
    latestValueRef.current = value
    if (!focusedRef.current) setDraft(value ?? '')
  }, [value])

  const commit = (): void => {
    const next = draft.trim() || null
    setDraft(next ?? '')
    if (next !== latestValueRef.current) {
      latestValueRef.current = next
      // Editing the family text means the old face no longer matches.
      onCommit(next)
    }
  }

  return (
    <Input
      aria-label={ariaLabel}
      className="appearance-font-input tw:h-7 tw:min-h-7 tw:w-full tw:max-w-34 tw:rounded-md tw:px-2 tw:type-body tw:@max-[760px]:w-[min(100%,240px)] tw:@max-[760px]:max-w-60"
      placeholder={placeholder}
      value={draft}
      onBlur={() => {
        focusedRef.current = false
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false
          return
        }
        commit()
      }}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => {
        focusedRef.current = true
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          skipBlurCommitRef.current = true
          setDraft(latestValueRef.current ?? '')
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function ThemeFontPicker({
  ariaLabel,
  placeholder,
  family,
  face,
  kind,
  controls = 'both',
  onCommit,
}: ThemeFontPickerProps): React.ReactNode {
  const [bridgeAvailable] = useState(
    () =>
      typeof window !== 'undefined' && typeof window.DesktopBridge?.listSystemFonts === 'function',
  )
  const [fontsState, setFontsState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [faces, setFaces] = useState<readonly DesktopSystemFontFace[]>([])

  useEffect(() => {
    if (!bridgeAvailable || fontsState !== 'idle') return
    const cached = getCachedSystemFontsPromise()
    if (cached) {
      void cached.then((result) => {
        if (result.ok) {
          setFaces(result.fonts)
          setFontsState('ready')
        } else {
          setFontsState('unavailable')
        }
      })
    }
  }, [bridgeAvailable, fontsState, family])

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (!open || fontsState !== 'idle') return
      setFontsState('loading')
      void listSystemFonts().then((result) => {
        if (result.ok) {
          setFaces(result.fonts)
          setFontsState('ready')
        } else {
          // Unsupported API, denied permission, or failed query: the UI
          // degrades to the free-text input without surfacing an error.
          setFontsState('unavailable')
        }
      })
    },
    [fontsState],
  )

  if (!bridgeAvailable || fontsState === 'unavailable') {
    if (controls === 'style') {
      return (
        <SettingsDropdown
          ariaLabel={`${ariaLabel}字体样式`}
          disabled
          onChange={() => undefined}
          options={buildStyleOptions({ faces: [], currentFace: face })}
          value={selectedStyleValue({ faces: [], currentFace: face })}
          size="sm"
        />
      )
    }
    return (
      <FontInput
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        value={family}
        onCommit={(next) => onCommit(next, null)}
      />
    )
  }

  const currentFamilyValue = fontPickerCurrentFamilyValue(family)
  const currentFamilyLabel = fontPickerCurrentFamilyLabel(family, face)
  const selectedFamilyFaces = family ? facesOfFamily(faces, family) : []

  const familyOptions: FontPickerOption[] =
    fontsState === 'ready'
      ? buildFamilyOptions({
          faces,
          kind,
          currentFamily: family,
          isMonospace: isMonospaceFamily,
        })
      : [
          {
            value: currentFamilyValue,
            label: currentFamilyLabel,
            disabled: true,
          },
          ...(fontsState === 'loading'
            ? [
                {
                  value: LOADING_OPTION_VALUE,
                  label: '正在加载字体…',
                  disabled: true,
                },
              ]
            : []),
        ]

  return (
    <div
      aria-busy={fontsState === 'loading'}
      className="appearance-theme-font-row tw:inline-flex tw:w-max tw:max-w-full tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2"
    >
      {controls !== 'style' ? (
        <SettingsDropdown
          ariaLabel={`${ariaLabel}字体家族`}
          options={familyOptions}
          searchPlaceholder="搜索字体…"
          searchable
          triggerClassName="appearance-font-family"
          value={currentFamilyValue}
          size="md"

          onChange={(familyValue) => {
            if (fontsState !== 'ready') return
            if (familyValue === family) {
              // Re-selecting the current family keeps the stored face.
              onCommit(family, face)
              return
            }
            const patch = fontPatchForSelection({
              familyValue,
              faceValue: DEFAULT_FACE_VALUE,
              familyFaces: facesOfFamily(faces, familyValue),
              currentFace: null,
            })
            onCommit(patch.family, patch.face)
          }}
          onOpenChange={handleOpenChange}
        />
      ) : null}
      {controls !== 'family' && (family != null || controls === 'style') ? (
        <SettingsDropdown
          ariaLabel={`${ariaLabel}字体样式`}
          disabled={family == null || (fontsState === 'ready' && selectedFamilyFaces.length <= 1)}
          options={buildStyleOptions({
            faces: selectedFamilyFaces,
            currentFace: face,
          })}
          triggerClassName="appearance-font-style"
          value={selectedStyleValue({
            faces: selectedFamilyFaces,
            currentFace: face,
          })}
          size="sm"
          onOpenChange={handleOpenChange}
          onChange={(faceValue) => {
            if (fontsState !== 'ready' || family == null) return
            const patch = fontPatchForSelection({
              familyValue: family,
              faceValue,
              familyFaces: selectedFamilyFaces,
              currentFace: face,
            })
            onCommit(patch.family, patch.face)
          }}
        />
      ) : null}
    </div>
  )
}
