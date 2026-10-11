import { describe, expect, test } from 'bun:test'
import {
  isNewSessionSurface,
  newSessionPath,
  normalizeNewSessionSurfaceSearch,
  parseNewSessionSurface,
} from '../src/features/session/NewSessionSurface.js'

describe('new session surface routing', () => {
  test('生成三个合法 Surface 的路径', () => {
    expect(newSessionPath('coding')).toBe('/new?surface=coding')
    expect(newSessionPath('working')).toBe('/new?surface=working')
    expect(newSessionPath('chat')).toBe('/new?surface=chat')
  })

  test('缺失 surface 参数时回退为空（由调用方使用已保存模式）', () => {
    expect(parseNewSessionSurface('')).toBeNull()
    expect(parseNewSessionSurface('?visualCase=grid')).toBeNull()
  })

  test('无效 surface 值回退为空', () => {
    expect(parseNewSessionSurface('?surface=unknown')).toBeNull()
    expect(parseNewSessionSurface('?surface=WORKING')).toBeNull()
    expect(parseNewSessionSurface('?surface=')).toBeNull()
  })

  test('有效 surface 优先于设置，并识别全部模式', () => {
    expect(parseNewSessionSurface('?surface=working')).toBe('working')
    expect(parseNewSessionSurface('?surface=coding')).toBe('coding')
    expect(parseNewSessionSurface('?surface=chat')).toBe('chat')
    expect(isNewSessionSurface('working')).toBe(true)
    expect(isNewSessionSurface('unknown')).toBe(false)
    expect(isNewSessionSurface(null)).toBe(false)
  })

  test('规范化只替换 surface 参数并保留其他查询参数', () => {
    expect(normalizeNewSessionSurfaceSearch('', 'working').toString()).toBe('surface=working')
    expect(normalizeNewSessionSurfaceSearch('?surface=coding', 'working').toString()).toBe(
      'surface=working',
    )
    expect(
      normalizeNewSessionSurfaceSearch('?visualCase=grid&surface=unknown', 'working').toString(),
    ).toBe('visualCase=grid&surface=working')
  })
})
