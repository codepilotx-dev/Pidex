/** 上传图标的源文件上限；解码与缩放后写入图标记录的内容另有 512 KB 上限。 */
export const PROVIDER_ICON_UPLOAD_MAX_BYTES = 5 * 1024 * 1024
/** 图标显示尺寸较小，超大原图按最长边缩放到该值后保存。 */
export const PROVIDER_ICON_UPLOAD_MAX_DIMENSION = 256
const PROVIDER_ICON_UPLOAD_MAX_DATA_URL_LENGTH = 700_000

const SUPPORTED_UPLOAD_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
])

const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.ico',
])

/**
 * 把用户选择的图片缩放为 PNG 数据地址。统一转成 PNG 可避免把任意 SVG/ICO
 * 原样写入图标记录，同时保留透明通道；缩放失败或格式不受支持时抛出可展示的
 * 中文错误。
 */
export async function readProviderIconUpload(file: File): Promise<string> {
  if (file.size === 0) throw new Error('图片文件为空，请重新选择。')
  if (file.size > PROVIDER_ICON_UPLOAD_MAX_BYTES) throw new Error('图片不能超过 5 MiB。')
  if (!isSupportedUpload(file)) throw new Error('请选择 PNG、JPEG、WebP、GIF、SVG 或 ICO 图片。')

  const objectURL = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = objectURL
    try {
      await image.decode()
    } catch {
      throw new Error('无法读取该图片，请更换图片后重试。')
    }
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error('无法读取该图片，请更换图片后重试。')
    }

    const scale = Math.min(
      1,
      PROVIDER_ICON_UPLOAD_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
    )
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法处理该图片，请更换图片后重试。')
    context.drawImage(image, 0, 0, width, height)

    const dataURL = canvas.toDataURL('image/png')
    if (!dataURL.startsWith('data:image/png;base64,') || dataURL.length > PROVIDER_ICON_UPLOAD_MAX_DATA_URL_LENGTH) {
      throw new Error('图片处理后仍然过大，请更换更简单的图片。')
    }
    return dataURL
  } catch (error) {
    // 保留上面的可展示错误，其余解码/画布异常统一收敛为可重试提示。
    if (error instanceof Error && /[\u4e00-\u9fa5]/u.test(error.message)) throw error
    throw new Error('无法读取该图片，请更换图片后重试。')
  } finally {
    URL.revokeObjectURL(objectURL)
  }
}

function isSupportedUpload(file: File): boolean {
  const type = file.type.toLowerCase()
  if (type) return SUPPORTED_UPLOAD_TYPES.has(type)
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  return SUPPORTED_UPLOAD_EXTENSIONS.has(extension)
}
