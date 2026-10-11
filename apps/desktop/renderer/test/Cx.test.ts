import { expect, test } from 'bun:test'
import { cx } from '../src/utils/Cx.js'

test('cx joins static classes and omits empty conditional values', () => {
  expect(cx('u-flex', false, null, undefined, '', 'u-gap-2')).toBe('u-flex u-gap-2')
})
