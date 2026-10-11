export function formatReviewCount(value: number): string {
  return Math.max(0, value).toLocaleString('en-US')
}
