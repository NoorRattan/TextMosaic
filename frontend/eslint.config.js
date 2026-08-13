import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "public/wasm"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ...jsxA11y.flatConfigs.recommended.languageOptions,
      parserOptions: {
        ...jsxA11y.flatConfigs.recommended.languageOptions.parserOptions,
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      ...jsxA11y.flatConfigs.recommended.plugins,
      "react-hooks": reactHooks,
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
    },
  },
);
