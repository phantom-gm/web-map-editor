import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", ".next"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
  },
  {
    // 설정/테스트 파일은 Node 컨텍스트
    files: ["*.{js,mjs,ts}", "src/**/*.test.{ts,tsx}", "next.config.mjs", "vitest.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
