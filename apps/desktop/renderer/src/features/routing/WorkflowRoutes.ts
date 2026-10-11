/**
 * Legacy `/session-groups` paths redirect to the canonical `/workflows` routes.
 * The selected workflow id and any query string are preserved so a bookmarked or
 * deep-linked legacy URL still lands on the same workflow.
 */
export const legacyWorkflowRedirectPath = (pathname: string, search: string): string =>
  `${pathname.replace(/^\/session-groups/, '/workflows')}${search}`
