import { describe, expect, test } from 'bun:test'
import {
  composerDocumentFromProseMirrorDocument,
  composerDocumentToProseMirrorDocument,
  composerSchema,
} from '../src/features/session/composer/ComposerEditor.js'
import {
  createComposerDocumentWithSkill,
  skillInvocationFromComposerDocument,
  skillInvocationsFromComposerDocument,
} from '../src/features/session/composer/ComposerSkillToken.js'
import { contextTokensFromDocument } from '../src/features/session/composer/UseDesktopComposerController.js'
import { isComposerInputEmpty } from '../src/features/session/composer/ComposerTypes.js'

describe('composer skill inline token', () => {
  test('Skill 光标位置在草稿派生和编辑器往返后保留，引用非空不退出模式', () => {
    const skill = { name: 'review', path: 'skills/review' }
    const existing = createComposerDocumentWithSkill('前后', skill).tokens.map((token) => ({
      ...token,
      from: 1,
      to: 1,
    }))
    const document = createComposerDocumentWithSkill('前后', [skill], existing)
    expect(
      composerDocumentFromProseMirrorDocument(composerDocumentToProseMirrorDocument(document))
        .tokens[0]?.from,
    ).toBe(1)
    expect(isComposerInputEmpty('', existing, [])).toBe(false)
    expect(isComposerInputEmpty('', [], [])).toBe(true)
    expect(
      isComposerInputEmpty(
        '',
        [],
        [
          {
            id: 'image',
            name: 'image.png',
            path: 'image.png',
            mediaType: 'image/png',
            sizeBytes: 1,
            kind: 'image',
            status: 'ready',
          },
        ],
      ),
    ).toBe(false)
    expect(createComposerDocumentWithSkill('前后', [], existing).tokens).toEqual([])
  })
  test('多个 Skill 标签往返保留身份与顺序，正文不携带命令', () => {
    const skills = [
      { name: 'review', path: 'skills/review' },
      { name: 'plan', path: 'builtin://plan/SKILL.md' },
    ]
    const document = createComposerDocumentWithSkill('检查当前改动', skills)
    const restored = composerDocumentFromProseMirrorDocument(
      composerDocumentToProseMirrorDocument(document),
    )
    expect(restored).toEqual(document)
    expect(skillInvocationsFromComposerDocument(restored)).toEqual(skills)
    expect(restored.text).toBe('检查当前改动')
  })
  test('将单个 Skill 序列化为不进入消息文本的 ProseMirror 原子节点', () => {
    const document = createComposerDocumentWithSkill('检查当前改动', {
      name: 'builtin-helper',
      path: 'builtin://builtin-helper/SKILL.md',
    })

    const proseMirrorDocument = composerDocumentToProseMirrorDocument(document)
    const token = proseMirrorDocument.firstChild?.firstChild

    expect(token?.type).toBe(composerSchema.nodes.skill_token)
    expect(token?.isAtom).toBe(true)
    expect(proseMirrorDocument.textContent).toBe('检查当前改动')
    expect(composerDocumentFromProseMirrorDocument(proseMirrorDocument)).toEqual(document)
  })

  test('从编辑器文档只解析一个 Skill 调用', () => {
    const document = createComposerDocumentWithSkill('规划登录流程', {
      name: 'builtin-helper',
      path: 'builtin://builtin-helper/SKILL.md',
    })

    expect(skillInvocationFromComposerDocument(document)).toEqual({
      name: 'builtin-helper',
      path: 'builtin://builtin-helper/SKILL.md',
    })
  })

  test('往返保留多个上下文 token 的顺序和正文位置', () => {
    const document = {
      text: '检查这里',
      tokens: [
        {
          id: 'skill-1',
          kind: 'skill' as const,
          name: 'review',
          label: 'review',
          value: 'skills/review',
          from: 0,
          to: 0,
        },
        {
          id: 'thread-1',
          kind: 'thread' as const,
          label: '任务：登录修复',
          value: 'pidex://threads/thread-1',
          from: 2,
          to: 2,
        },
        {
          id: 'browser-1',
          kind: 'browser' as const,
          label: '网页：文档',
          value: 'https://example.com/docs',
          from: 2,
          to: 2,
        },
        {
          id: 'plugin:computer-use',
          kind: 'plugin' as const,
          label: 'Computer Use',
          value: 'plugin://computer-use',
          from: 2,
          to: 2,
        },
      ],
    }

    const proseMirrorDocument = composerDocumentToProseMirrorDocument(document)
    expect(composerDocumentFromProseMirrorDocument(proseMirrorDocument)).toEqual(document)
  })

  test('草稿收集保留插件引用 token，不随技能 token 一起丢弃', () => {
    const tokens = [
      {
        id: 'skill-1',
        kind: 'skill' as const,
        name: 'review',
        label: 'review',
        value: 'skills/review',
        from: 0,
        to: 0,
      },
      {
        id: 'plugin:computer-use',
        kind: 'plugin' as const,
        label: 'Computer Use',
        value: 'plugin://computer-use',
        from: 0,
        to: 0,
      },
    ]
    expect(contextTokensFromDocument(tokens)).toEqual(tokens)
  })
})
