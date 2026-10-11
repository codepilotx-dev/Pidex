export const SPEECH_RUNTIME_VERSION = '0.1.9' as const
export const SPEECH_MODEL_ID = 'sensevoice-small-q8' as const
export const SPEECH_MAX_AUDIO_BYTES = 4_194_304 as const
export const SPEECH_MAX_DURATION_MS = 120_000 as const

export type SpeechRuntimeVariant = 'avx2' | 'generic'

export const SPEECH_ARTIFACTS = {
  generic: {
    url: 'https://github.com/QwenAudio/SenseVoice/releases/download/runtime-llamacpp-v0.1.9/funasr-llamacpp-windows-x64.zip',
    sha256: '6767af74e42c8b928742e12d5995c139636d9482ea151cdbb51f1b7573667772',
    maximumBytes: 4_685_477,
    expectedBytes: 4_685_477,
    executableBytes: 1_518_080,
    executableSha256: 'aa8b830411c3ccd038f8e9dbf138f05b663caf712850fe5f7da8c12247592acb',
    kind: 'zip',
  },
  avx2: {
    url: 'https://github.com/QwenAudio/SenseVoice/releases/download/runtime-llamacpp-v0.1.9/funasr-llamacpp-windows-x64-avx2.zip',
    sha256: 'f2a1389658e6fb5f5f93c7bad98b5ce100eb4811e0e3c39603e39466773b1b4c',
    maximumBytes: 4_917_274,
    expectedBytes: 4_917_274,
    executableBytes: 1_651_712,
    executableSha256: 'a1b40105cd0e0956ec0f34e8787cf2fa4eb39383aaa72b82e5f97a7118f24f3c',
    kind: 'zip',
  },
  model: {
    url: 'https://huggingface.co/FunAudioLLM/SenseVoiceSmall-GGUF/resolve/90c1c61912018b70ada0fcc024ea24aca62f2e63/sensevoice-small-q8.gguf?download=true',
    sha256: '4ae45c94422de949b387e2e0fb10d7e14e4c42c69db30c3444ecc7d4b844b7c5',
    maximumBytes: 300 * 1024 * 1024,
    expectedBytes: 254_208_320,
    kind: 'file',
  },
  vad: {
    url: 'https://huggingface.co/FunAudioLLM/fsmn-vad-GGUF/resolve/6840bae4c5c92ee8c04faaf4db23dd0105098d7f/fsmn-vad.gguf?download=true',
    sha256: '1270f2559c495f4e7b6e739541151027d360761a3fda43fc147034f5719f5479',
    maximumBytes: 4 * 1024 * 1024,
    expectedBytes: 1_720_512,
    kind: 'file',
  },
} as const

export const SPEECH_EXECUTABLE = 'llama-funasr-sensevoice.exe'
