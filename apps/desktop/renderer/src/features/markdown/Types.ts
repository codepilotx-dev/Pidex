import type React from 'react'
import type { Token } from 'marked'

export type MarkdownMathToken = {
  type: 'math'
  raw: string
  text: string
  display: boolean
}

export type MarkdownDirectiveToken = {
  type: 'directive'
  raw: string
  name: string
  argument: string
  attributes: Readonly<Record<string, string>>
  text: string
  tokens: MarkdownToken[]
}

export type MarkdownStreamingCodeToken = {
  type: 'streaming_code'
  raw: string
  lang: string
  text: string
}

export type MarkdownStreamingTextToken = {
  type: 'streaming_text'
  raw: string
  text: string
}

export type MarkdownToken =
  | Token
  | MarkdownMathToken
  | MarkdownDirectiveToken
  | MarkdownStreamingCodeToken
  | MarkdownStreamingTextToken

export type MarkdownDirectiveRenderProps = {
  argument: string
  attributes: Readonly<Record<string, string>>
  children: React.ReactNode
  name: string
  rawText: string
}

export type MarkdownDirectiveRenderer = (props: MarkdownDirectiveRenderProps) => React.ReactNode

export type MarkdownDirectiveRegistry = ReadonlyMap<string, MarkdownDirectiveRenderer>

export type MarkdownExternalResourcePolicy = {
  allowExternalLinks?: boolean
  allowExternalUrl?: (url: string) => boolean
  allowRemoteMedia?: boolean
}

export type MarkdownFileReference = {
  path: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export type MarkdownFileOpenOptions = {
  preview: boolean
}

export type MarkdownParseResult = {
  tokens: MarkdownToken[]
  stableText: string
  pendingText: string
}

export type MarkdownRenderBlock = {
  id: string
  raw: string
  tokens: MarkdownToken[]
  state: 'stable' | 'pending'
  visibleText: string
}
