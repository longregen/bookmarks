import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
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

  eslint.configs.recommended,

  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.ts"],
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.ts"],
  })),

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
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",

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

      "@typescript-eslint/strict-boolean-expressions": "warn",

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

      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/prefer-optional-chain": "warn",

      "@typescript-eslint/restrict-template-expressions": [
        "warn",
        {
          allowNumber: true,
          allowBoolean: true,
          allowNullish: false,
          allowRegExp: false,
        },
      ],

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

      "@typescript-eslint/use-unknown-in-catch-callback-variable": "warn",

      "@typescript-eslint/no-unsafe-enum-comparison": "warn",

      "@typescript-eslint/no-dynamic-delete": "warn",
      "@typescript-eslint/prefer-for-of": "warn",
      "@typescript-eslint/no-invalid-void-type": "warn",
      "@typescript-eslint/return-await": "warn",
      "@typescript-eslint/no-deprecated": "warn",
      "@typescript-eslint/no-unnecessary-type-parameters": "warn",
      "@typescript-eslint/prefer-promise-reject-errors": "warn",
      "prefer-promise-reject-errors": "warn",
      "no-promise-executor-return": "warn",

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

      "no-var": "error",
      "prefer-const": "error",
      "prefer-arrow-callback": "error",
      "prefer-rest-params": "error",
      "prefer-spread": "error",
      "prefer-template": "error",
      "object-shorthand": ["error", "always"],
      "arrow-body-style": ["error", "as-needed"],

      "no-console": "off",
      "no-debugger": "error",
      "no-alert": "warn",

      "no-duplicate-imports": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "warn",
      "no-unreachable-loop": "error",
      "no-async-promise-executor": "error",
      "no-promise-executor-return": "warn",

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
