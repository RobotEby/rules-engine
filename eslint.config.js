// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "*.tgz"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    // Só os arquivos cobertos pelo tsconfig.json (src/examples/tests) participam
    // do projeto de tipos; scripts .mjs e este próprio config ficam de fora.
    files: ["src/**/*.ts", "examples/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // O motor usa `unknown`/checagens de tipo em runtime de propósito (validação de
      // dados externos); assertions explícitas já são revisadas caso a caso.
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/restrict-template-literals": "off",
    },
  },
  {
    // scripts/*.mjs e este arquivo de config são JS puro, fora do tsconfig do
    // pacote: desliga as regras que dependem de informação de tipos.
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["examples/server.ts"],
    rules: {
      // O listener HTTP é `async` só para poder usar `await` dentro do próprio
      // corpo; toda a função está dentro de um `try/catch`, então nenhuma rejeição
      // escapa sem tratamento. `createServer` descarta a Promise retornada, o que
      // é o padrão idiomático para listeners assíncronos no `node:http`.
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: ["tests/**/*.ts", "examples/**/*.ts", "scripts/**/*.mjs"],
    rules: {
      // `node:test` retorna uma Promise de cada `test(...)`, mas o padrão idiomático
      // do runner nativo é não aguardá-la: ele mesmo agenda e relata a execução.
      // Sinalizar isso como floating promise geraria ruído em toda a suíte sem
      // indicar bug real.
      "@typescript-eslint/no-floating-promises": "off",
      // Testes e scripts de exemplo priorizam legibilidade sobre rigor máximo de tipos.
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
);
