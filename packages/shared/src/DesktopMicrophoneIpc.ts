export const DESKTOP_MICROPHONE_IPC_CHANNELS = {
  openPrivacySettings: 'desktop-microphone:open-privacy-settings',
} as const

export interface DesktopMicrophoneIpcBridge {
  openMicrophonePrivacySettings(): Promise<void>
}
