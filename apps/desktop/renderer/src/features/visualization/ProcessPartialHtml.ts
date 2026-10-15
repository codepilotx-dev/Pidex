// Adapted from CopilotKit/OpenIntelligentUI process-partial-html.ts (MIT).
// Source revision and license are recorded in UPSTREAM.md.
// This improves incomplete layouts; it is not an HTML sanitizer.
export function processPartialHtml(html: string): string {
  let result = html.replace(/<[^>]*$/, '')
  result = result.replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  result = result.replace(/<(style|script|head)\b[^>]*>[\s\S]*$/gi, '')
  result = result.replace(/&[a-zA-Z0-9#]*$/, '')
  const body = result.match(/<body[^>]*>([\s\S]*)/i)
  return body ? body[1]!.replace(/<\/body>[\s\S]*/i, '') : result
}
