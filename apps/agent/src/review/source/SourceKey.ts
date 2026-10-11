import type { ReviewSource } from '@pidex/agent-protocol'

export const reviewSourceKey = (source: ReviewSource) => JSON.stringify(source)
