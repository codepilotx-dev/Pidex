const PLAIN_TEXT_ALIASES = new Set(['', 'none', 'plain', 'plaintext', 'text', 'txt'])

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  'c#': 'csharp',
  'c++': 'cpp',
  'c-sharp': 'csharp',
  csharp: 'csharp',
  cs: 'csharp',
  docker: 'dockerfile',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  kt: 'kotlin',
  md: 'markdown',
  objc: 'objective-c',
  patch: 'diff',
  ps: 'powershell',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shellscript',
  shell: 'shellscript',
  'shell-session': 'shellsession',
  ts: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  yml: 'yaml',
}

const FILE_EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  bash: 'shellscript',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cmake: 'cmake',
  conf: 'ini',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  csv: 'csv',
  cts: 'typescript',
  diff: 'diff',
  dockerfile: 'dockerfile',
  env: 'dotenv',
  go: 'go',
  gql: 'graphql',
  graphql: 'graphql',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  json5: 'json5',
  jsonc: 'jsonc',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  md: 'markdown',
  mdx: 'mdx',
  mjs: 'javascript',
  mts: 'typescript',
  patch: 'diff',
  php: 'php',
  plist: 'xml',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sass: 'sass',
  scss: 'scss',
  sh: 'shellscript',
  sql: 'sql',
  svelte: 'svelte',
  svg: 'xml',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  txt: 'text',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shellscript',
}

const FILE_NAME_LANGUAGES: Readonly<Record<string, string>> = {
  '.env': 'dotenv',
  '.gitattributes': 'git-commit',
  '.gitignore': 'git-commit',
  'cmakelists.txt': 'cmake',
  dockerfile: 'dockerfile',
  gemfile: 'ruby',
  makefile: 'make',
}

export function normalizeSyntaxLanguage(language?: string | null): string {
  const normalized = (language ?? '')
    .trim()
    .replace(/^language-/i, '')
    .split(/[\s,{]/, 1)[0]
    ?.toLowerCase()

  if (!normalized || PLAIN_TEXT_ALIASES.has(normalized)) return 'text'
  return LANGUAGE_ALIASES[normalized] ?? normalized
}

export function resolveLanguageFromPath(path: string): string {
  const fileName = path.trim().replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? ''
  const normalizedFileName = fileName.toLowerCase()
  const fileNameLanguage = FILE_NAME_LANGUAGES[normalizedFileName]
  if (fileNameLanguage) return fileNameLanguage

  if (normalizedFileName.startsWith('.env.')) return 'dotenv'

  const extension = normalizedFileName.includes('.')
    ? (normalizedFileName.split('.').at(-1) ?? '')
    : ''
  return FILE_EXTENSION_LANGUAGES[extension] ?? 'text'
}

export function formatSyntaxLanguageLabel(language?: string | null): string {
  const normalized = normalizeSyntaxLanguage(language)
  if (normalized === 'shellscript') return 'shell'
  return normalized
}
