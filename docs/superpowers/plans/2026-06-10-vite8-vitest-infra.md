# Vite 8 Upgrade + Vitest Test Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vite 7을 8로 올리고(`@vitejs/plugin-react` 4→6 동반), node+jsdom 두 환경을 분리한 vitest 4.1 테스트 인프라(config-only)를 구성한다.

**Architecture:** 2단계. (1) Vite 7→8 업그레이드는 버전 범프 + 빌드/렌더 검증이 전부(설정 표면 무변경). (2) 별도 `vitest.config.ts`에서 `test.projects`로 node·jsdom을 분리하고, jsdom 프로젝트에 `@vitejs/plugin-react`를 직접 선언해 `.tsx`를 변환한다. 커버리지는 v8 리포트만(threshold 없음).

**Tech Stack:** Tauri 2, Vite 8 (Rolldown/Oxc), React 19, TypeScript 5.8, vitest 4.1.8, @vitest/coverage-v8 4.1.8, jsdom 29, @testing-library/{react,dom,jest-dom,user-event}. 툴체인: mise(Node 24.4.1) + pnpm 10.27.0.

---

## 현재 작업 트리 상태 (실행자 주의)

- 이 저장소는 커밋이 거의 없다. 스캐폴드(`src/`, `index.html`, `vite.config.ts`, `tsconfig*.json`, `src-tauri/`, `public/` 등)와 툴체인 파일(`mise.toml`, `package.json`, `pnpm-lock.yaml`)이 대부분 **untracked**다. 유일한 커밋 대상은 `docs/superpowers/`의 설계/계획 문서다.
- 이 계획의 git 커밋 단계는 **각 태스크가 실제로 건드린 파일만** stage 한다 (`git add <구체 파일>`). 스캐폴드 전체나 `mise.toml`을 임의로 커밋하지 않는다. 사용자가 별도로 초기 커밋을 구성할 수 있다.
- `node -v` = `v24.4.1`, `pnpm -v` = `10.27.0` 인지 먼저 확인한다(아니면 `mise install` 후 새 셸).
- `App.tsx`는 아직 Tauri 기본 스캐폴드(Welcome 화면 + greet 폼)다. 마크다운 렌더링은 아직 미구현 — Vite 8 렌더 검증은 "스캐폴드 화면이 정상 렌더되는지"를 본다.

---

## Phase 1 — Vite 7 → 8 업그레이드

### Task 1: vite + @vitejs/plugin-react 동시 범프 및 검증

**Files:**
- Modify: `package.json` (devDependencies의 `vite`, `@vitejs/plugin-react`)
- Modify (자동): `pnpm-lock.yaml`

> 두 패키지는 peer-lock이다: plugin-react 6은 `vite ^8` 전용, vite 8은 plugin-react ≥6 필요. **반드시 함께** 올린다.

- [ ] **Step 1: package.json의 두 버전을 동시에 수정**

`package.json`의 `devDependencies`에서 아래 두 줄을 바꾼다:

```jsonc
// 변경 전
    "@vitejs/plugin-react": "^4.6.0",
    "typescript": "~5.8.3",
    "vite": "^7.0.4"
// 변경 후
    "@vitejs/plugin-react": "^6.0.0",
    "typescript": "~5.8.3",
    "vite": "^8.0.0"
```

- [ ] **Step 2: 설치하고 peer 경고가 없는지 확인**

Run: `pnpm install`

Expected:
- `vite`가 8.0.x(8.0.16)로, `@vitejs/plugin-react`가 6.0.x(6.0.2)로 해석됨.
- `vite` / `@vitejs/plugin-react` 관련 **unmet peer 경고가 없어야** 한다.
- 만약 `Ignored build scripts: ...` 로 Rolldown/Oxc 네이티브 패키지가 막혔다는 경고가 나오면, 그 패키지명을 `package.json`의 `pnpm.onlyBuiltDependencies` 배열에 추가하고 `pnpm install`을 다시 실행한다. (경고가 없으면 그대로 진행. 기존 `"esbuild"` 항목은 Vite 8에선 inert지만 무해하므로 둔다.)

- [ ] **Step 3: 프로덕션 빌드가 통과하는지 확인 (자동 게이트)**

Run: `pnpm build`

Expected: `tsc && vite build` 가 exit 0. `vite vX.X.X building ... ✓ built in ...` 출력과 `dist/`(gitignore됨) 생성. 타입 에러·번들 에러 없음.

- [ ] **Step 4: 앱이 실제로 렌더되는지 확인 (수동 체크포인트)**

Run: `pnpm tauri dev`

> 첫 실행은 `src-tauri`의 Rust 컴파일로 느릴 수 있다. 창이 뜨면 **스캐폴드 화면("Welcome to Tauri + React" + greet 폼)이 정상 렌더**되는지, 그리고 WebView 개발자도구 콘솔에 런타임 에러가 없는지 확인한다. Rolldown/Oxc로 번들러가 바뀌었으므로 빌드 통과만으로는 부족하다. 확인 후 `Ctrl-C`로 종료한다.

Expected: 창에 스캐폴드 UI가 그려지고 콘솔 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: upgrade to Vite 8 (Rolldown/Oxc) and @vitejs/plugin-react 6"
```

---

## Phase 2 — Vitest 테스트 인프라 (config-only)

### Task 2: 테스트 의존성 설치

**Files:**
- Modify (자동): `package.json` (devDependencies), `pnpm-lock.yaml`

> vitest와 @vitest/coverage-v8는 **정확히 같은 버전**이어야 한다(coverage-v8 peer가 vitest 정확 버전을 핀). 그래서 이 둘만 `-E`(exact)로 설치한다.

- [ ] **Step 1: vitest + coverage-v8를 exact 버전으로 설치**

Run: `pnpm add -D -E vitest@4.1.8 @vitest/coverage-v8@4.1.8`

Expected: `package.json` devDependencies에 `"vitest": "4.1.8"`, `"@vitest/coverage-v8": "4.1.8"` (캐럿 없이) 추가. `@vitest/mocker`/`vitest`의 `vite` peer 경고가 **없어야** 한다(4.1.x가 vite 8 peer를 충족). `@vitest/browser` 관련 optional peer 안내가 보여도 무시(브라우저 모드 미사용).

- [ ] **Step 2: 나머지 테스트 의존성 설치**

Run: `pnpm add -D jsdom@^29 @testing-library/react@^16 @testing-library/dom@^10 @testing-library/jest-dom@^6 @testing-library/user-event@^14`

Expected: 위 패키지들이 devDependencies에 추가되고 설치 성공. peer 경고 없음(jsdom 29는 Node 24.4.1 충족, RTL 16은 React 19 + @testing-library/dom 10 충족).

> 이 태스크는 커밋하지 않는다. config 파일까지 만든 뒤 Task 7에서 검증 후 한 번에 커밋한다.

### Task 3: vitest.config.ts 생성

**Files:**
- Create: `vitest.config.ts` (프로젝트 루트)

- [ ] **Step 1: 파일 생성**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.spec.{ts,tsx}', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          include: ['src/**/*.spec.ts'],
        },
      },
      {
        // inline project는 루트 plugins를 상속하지 않으므로(Vitest 4 기본 extends:false)
        // .tsx 변환을 위해 이 프로젝트 객체 루트(test의 형제)에 react 플러그인을 직접 선언
        plugins: [react()],
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/*.spec.tsx'],
        },
      },
    ],
  },
})
```

> 커밋하지 않는다(Task 7에서 일괄).

### Task 4: vitest.setup.ts 생성

**Files:**
- Create: `vitest.setup.ts` (프로젝트 루트)

- [ ] **Step 1: 파일 생성**

```ts
// vitest.setup.ts
import '@testing-library/jest-dom/vitest'
```

> 이 한 줄이 jest-dom 매처를 vitest의 `expect`에 등록하고(런타임) 타입 augmentation(`toBeInTheDocument` 등)을 제공한다. jsdom 프로젝트의 `setupFiles`에서만 로드된다. 커밋하지 않는다(Task 7에서 일괄).

### Task 5: src/vitest.d.ts 생성

**Files:**
- Create: `src/vitest.d.ts`

- [ ] **Step 1: 파일 생성**

```ts
/// <reference types="vitest/globals" />
```

> `globals: true`로 주입되는 `describe/it/test/expect` 등을 TS가 인식하게 한다. tsconfig의 `types` 배열을 건드리지 않아 기존 빌드의 자동 @types 포함을 깨지 않는다. 커밋하지 않는다(Task 7에서 일괄).

### Task 6: package.json 스크립트 + .gitignore 갱신

**Files:**
- Modify: `package.json` (`scripts`)
- Modify: `.gitignore`

- [ ] **Step 1: scripts에 test 3종 추가**

`package.json`의 `scripts`를 아래로 바꾼다(기존 4개 유지 + 3개 추가):

```jsonc
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage"
  },
```

- [ ] **Step 2: .gitignore에 coverage 디렉터리 추가**

`.gitignore` 끝에 한 줄 추가:

```
coverage
```

> 커밋하지 않는다(Task 7에서 일괄).

### Task 7: 두 환경 동작 검증(임시 spec) 후 커밋

**Files:**
- Create(임시): `src/__vitest_smoke__.spec.ts` (node 환경 검증용 — 검증 후 삭제)
- Create(임시): `src/__vitest_smoke__.spec.tsx` (jsdom 환경 검증용 — 검증 후 삭제)

- [ ] **Step 1: node 환경 임시 spec 작성**

```ts
// src/__vitest_smoke__.spec.ts
describe("vitest node smoke", () => {
  it("node 프로젝트가 spec을 실행한다", () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 2: jsdom 환경 임시 spec 작성**

```tsx
// src/__vitest_smoke__.spec.tsx
import { render, screen } from "@testing-library/react"

describe("vitest jsdom smoke", () => {
  it("jsdom 프로젝트가 .tsx를 렌더하고 jest-dom 매처가 동작한다", () => {
    render(<div>hello</div>)
    expect(screen.getByText("hello")).toBeInTheDocument()
  })
})
```

> 이 jsdom spec은 (a) jsdom 환경, (b) plugin-react 6의 `.tsx` 변환, (c) `vitest.setup.ts`의 jest-dom 매처 등록을 한 번에 검증한다. `describe/it/expect`는 globals라 import 불필요.

- [ ] **Step 3: 두 프로젝트가 모두 실제로 실행·통과하는지 확인**

Run: `pnpm test`

Expected: exit 0. 출력에 `node`·`jsdom` 두 프로젝트가 모두 나타나고 각 1개 테스트 통과(예: `Test Files  2 passed`, 프로젝트 라벨 `[node]`/`[jsdom]`). jsdom spec이 `toBeInTheDocument`로 통과하면 setup/plugin/환경이 모두 정상.

- [ ] **Step 4: 커버리지 실행 확인**

Run: `pnpm coverage`

Expected: exit 0. 텍스트 커버리지 표가 출력되고 `coverage/`(gitignore됨) 생성. (임시 spec은 coverage `exclude`에 걸려 리포트 대상이 아니다.)

- [ ] **Step 5: 임시 spec 삭제**

```bash
rm src/__vitest_smoke__.spec.ts src/__vitest_smoke__.spec.tsx
```

- [ ] **Step 6: spec이 없는 상태에서 green인지 재확인**

Run: `pnpm test`

Expected: exit 0. spec이 0개라 `passWithNoTests`로 green(예: `No test files found, exiting with code 0`).

- [ ] **Step 7: 프로덕션 빌드가 여전히 통과하는지 확인**

Run: `pnpm build`

Expected: `tsc && vite build` exit 0. (`src/vitest.d.ts`/타입 설정이 빌드를 깨지 않음.)

- [ ] **Step 8: 인프라 일괄 커밋**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts vitest.setup.ts src/vitest.d.ts .gitignore
git commit -m "feat: add vitest node/jsdom test infrastructure (config-only)"
```

> `git status`로 `src/__vitest_smoke__.spec.*`가 남아있지 않은지 확인한다(있으면 stage하지 말고 삭제).

---

## Self-Review (작성자 점검 결과)

- **스펙 커버리지:** Vite8+plugin-react6 범프(Task 1) / vitest·coverage-v8 정확 핀(Task 2) / jsdom·testing-library(Task 2) / vitest.config projects+coverage+passWithNoTests(Task 3) / jest-dom setup(Task 4) / vitest/globals 타입(Task 5) / scripts+.gitignore(Task 6) / node·jsdom 양쪽 실행 검증 + config-only 커밋(Task 7) — 스펙 §4.0/§4.1~4.5/§6 모두 매핑됨. build.target은 스펙 결정대로 미지정(무변경).
- **Placeholder 스캔:** 모든 코드/명령/기대출력이 구체값. TODO/TBD 없음.
- **타입 일관성:** 파일명·경로(`vitest.config.ts`/`vitest.setup.ts`/`src/vitest.d.ts`/`src/**/*.spec.ts(x)`)와 프로젝트명(`node`/`jsdom`), 버전(vitest/coverage-v8 4.1.8 동일)이 태스크 간 일치.
