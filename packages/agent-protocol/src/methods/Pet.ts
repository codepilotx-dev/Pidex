import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { EmptyParamsSchema, NonEmptyStringSchema, OperationParamsSchema } from '../wire/Primitives'

const PetIDSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/))
const PetErrors = [
  'PET_NOT_FOUND',
  'PET_INVALID',
  'PET_DOWNLOAD_FAILED',
  'PET_STORAGE_FAILED',
  'PATH_DENIED',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const

export const PetManifestSchema = Schema.Struct({
  id: PetIDSchema,
  displayName: NonEmptyStringSchema,
  description: Schema.optional(Schema.String),
  spriteVersionNumber: Schema.Literals([1, 2]),
  spritesheetPath: NonEmptyStringSchema,
})

export const PetDescriptorSchema = Schema.Struct({
  ...PetManifestSchema.fields,
  spritesheetUrl: NonEmptyStringSchema,
  installed: Schema.Boolean,
})

export const PetListResultSchema = Schema.Struct({
  pets: Schema.Array(PetDescriptorSchema),
})

export const PetLicenseKindSchema = Schema.Literals([
  'permissive',
  'attribution',
  'restricted',
  'unknown',
])

export const PetCatalogItemSchema = Schema.Struct({
  slug: PetIDSchema,
  displayName: NonEmptyStringSchema,
  englishName: Schema.optional(NonEmptyStringSchema),
  description: Schema.optional(NonEmptyStringSchema),
  author: NonEmptyStringSchema,
  category: NonEmptyStringSchema,
  categoryLabel: NonEmptyStringSchema,
  spriteVersionNumber: Schema.Literals([1, 2]),
  license: NonEmptyStringSchema,
  licenseKind: PetLicenseKindSchema,
  previewUrl: NonEmptyStringSchema,
  installed: Schema.Boolean,
})

export const PetCatalogResultSchema = Schema.Struct({
  pets: Schema.Array(PetCatalogItemSchema),
  fetchedAt: Schema.NullOr(NonEmptyStringSchema),
  cacheState: Schema.Literals(['fresh', 'stale', 'unavailable']),
})

export const PetCatalogListParamsSchema = Schema.Struct({
  refresh: Schema.optional(Schema.Boolean),
})

export const PetCatalogInstallParamsSchema = Schema.Struct({
  slug: PetIDSchema,
  acceptedRestrictedLicense: Schema.Boolean,
  ...OperationParamsSchema.fields,
})

export const PetInstallPreviewParamsSchema = Schema.Struct({
  url: NonEmptyStringSchema,
})

export const PetInstallPreviewResultSchema = Schema.Struct({
  pet: PetDescriptorSchema,
  sourceUrl: NonEmptyStringSchema,
  sizeBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type PetManifest = typeof PetManifestSchema.Type
export type PetDescriptor = typeof PetDescriptorSchema.Type
export type PetInstallPreview = typeof PetInstallPreviewResultSchema.Type
export type PetLicenseKind = typeof PetLicenseKindSchema.Type
export type PetCatalogItem = typeof PetCatalogItemSchema.Type
export type PetCatalogResult = typeof PetCatalogResultSchema.Type
export type PetCatalogInstallParams = typeof PetCatalogInstallParamsSchema.Type

export const PetInstallParamsSchema = Schema.Struct({
  url: NonEmptyStringSchema,
  ...OperationParamsSchema.fields,
})

export const PetInstallResultSchema = Schema.Struct({
  pet: PetDescriptorSchema,
})

export const PetRemoveParamsSchema = Schema.Struct({
  id: PetIDSchema,
  ...OperationParamsSchema.fields,
})

export const PetRemoveResultSchema = Schema.Struct({
  id: PetIDSchema,
  removed: Schema.Literal(true),
})

export const PetRpcMethods = {
  'pet/list': defineMethod({
    params: EmptyParamsSchema,
    result: PetListResultSchema,
    errors: PetErrors,
    capability: 'pets.management.v1',
    mutation: false,
    exactResult: true,
  }),
  'pet/catalog/list': defineMethod({
    params: PetCatalogListParamsSchema,
    result: PetCatalogResultSchema,
    errors: PetErrors,
    capability: 'pets.management.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'pet/catalog/install': defineMethod({
    params: PetCatalogInstallParamsSchema,
    result: PetInstallResultSchema,
    errors: PetErrors,
    capability: 'pets.management.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'pet/install/preview': defineMethod({
    params: PetInstallPreviewParamsSchema,
    result: PetInstallPreviewResultSchema,
    errors: PetErrors,
    capability: 'pets.management.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'pet/install': defineMethod({
    params: PetInstallParamsSchema,
    result: PetInstallResultSchema,
    errors: PetErrors,
    capability: 'pets.management.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'pet/remove': defineMethod({
    params: PetRemoveParamsSchema,
    result: PetRemoveResultSchema,
    errors: PetErrors,
    capability: 'pets.management.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type PetRpcMethod = keyof typeof PetRpcMethods
