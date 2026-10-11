import type { PromptTemplate } from '../../orchestration/harness/Types.ts'

/** Substitute prompt template placeholders (`$1`, `$@`, `$ARGUMENTS`, `${@:N}`, `${@:N:L}`) with command arguments. */
export function substituteArgs(content: string, args: string[]): string {
  let result = content
  result = result.replace(/\$(\d+)/g, (_, num: string) => args[parseInt(num, 10) - 1] ?? '')
  result = result.replace(
    /\$\{@:(\d+)(?::(\d+))?\}/g,
    (_, startStr: string, lengthStr?: string) => {
      let start = parseInt(startStr, 10) - 1
      if (start < 0) start = 0
      if (lengthStr) return args.slice(start, start + parseInt(lengthStr, 10)).join(' ')
      return args.slice(start).join(' ')
    },
  )
  const allArgs = args.join(' ')
  result = result.replace(/\$ARGUMENTS/g, allArgs)
  result = result.replace(/\$@/g, allArgs)
  return result
}

/** Format a prompt template invocation with positional arguments. */
export function formatPromptTemplateInvocation(
  template: PromptTemplate,
  args: string[] = [],
): string {
  return substituteArgs(template.content, args)
}
