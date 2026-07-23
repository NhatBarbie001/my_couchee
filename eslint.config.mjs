import globals from "globals";
import pluginJs from "@eslint/js";


/** @type {import('eslint').Linter.Config[]} */
export default [
  {files: ["**/*.js"], languageOptions: {sourceType: "commonjs"}},
  {languageOptions: { globals: globals.node }},
  pluginJs.configs.recommended,
  {
    rules: {
      "no-unused-vars": "off",           // Tắt cảnh báo biến không sử dụng
      "no-unreachable": "off",           // Tắt cảnh báo biến không sử dụng
      "react/no-unknown-property": "off",           // Tắt cảnh báo biến không sử dụng
      "no-unsafe-optional-chaining": "off",           // Tắt cảnh báo biến không sử dụng
      "react/jsx-key": "off",           // Tắt cảnh báo biến không sử dụng
      "no-extra-boolean-cast": "off",           // Tắt cảnh báo biến không sử dụng
      "react/prop-types": "off",        // Tắt cảnh báo thiếu props validation
      "no-prototype-builtins": "off",        // Tắt cảnh báo thiếu props validation
      "react/react-in-jsx-scope": "off" // Tắt cảnh báo React phải có trong scope khi dùng JSX
    },
  },
];
