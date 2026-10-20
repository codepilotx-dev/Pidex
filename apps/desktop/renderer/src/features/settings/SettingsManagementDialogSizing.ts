/**
 * Single source of truth for `.settings-management-dialog` sizing.
 *
 * The dialog surface keeps only its layout contract (flex column, overflow,
 * colour). Width and max-height are owned here as utilities so each dialog
 * picks one named entry instead of relying on a CSS default plus per-call
 * arbitrary values. Every value is carried over verbatim from its previous
 * call site, so this remains an ownership change rather than a visual one.
 */
export const SETTINGS_MANAGEMENT_DIALOG_SIZE = {
  pluginDetails:
    'tw:w-[min(56rem,calc(100vw_-_var(--cpx-sys-space-8)))] tw:max-h-[min(56rem,calc(100vh_-_var(--cpx-sys-space-8)))]',
  providerModels: 'tw:w-[min(680px,calc(100vw_-_32px))] tw:max-h-[85vh]',
  discoveredModels:
    'tw:w-[min(840px,calc(100vw_-_32px))] tw:max-h-[85vh] tw:max-[840px]:w-[calc(100vw_-_16px)]',
  providerEditor:
    'tw:w-[min(720px,calc(100vw_-_32px))] tw:max-h-[min(85vh,780px)] tw:max-[720px]:w-[calc(100vw_-_16px)] tw:max-[720px]:max-h-[calc(100vh_-_16px)]',
  navigationGuard:
    'tw:w-[min(480px,calc(100vw_-_32px))] tw:max-h-[min(48rem,calc(100vh_-_var(--cpx-sys-space-8)))]',
  credential: 'tw:w-[min(520px,calc(100vw_-_48px))] tw:max-h-[min(720px,calc(100vh_-_48px))]',
  connection: 'tw:w-[min(600px,calc(100vw_-_48px))] tw:max-h-[min(720px,calc(100vh_-_48px))]',
  mcpEditor: 'tw:max-h-[min(48rem,calc(100vh-3rem))] tw:w-[min(44rem,calc(100vw-3rem))]',
  skillDetails: 'tw:max-h-[min(42rem,calc(100vh-3rem))] tw:w-[min(48rem,calc(100vw-3rem))]',
} as const
