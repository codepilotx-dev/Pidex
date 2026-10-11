import {
  PetCatalogInstallParamsSchema,
  PetCatalogListParamsSchema,
  PetInstallParamsSchema,
  PetInstallPreviewParamsSchema,
  PetRemoveParamsSchema,
  type RpcMethod,
} from '@pidex/agent-protocol'
import { Schema } from 'effect'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const decodePreview = Schema.decodeUnknownSync(PetInstallPreviewParamsSchema)
const decodeInstall = Schema.decodeUnknownSync(PetInstallParamsSchema)
const decodeRemove = Schema.decodeUnknownSync(PetRemoveParamsSchema)
const decodeCatalogList = Schema.decodeUnknownSync(PetCatalogListParamsSchema)
const decodeCatalogInstall = Schema.decodeUnknownSync(PetCatalogInstallParamsSchema)

export const petHandlers = {
  name: 'pet',
  methods: [
    'pet/list',
    'pet/catalog/list',
    'pet/catalog/install',
    'pet/install/preview',
    'pet/install',
    'pet/remove',
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    const pets = runtime.dependencies.pets
    switch (method) {
      case 'pet/list':
        return { pets: await pets.list() }
      case 'pet/catalog/list':
        return pets.catalog(decodeCatalogList(rawParams).refresh ?? false)
      case 'pet/catalog/install': {
        const { slug, acceptedRestrictedLicense } = decodeCatalogInstall(rawParams)
        return {
          pet: await pets.installCatalog(slug, acceptedRestrictedLicense),
        }
      }
      case 'pet/install/preview':
        return pets.preview(decodePreview(rawParams).url)
      case 'pet/install':
        return { pet: await pets.install(decodeInstall(rawParams).url) }
      case 'pet/remove': {
        const { id } = decodeRemove(rawParams)
        await pets.remove(id)
        return { id, removed: true }
      }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
