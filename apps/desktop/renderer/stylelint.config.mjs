export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['dist/**'],
  rules: {
    // Keep the initial rollout focused on correctness. Formatting and selector
    // migrations can be enabled separately without forcing a repository-wide
    // SCSS rewrite as part of the theme work.
    'alpha-value-notation': null,
    'color-function-alias-notation': null,
    'color-function-notation': null,
    'color-hex-length': null,
    'color-no-hex': true,
    'custom-property-empty-line-before': null,
    'declaration-empty-line-before': null,
    'declaration-block-no-redundant-longhand-properties': null,
    'declaration-no-important': true,
    'declaration-property-value-keyword-no-deprecated': null,
    'font-family-name-quotes': null,
    'function-disallowed-list': ['rgb', 'rgba'],
    'function-url-quotes': null,
    'hue-degree-notation': null,
    'import-notation': null,
    'keyframes-name-pattern': null,
    'length-zero-no-unit': null,
    'media-feature-range-notation': null,
    'max-nesting-depth': [2, { ignore: ['blockless-at-rules'] }],
    'no-descending-specificity': null,
    'number-max-precision': null,
    'property-no-vendor-prefix': null,
    'property-no-deprecated': null,
    'rule-empty-line-before': null,
    'selector-class-pattern': null,
    'selector-id-pattern': null,
    'selector-max-specificity': '0,4,2',
    'selector-not-notation': null,
    'selector-pseudo-element-colon-notation': null,
    'shorthand-property-no-redundant-values': null,
    'declaration-property-value-no-unknown': null,
    'value-keyword-case': null,
  },
  overrides: [
    {
      files: ['**/tailwind.css'],
      rules: {
        // Tailwind owns this entrypoint: `@theme`/`@utility` are its directives
        // and `prefix()`/`source()` are its `@import` modifiers, so the core
        // rules that predate those extensions are turned off here only.
        'at-rule-no-unknown': [true, { ignoreAtRules: ['theme', 'utility'] }],
        'at-rule-prelude-no-invalid': null,
        'color-no-hex': null,
        'custom-property-pattern': null,
        'function-disallowed-list': null,
      },
    },
    {
      files: [
        '**/design-system/tokens.css',
        '**/design-system/codex-semantic-tokens.css',
        '**/primitives/settings.css',
      ],
      rules: {
        'color-no-hex': null,
        'custom-property-pattern': null,
        'function-disallowed-list': null,
      },
    },
    {
      files: ['**/base.css', '**/popover.css'],
      rules: {
        'declaration-no-important': null,
      },
    },
  ],
}
