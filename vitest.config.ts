// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.spec.{ts,tsx}",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
        "src/lib/installAppMenu.ts",
        "src/lib/renderMermaidDiagram.ts",
      ],
    },
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          globals: true,
          include: ["src/**/*.spec.ts", "scripts/**/*.spec.mjs"],
        },
      },
      {
        // inline project는 루트 plugins를 상속하지 않으므로(Vitest 4 기본 extends:false)
        // .tsx 변환을 위해 이 프로젝트 객체 루트(test의 형제)에 react 플러그인을 직접 선언
        plugins: [react()],
        test: {
          name: "jsdom",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.spec.tsx"],
        },
      },
    ],
  },
});
