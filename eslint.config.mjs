import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Apostrophes and quotation marks in JSX text are rendered safely by
      // React. Requiring HTML entities makes customer copy harder to read and
      // review without adding a runtime or accessibility guarantee.
      "react/no-unescaped-entities": "off",
      // Beacon intentionally uses effects to hydrate browser storage, measure
      // DOM nodes, and load server-action state. Those are the external-system
      // synchronization cases effects are for; exhaustive-deps remains on.
      "react-hooks/set-state-in-effect": "off",
      // A leading underscore is the repository's explicit marker for an
      // intentionally unused callback argument, rest-field omission, or test
      // seam. Unmarked dead values still warn.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      // Several isolation tests deliberately reset CommonJS module caches and
      // inspect private shapes. Production code keeps the strict rules.
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
  {
    files: [
      "src/app/(shell)/circuit-breaker-section.tsx",
      "src/app/(shell)/team-standup.tsx",
      "src/app/(shell)/today-newpages-section.tsx",
      "src/app/(shell)/war-room-sections.tsx",
    ],
    rules: {
      // These async server sections catch loader failures and return a
      // fail-soft JSX fallback. The catch is for awaited data acquisition,
      // not an attempt to catch a descendant render error.
      "react-hooks/error-boundaries": "off",
    },
  },
  globalIgnores([
    ".next/**",
    // Local agent worktrees contain complete repository copies (including
    // generated .next bundles). ESLint does not inherit .gitignore under the
    // flat config, so without this boundary `npm run lint` recursively lints
    // every copy and can take minutes or exhaust memory.
    ".claude/worktrees/**",
    ".codex/**",
    "out/**",
    "build/**",
    "coverage/**",
    "tmp/**",
    ".vercel/**",
    "next-env.d.ts",
    "scripts/**",
    "tests/**",
  ]),
]);

export default eslintConfig;
