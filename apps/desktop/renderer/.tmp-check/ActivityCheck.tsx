import { createElement, Activity } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const markup = renderToStaticMarkup(
  createElement(
    'div',
    { className: 'upper' },
    createElement(
      Activity,
      { mode: 'hidden' as const },
      createElement('div', { className: 'chat' }, 'chat-content'),
    ),
    createElement('div', { className: 'panel' }, 'panel'),
  ),
)
console.log(markup)
