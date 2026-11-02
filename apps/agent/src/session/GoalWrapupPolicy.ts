/** The same output ceiling is used for admission and the actual Provider call. */
export const GOAL_WRAPUP_OUTPUT_TOKENS = 1024
export const GOAL_WRAPUP_INPUT_TOKENS = 3072

export function goalBudgetAdmission(input: {
  remaining: number
  reserve: number
  inputTokens: number
  outputTokens: number
  wrapupInputTokens: number
}): 'work' | 'wrapup' | 'denied' {
  const summaryCost = input.wrapupInputTokens + GOAL_WRAPUP_OUTPUT_TOKENS
  if (
    input.remaining >=
    input.inputTokens + input.outputTokens + Math.max(input.reserve, summaryCost)
  )
    return 'work'
  return input.remaining >= summaryCost ? 'wrapup' : 'denied'
}
