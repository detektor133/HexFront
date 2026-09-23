// Линтер следит прежде всего за детерминизмом симуляции (AGENTS.md §3):
// правила для packages/sim — ниже, в отдельном блоке.
import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SIM_FILES = ['packages/sim/**/*.ts'];

const simRestrictedGlobals = [
  'Date',
  'performance',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'requestAnimationFrame',
  'crypto',
  'process',
  'window',
  'document',
  'navigator',
  'globalThis',
  'fetch',
  'Float32Array',
  'Float64Array',
].map((name) => ({ name, message: 'Недетерминированно или вне симуляции (AGENTS.md §3).' }));

const floatMath = [
  'random',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'sqrt',
  'cbrt',
  'hypot',
  'pow',
  'exp',
  'expm1',
  'log',
  'log2',
  'log10',
  'log1p',
  'fround',
  'floor',
  'ceil',
  'round',
  'trunc',
];

const simRestrictedProperties = floatMath.map((property) => ({
  object: 'Math',
  property,
  message: 'В sim запрещена float-математика: используйте fp/intDiv из src/math.',
}));

const simRestrictedSyntax = [
  {
    selector: "BinaryExpression[operator='/']",
    message: 'Деление только через intDiv/fpDiv из src/math.',
  },
  {
    selector: "AssignmentExpression[operator='/=']",
    message: 'Деление только через intDiv/fpDiv из src/math.',
  },
  {
    selector: "BinaryExpression[operator='**']",
    message: 'Возведение в степень даёт float — запрещено в sim.',
  },
  {
    selector: 'ForInStatement',
    message: 'for…in зависит от порядка ключей объекта — запрещено в sim.',
  },
  {
    selector: 'ClassDeclaration',
    message: 'В sim — функции и данные, без классов (CONVENTIONS.md §4).',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'coverage/**',
      'docs/**',
      // Фикстура нарочно нарушает правила; её проверяет sim-guards.test.ts.
      'packages/sim/test/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: { 'import-x': importX },
    settings: { 'import-x/internal-regex': '^@hexfront/' },
    rules: {
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          'newlines-between': 'always',
          alphabetize: { order: 'asc' },
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'Только именованные экспорты.' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    files: ['apps/server/**/*.ts', 'tools/**/*.ts', '*.js', '*.ts', '*.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/client/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['*.config.js', '*.config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: SIM_FILES,
    // Отключить правило комментарием в sim нельзя (AGENTS.md §3).
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-restricted-globals': ['error', ...simRestrictedGlobals],
      'no-restricted-properties': ['error', ...simRestrictedProperties],
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'Только именованные экспорты.' },
        ...simRestrictedSyntax,
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true },
      ],
    },
  },
  {
    // Единственное место, где разрешены усечение и оператор деления.
    files: ['packages/sim/src/math/int.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...simRestrictedProperties.filter((r) => r.property !== 'trunc'),
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'Только именованные экспорты.' },
        ...simRestrictedSyntax.filter((r) => !r.selector.includes("'/'")),
      ],
    },
  },
  {
    // Тест защит запускает ESLint и dependency-cruiser — ему нужен Node.
    files: ['packages/sim/test/guards/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-restricted-globals': 'off' },
  },
);
