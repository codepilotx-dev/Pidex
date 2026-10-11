import type {
  BrowserAnnotation,
  BrowserAnnotationEditor,
  BrowserAnnotationMode,
} from './BrowserAnnotation.js'
export type {
  BrowserAnnotation,
  BrowserAnnotationAnchor,
  BrowserAnnotationEditor,
  BrowserAnnotationMode,
} from './BrowserAnnotation.js'

export const DESKTOP_BROWSER_IPC_CHANNELS = {
  annotation: 'desktop-browser:annotation',
  annotationEvent: 'desktop-browser:annotation-event',
  utility: 'desktop-browser:utility',
  utilityEvent: 'desktop-browser:utility-event',
  data: 'desktop-browser:data',
  dataChanged: 'desktop-browser:data-changed',
  list: 'desktop-browser:list',
  attach: 'desktop-browser:attach',
  control: 'desktop-browser:control',
  layout: 'desktop-browser:layout',
  permission: 'desktop-browser:permission',
  getState: 'desktop-browser:get-state',
  createOrRestore: 'desktop-browser:create-or-restore',
  navigate: 'desktop-browser:navigate',
  reload: 'desktop-browser:reload',
  stop: 'desktop-browser:stop',
  goBack: 'desktop-browser:go-back',
  goForward: 'desktop-browser:go-forward',
  setBounds: 'desktop-browser:set-bounds',
  setVisible: 'desktop-browser:set-visible',
  focus: 'desktop-browser:focus',
  close: 'desktop-browser:close',
  clearAllowedSites: 'desktop-browser:clear-allowed-sites',
  stateChanged: 'desktop-browser:state-changed',
} as const

export interface DesktopBrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopBrowserSitePermission {
  origin: string
  decision: 'allow' | 'deny'
  updatedAt: string
}

export interface DesktopBrowserSnapshot {
  features?: { utilities: boolean; data: boolean; annotations?: boolean }
  historyEpoch?: number
  zoomFactor?: number
  device?: DesktopBrowserDevice
  tabId: string
  windowId?: string
  sourceThreadId?: string | null
  controlThreadId?: string | null
  generation?: string
  documentId?: string
  state?: 'parked' | 'live' | 'suspended' | 'crashed'
  busy?: boolean
  viewport?: { width: number; height: number }
  panel?: 'right' | 'bottom'
  order?: number
  history?: ReadonlyArray<{ url: string; title: string }>
  historyIndex?: number
  revision?: number
  open: boolean
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
  allowedSites: string[]
  sitePermissions: DesktopBrowserSitePermission[]
}

export interface DesktopBrowserTabInput {
  tabId: string
}
export type DesktopBrowserAnnotationOperation =
  | {
      action: 'start'
      mode: BrowserAnnotationMode
      annotations: BrowserAnnotation[]
      editor?: BrowserAnnotationEditor
      theme: Record<string, string>
    }
  | { action: 'stop' }
  | {
      action: 'sync'
      mode: BrowserAnnotationMode
      annotations: BrowserAnnotation[]
      editor?: BrowserAnnotationEditor
    }
  | { action: 'capture' }
  | { action: 'result'; error?: string }
export type DesktopBrowserAnnotationInput = DesktopBrowserTabInput & {
  generation: string
  documentId: string
  interactionId?: string
  operation: DesktopBrowserAnnotationOperation
}
export type DesktopBrowserAnnotationResult = {
  interactionId?: string
  documentId?: string
  image?: { data: string; mimeType: 'image/png' }
}
export type DesktopBrowserAnnotationEvent = {
  tabId: string
  generation: string
  documentId: string
  interactionId: string
} & (
  | { kind: 'editor'; editor: BrowserAnnotationEditor | null }
  | { kind: 'save'; editor: BrowserAnnotationEditor; textOnly: boolean }
  | { kind: 'delete'; id: string }
  | { kind: 'invalid'; ids: string[] }
  | { kind: 'stopped' }
)
export interface DesktopBrowserDevice {
  mode: 'desktop' | 'mobile' | 'tablet' | 'custom'
  width: number
  height: number
}
export type DesktopBrowserUtility =
  | { action: 'find'; text: string; forward: boolean; findNext: boolean }
  | { action: 'stopFind' }
  | { action: 'zoom'; direction: 'in' | 'out' | 'reset' }
  | { action: 'print'; pdf: boolean }
  | { action: 'device'; device: DesktopBrowserDevice }
  | { action: 'screenshot'; destination: 'copy' | 'save' | 'composer' }
export type DesktopBrowserUtilityInput = DesktopBrowserTabInput & {
  generation: string
  operation: DesktopBrowserUtility
}
export type DesktopBrowserUtilityResult = {
  message?: string
  image?: { data: string; mimeType: 'image/png' }
  requestId?: number
}
export type DesktopBrowserUtilityEvent = { tabId: string; generation: string } & (
  | { kind: 'find-open' }
  | { kind: 'find-close' }
  | {
      kind: 'find-result'
      requestId: number
      matches: number
      activeMatchOrdinal: number
      finalUpdate: boolean
    }
)
export interface DesktopBrowserVisit {
  id: string
  tabId: string
  sourceThreadId: string | null
  url: string
  title: string
  visitedAt: number
}
export interface DesktopBrowserDownload {
  id: string
  tabId: string
  profileId: string
  runId: string
  fileName: string
  url: string
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'
  receivedBytes: number
  totalBytes: number
  startedAt: number
  updatedAt: number
  resumable: boolean
  controllable?: boolean
}
export type DesktopBrowserDataCategory = 'history' | 'downloads' | 'cache' | 'siteData'
export type DesktopBrowserDataRequest =
  | { action: 'history'; query?: string; cursor?: string }
  | { action: 'removeHistory'; id: string }
  | { action: 'downloads' }
  | {
      action: 'downloadAction'
      id: string
      command: 'pause' | 'resume' | 'cancel' | 'open' | 'reveal' | 'remove'
    }
  | { action: 'preferences'; downloadSaveMode?: 'downloads' | 'ask' }
  | { action: 'clear'; categories: DesktopBrowserDataCategory[] }
export type DesktopBrowserDataResult = {
  visits?: readonly DesktopBrowserVisit[]
  nextCursor?: string | null
  downloads?: readonly DesktopBrowserDownload[]
  preferences?: { downloadSaveMode: 'downloads' | 'ask' }
  cleared?: { category: DesktopBrowserDataCategory; ok: boolean; message?: string }[]
}

export interface CreateOrRestoreDesktopBrowserInput extends DesktopBrowserTabInput {
  url?: string
  sourceThreadId?: string | null
}

export interface NavigateDesktopBrowserInput extends DesktopBrowserTabInput {
  url: string
}

export interface SetDesktopBrowserBoundsInput extends DesktopBrowserTabInput {
  bounds: DesktopBrowserBounds
}

export interface SetDesktopBrowserVisibleInput extends DesktopBrowserTabInput {
  visible: boolean
}

export interface DesktopBrowserIpcBridge {
  performDesktopBrowserAnnotation(
    input: DesktopBrowserAnnotationInput,
  ): Promise<DesktopBrowserAnnotationResult>
  onDesktopBrowserAnnotationEvent(
    listener: (event: DesktopBrowserAnnotationEvent) => void,
  ): () => void
  performDesktopBrowserUtility(
    input: DesktopBrowserUtilityInput,
  ): Promise<DesktopBrowserUtilityResult>
  manageDesktopBrowserData(input: DesktopBrowserDataRequest): Promise<DesktopBrowserDataResult>
  onDesktopBrowserUtilityEvent(listener: (event: DesktopBrowserUtilityEvent) => void): () => void
  onDesktopBrowserDataChange(listener: () => void): () => void
  listDesktopBrowserTabs(): Promise<DesktopBrowserSnapshot[]>
  attachDesktopBrowserGuest(input: {
    tabId: string
    generation: string
    guestId: number
  }): Promise<void>
  controlDesktopBrowser(input: {
    tabId: string
    threadId: string | null
  }): Promise<DesktopBrowserSnapshot>
  layoutDesktopBrowser(input: {
    tabId: string
    panel: 'right' | 'bottom'
    order: number
  }): Promise<void>
  setDesktopBrowserPermission(input: {
    origin: string
    decision: 'allow' | 'deny' | 'remove'
  }): Promise<DesktopBrowserSitePermission[]>
  getDesktopBrowserState(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  createOrRestoreDesktopBrowser(
    input: CreateOrRestoreDesktopBrowserInput,
  ): Promise<DesktopBrowserSnapshot>
  navigateDesktopBrowser(input: NavigateDesktopBrowserInput): Promise<DesktopBrowserSnapshot>
  reloadDesktopBrowser(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  stopDesktopBrowser(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  goBackDesktopBrowser(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  goForwardDesktopBrowser(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  setDesktopBrowserBounds(input: SetDesktopBrowserBoundsInput): Promise<DesktopBrowserSnapshot>
  setDesktopBrowserVisible(input: SetDesktopBrowserVisibleInput): Promise<DesktopBrowserSnapshot>
  focusDesktopBrowser(input: DesktopBrowserTabInput): Promise<void>
  closeDesktopBrowser(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  clearDesktopBrowserAllowedSites(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  onDesktopBrowserStateChange(listener: (state: DesktopBrowserSnapshot) => void): () => void
}
