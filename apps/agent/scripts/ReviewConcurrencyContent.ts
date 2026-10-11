export const REVIEW_CONCURRENCY_LINE_COUNT = 900
export const REVIEW_CONCURRENCY_CHANGED_LINE_COUNT = 450

export function createReviewConcurrencyFileContent(
  sessionIndex: number,
  state: 'initial' | 'preview' | 'updated',
): string {
  return Array.from({ length: REVIEW_CONCURRENCY_LINE_COUNT }, (_, zeroBasedLine) => {
    const line = zeroBasedLine + 1
    const value =
      state !== 'initial' && line <= REVIEW_CONCURRENCY_CHANGED_LINE_COUNT
        ? state === 'updated'
          ? `updated-by-thread-${sessionIndex}`
          : `preview-before-concurrency-${sessionIndex}`
        : `initial-${sessionIndex}`
    return (
      `export const session${sessionIndex}Line${String(line).padStart(4, '0')} = ` +
      `"${value}-${line}"\n`
    )
  }).join('')
}
