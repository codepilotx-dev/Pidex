import { describe, expect, test } from 'bun:test'
import {
  filterStatusForFile,
  normalizeReviewFileStatus,
  reviewFileStatusLabel,
} from '../src/features/review/workspace/ReviewFileStatus.js'

describe('review file status presentation', () => {
  test('maps every Review protocol status to a stable visual kind', () => {
    expect(normalizeReviewFileStatus(file('added'))).toBe('added')
    expect(normalizeReviewFileStatus(file('untracked'))).toBe('added')
    expect(normalizeReviewFileStatus(file('deleted'))).toBe('deleted')
    expect(normalizeReviewFileStatus(file('modified'))).toBe('modified')
    expect(normalizeReviewFileStatus(file('type-changed'))).toBe('modified')
    expect(normalizeReviewFileStatus(file('renamed'))).toBe('renamed')
    expect(normalizeReviewFileStatus(file('copied'))).toBe('copied')
    expect(normalizeReviewFileStatus(file('unknown'))).toBe('unknown')
  })

  test('keeps legacy Git status codes compatible and prioritizes untracked', () => {
    expect(normalizeReviewFileStatus(file('A'))).toBe('added')
    expect(normalizeReviewFileStatus(file('??'))).toBe('added')
    expect(normalizeReviewFileStatus(file('D'))).toBe('deleted')
    expect(normalizeReviewFileStatus(file('M'))).toBe('modified')
    expect(normalizeReviewFileStatus(file('T'))).toBe('modified')
    expect(normalizeReviewFileStatus(file('R100'))).toBe('renamed')
    expect(normalizeReviewFileStatus(file('C100'))).toBe('copied')
    expect(normalizeReviewFileStatus(file('', true))).toBe('added')
    expect(normalizeReviewFileStatus(file('X'))).toBe('unknown')
  })

  test('shares normalized status with filtering and Chinese labels', () => {
    expect(filterStatusForFile(file('added'))).toBe('added')
    expect(filterStatusForFile(file('deleted'))).toBe('removed')
    expect(filterStatusForFile(file('renamed'))).toBe('modified')
    expect(reviewFileStatusLabel('added')).toBe('新增')
    expect(reviewFileStatusLabel('deleted')).toBe('删除')
    expect(reviewFileStatusLabel('modified')).toBe('修改')
  })
})

function file(status: string, isUntracked = false) {
  return { status, isUntracked }
}
