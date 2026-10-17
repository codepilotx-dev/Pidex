export type ComposerModelNameParts = {
  prefix: string
  model: string
}

/**
 * 把 `vendor/model` 形式的模型 ID 拆成「供应商前缀」与「模型名」两段，
 * 让宽度固定的触发器可以把前缀先收缩、优先保留模型尾段。
 * 没有分隔符或以 `/` 结尾时整体作为模型名，不猜测拆分。
 */
export function splitComposerModelName(name: string): ComposerModelNameParts {
  const separator = name.lastIndexOf('/')
  if (separator <= 0 || separator === name.length - 1) {
    return { prefix: '', model: name }
  }
  return { prefix: name.slice(0, separator), model: name.slice(separator + 1) }
}
