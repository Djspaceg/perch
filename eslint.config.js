/**
 * ESLint flat config for the whole repo. One file, because the lint rules are a property of
 * the repo rather than of any one workspace — the same argument `tsconfig.base.json` makes
 * about strictness.
 *
 * Three tiers, in the order they appear below:
 *
 * 1. **Package and app sources** (every `src` tree) get **type-aware** linting. That is where the
 *    rules that need a type checker pay for themselves: a floating promise, an `await` on a
 *    non-thenable, a `??` whose left side can never be nullish. Those are the bugs a
 *    dashboard feeding a wall panel actually dies of.
 * 2. **React sources** — the three workspaces `ARCHITECTURE.md` lists as rendering
 *    (`ui-kit`, `runtime`, `editor`) — additionally get the React and React-hooks rules.
 *    Scoped rather than global so a hooks rule cannot fire in `agent`, which has no UI and
 *    never will.
 * 3. **Config and tooling files** (`vitest.config.ts`, `*.mjs`, this file) get
 *    syntax-and-idiom linting with **no** type information. They are in no `tsconfig`
 *    project (see DECISIONS.md), so type-aware rules have nothing to work from, and
 *    inventing a project just to lint eight eight-line files would be a third module
 *    resolution mechanism for no gain.
 *
 * `eslint-config-prettier` is last in every chain. Prettier owns formatting outright; ESLint
 * owns correctness. They never both have an opinion about the same character.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** Workspaces that render. Kept as a list so the React scope is stated once. */
const REACT_SOURCES = [
  'packages/ui-kit/src/**/*.{ts,tsx}',
  'apps/runtime/src/**/*.{ts,tsx}',
  'apps/editor/src/**/*.{ts,tsx}',
];

/** Every `tsconfig` that owns real files, so a type-aware rule can find any linted source. */
const TS_PROJECTS = [
  './tsconfig.tests.json',
  './packages/*/tsconfig.json',
  './apps/*/tsconfig.json',
];

export default tseslint.config(
  {
    // Build output, dependencies, and the evidence directory, which holds captured logs,
    // screenshots and a throwaway esbuild demo that is deliberately not part of the repo.
    ignores: ['**/dist/**', '**/node_modules/**', '.evidence/**', 'fixtures/*.json'],
  },

  // ---- 1. Package and app sources: type-aware ----------------------------------------
  {
    files: [
      'packages/*/src/**/*.{ts,tsx}',
      'apps/*/src/**/*.{ts,tsx}',
      // `vitest.setup.ts` lives at a package root rather than in `src/`, but it is in
      // `tsconfig.tests.json`, so it belongs in the type-aware tier with the tests it serves.
      'packages/*/vitest.setup.ts',
      'apps/*/vitest.setup.ts',
    ],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: TS_PROJECTS,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The compiler already reports an unused local as an error (`noUnusedLocals`), and it
      // does it with the project's own knowledge of type-only imports. A second, weaker
      // implementation of the same check only produces disagreements.
      '@typescript-eslint/no-unused-vars': 'off',

      // `verbatimModuleSyntax` is on, so a type import must be written as one. This makes
      // the inline `type` specifier the required spelling rather than a style preference.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // A promise nobody waits on is the failure mode of a capture loop: the frame is
      // written, the error is swallowed, and the panel shows the previous image forever.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Boolean coercion of a value that might be `''` or `0` is how a real zero reading
      // and a dimensionless empty unit both turn into "no data". Both are values this
      // repo's contracts specifically say are meaningful.
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        { allowString: false, allowNumber: false, allowNullableObject: false },
      ],

      // `strictTypeChecked` sets this to `error`, which is right for a template literal in
      // a log line but wrong for a `RangeError` message that has to print whatever it was
      // handed. Numbers and booleans interpolate; `never` and `any` still do not.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },

  // ---- 2. React sources: the React and hooks rules -----------------------------------
  {
    files: REACT_SOURCES,
    extends: [
      react.configs.flat.recommended,
      // The automatic runtime: no `import React` needed, so `react/react-in-jsx-scope` and
      // `react/jsx-uses-react` must be off or every component is a false positive.
      react.configs.flat['jsx-runtime'],
      reactHooks.configs.flat.recommended,
    ],
    settings: {
      // Pinned, not detected, and it must stay pinned. `version: 'detect'` makes
      // eslint-plugin-react call `context.getFilename()`, which ESLint 10 removed, and the
      // whole lint lane dies on the first React file with
      // `contextOrFilename.getFilename is not a function` rather than reporting a lint error.
      // The cost is that this number is hand-maintained: it must move when `react` does.
      // See DECISIONS.md, "Taking ESLint to 10 by overriding a peer range".
      react: { version: '19.3.0' },
    },
    rules: {
      // TypeScript checks props. `prop-types` is the runtime substitute for a type system
      // this repo already has, and leaving it on would demand a second declaration of every
      // component's props.
      'react/prop-types': 'off',
    },
  },

  // ---- 3. Config and tooling files: no type information ------------------------------
  {
    files: ['*.js', '**/*.mjs', '**/vitest.config.ts', '**/vite.config.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
      parserOptions: { project: null },
    },
  },

  // ---- Prettier owns formatting. Always last. ----------------------------------------
  prettier,
);
