// Generated from material-icon-theme@5.37.0 by scripts/SyncUpstream.ts.
// Do not edit directly.

import type { ComponentType } from "react"
import type { MaterialSvgIconProps } from "./CreateIcon"
import type { IconName } from "@pidex/material-icon-theme"

export type IconComponent = ComponentType<MaterialSvgIconProps>
export type IconShard = Readonly<Partial<Record<IconName, IconComponent>>>

const shardLoaders = [
  () => import("./Shard0"),
  () => import("./Shard1"),
  () => import("./Shard2"),
  () => import("./Shard3"),
  () => import("./Shard4"),
  () => import("./Shard5"),
  () => import("./Shard6"),
  () => import("./Shard7"),
  () => import("./Shard8"),
  () => import("./Shard9"),
  () => import("./ShardA"),
  () => import("./ShardB"),
  () => import("./ShardC"),
  () => import("./ShardD"),
  () => import("./ShardE"),
  () => import("./ShardF"),
] as const

export function iconShard(iconName: IconName): number {
  let hash = 2_166_136_261
  for (let index = 0; index < iconName.length; index += 1) {
    hash ^= iconName.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) % shardLoaders.length
}

export async function loadIconShard(iconName: IconName): Promise<IconShard> {
  const module = await shardLoaders[iconShard(iconName)]()
  return module.iconComponents as IconShard
}
