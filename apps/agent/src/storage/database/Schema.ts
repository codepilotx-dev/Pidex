/**
 * Forward-compatible history baseline. Future schema changes must preserve the
 * read/write contract of schema 21 so patched older clients can ignore features
 * they do not understand.
 */
export const SCHEMA_VERSION = 65

/**
 * Stable ownership marker for Pidex history storage. This is not a schema
 * version and must not change when features or additive migrations are added.
 */
export const HISTORY_APPLICATION_ID = 3

/** Known prerelease ownership markers that can be upgraded without data loss. */
export const LEGACY_HISTORY_APPLICATION_IDS: ReadonlySet<number> = new Set([2])

/** @deprecated Use HISTORY_APPLICATION_ID. Retained for source compatibility. */
export const DATA_EPOCH = HISTORY_APPLICATION_ID

/** Profile schema 3 is the forward-compatible profile baseline. */
export const PROFILE_SCHEMA_VERSION = 4
/** Profile ownership marker spelling the product name in ASCII (PDXP). */
export const PROFILE_APPLICATION_ID = 0x50445850
