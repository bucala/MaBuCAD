import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * ESLint on top of `tsc --noEmit`: the rules here are the ones a type checker cannot see —
 * hook discipline (`rules-of-hooks` is what catches a stale-closure drag handler, which is
 * exactly the class of bug the 2026-09 audit round fixed by hand) and unused code that
 * slipped past the compiler. Deliberately *not* style/formatting rules: the codebase keeps
 * a strict hand-maintained format, and a formatter would bury real diffs in noise.
 */
export default tseslint.config(
  // Build output and test artifacts are not source.
  { ignores: ["dist", "src-tauri/target", "test-results", "playwright-report"] },

  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      // `no-undef` is off for TypeScript files (the compiler owns name resolution), so
      // this is only for the odd .js config file — both worlds to be safe.
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // Warnings rather than errors: a missing dep is worth a look but is sometimes an
      // intentional "read latest on next run" pattern, which this codebase prefers to
      // document inline rather than silence globally.
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
