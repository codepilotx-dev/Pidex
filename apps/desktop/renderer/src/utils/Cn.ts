import { extendTailwindMerge } from 'tailwind-merge'
import { cx, type ClassValue } from './Cx.js'

const mergeClasses = extendTailwindMerge<'type-role' | 'arbitrary..font'>({
  prefix: 'tw',
  extend: {
    classGroups: {
      'type-role': [
        {
          type: [
            'display', 'body', 'control', 'secondary', 'meta', 'caption', 'label',
            'body-sm', 'body-lg', 'reading', 'row-title', 'title-sm', 'title-md',
            'title-lg', 'title-xl', 'metric', 'code',
          ],
        },
      ],
      size: [{ size: ['icon', 'icon-sm', 'icon-md', 'icon-lg'] }],
    },
    // Both a typography role and [font:...] own the complete font shorthand.
    conflictingClassGroups: {
      'type-role': ['arbitrary..font'],
      'arbitrary..font': ['type-role'],
    },
  },
})

export function cn(...values: readonly ClassValue[]): string {
  return mergeClasses(cx(...values))
}
