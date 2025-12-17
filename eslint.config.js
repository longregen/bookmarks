import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "dist/**",
      "dist-*/**",
      "node_modules/**",
      "coverage/**",
      "*.config.js",
      "*.config.ts",
      "scripts/**",
      "tests/**",
    ],
  },

  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript strict rules with type checking (only for src files)
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.ts"],
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.ts"],
  })),

  // Configuration for source files
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: "readonly",
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // === Type Safety (Practical Level) ===
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",

      // Explicit return types for public APIs
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
          allowConciseArrowFunctionExpressionsStartingWithVoid: true,
        },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "warn",

      // Boolean expressions - warn instead of off
      "@typescript-eslint/strict-boolean-expressions": "warn",

      // Promise handling (important for async code)
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": [
        "warn",
        {
          checksVoidReturn: {
            arguments: false,
            attributes: false,
            properties: false,
          },
        },
      ],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "warn",

      // Type refinement
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/prefer-optional-chain": "warn",

      // Template literals - allow numbers and booleans (safe and common)
      "@typescript-eslint/restrict-template-expressions": [
        "warn",
        {
          allowNumber: true,
          allowBoolean: true,
          allowNullish: false,
          allowRegExp: false,
        },
      ],

      // === Code Quality ===
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "@typescript-eslint/consistent-type-exports": "warn",
      "@typescript-eslint/no-import-type-side-effects": "warn",

      // Catch variables
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "warn",

      // Enum comparisons (common in TypeScript)
      "@typescript-eslint/no-unsafe-enum-comparison": "warn",

      // Other rules - warn instead of off
      "@typescript-eslint/no-dynamic-delete": "warn",
      "@typescript-eslint/prefer-for-of": "warn",
      "@typescript-eslint/no-invalid-void-type": "warn",
      "@typescript-eslint/return-await": "warn",
      "@typescript-eslint/no-deprecated": "warn",
      "@typescript-eslint/no-unnecessary-type-parameters": "warn",
      "@typescript-eslint/prefer-promise-reject-errors": "warn",
      "prefer-promise-reject-errors": "warn",
      "no-promise-executor-return": "warn",

      // === Maintainability ===
      complexity: ["warn", { max: 20 }],
      "max-depth": ["warn", { max: 5 }],
      "max-lines-per-function": [
        "warn",
        {
          max: 150,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      "max-params": ["warn", { max: 6 }],
      "no-nested-ternary": "warn",
      "no-unneeded-ternary": "error",

      // === Best Practices ===
      eqeqeq: ["error", "always"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-return-assign": "warn",
      "no-sequences": "error",
      "no-throw-literal": "warn",
      "prefer-promise-reject-errors": "warn",
      radix: "error",
      "no-empty": "warn",

      // === Modern JavaScript ===
      "no-var": "error",
      "prefer-const": "error",
      "prefer-arrow-callback": "error",
      "prefer-rest-params": "error",
      "prefer-spread": "error",
      "prefer-template": "error",
      "object-shorthand": ["error", "always"],
      "arrow-body-style": ["error", "as-needed"],

      // === Browser Extension Context ===
      "no-console": "off",
      "no-debugger": "error",
      "no-alert": "warn",

      // === Error Prevention ===
      "no-duplicate-imports": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "warn",
      "no-unreachable-loop": "error",
      "no-async-promise-executor": "error",
      "no-promise-executor-return": "warn",

      // === TypeScript Specific ===
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-empty-function": [
        "error",
        {
          allow: ["arrowFunctions"],
        },
      ],
      "@typescript-eslint/no-inferrable-types": "error",
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        {
          ignoreArrowShorthand: true,
          ignoreVoidOperator: true,
        },
      ],
    },
  }
);
