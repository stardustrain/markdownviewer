# Vite 8 업그레이드 + Vitest 테스트 인프라 도입 설계

- 날짜: 2026-06-10
- 대상 프로젝트: markdownviewer (Tauri 2 + React 19 + TypeScript, Vite 7→8 업그레이드 포함)
- 상태: 승인됨 (구현 계획 작성 전)
- 검증: 핵심 기술 주장(Vite 8 호환·projects 동작·버전 호환·TS 타입)을 다중 에이전트로 공식 문서/npm 레지스트리와 교차검증 완료(2026-06-10).

이 작업은 **2단계**로 구성된다.
- **1단계 — Vite 7→8 업그레이드** (`@vitejs/plugin-react` 4→6 동반). 먼저 green으로 만든 뒤 커밋.
- **2단계 — vitest 4.1 테스트 인프라** (node + jsdom). vitest 4.1은 *설치된* vite를 그대로 사용하므로 vite가 먼저 안정돼야 한다.

## 1. 배경

현재 `src/`는 Tauri + React 기본 스캐폴드(`App.tsx`, `main.tsx`, `vite-env.d.ts`)만 있고
테스트 인프라가 전무하다. 로드맵(파일 열기 → 파일 워처 → 마크다운 렌더링 범위)을 진행하기 전에,
빌드 툴체인을 최신(Vite 8)으로 올리고 앞으로 작성할 로직을 검증할 테스트 기반을 먼저 깐다.

프로젝트의 테스트 컨벤션은 `test-code-style` 스킬에 규정되어 있으며, 이 설계는 그 제약을 그대로 따른다:

- exported 함수만 테스트 (private = non-exported 함수는 테스트하지 않음)
- 테스트 파일은 대상 파일과 **같은 경로에 colocate**, 파일명은 대상 파일명을 따름
- `globals: true` (vitest 함수 import 불필요)
- branch 100% 커버리지를 **목표**로 함
- **모킹 금지** — 외부 모듈 의존은 의존성 주입(DI)으로 대체
- 테스트 description은 한국어, 단 대상 파일/함수명은 영어

## 2. 목표 / 비목표

### 목표

- **Vite 7 → 8 업그레이드** (Rolldown/Oxc 엔진), `@vitejs/plugin-react` 4 → 6 동반 범프. 빌드·Tauri 렌더 검증.
- `node`(순수 함수)와 `jsdom`(React 컴포넌트) **두 환경을 분리**해 실행하는 vitest 인프라 구성
- v8 기반 커버리지 **리포트** 제공 (임계값 강제는 하지 않음)
- 테스트 작성·실행·커버리지용 pnpm 스크립트 제공
- 인프라가 실제로 동작함을 검증 (`pnpm test`가 green, 두 환경 모두 spec을 실제로 실행)

### 비목표 (이번 작업 범위 밖)

- 실제 테스트 케이스(spec) 작성 — **config만** 제공. 첫 실제 모듈을 짤 때 첫 테스트를 함께 작성
- 커버리지 임계값(threshold) 강제 — 실제 로직이 없어 지금 100%를 강제하면 즉시 실패. 임계값은 실제 모듈이 생기면 별도로 도입
- 명시적 `build.target` 지정 — Vite 8 기본값(Safari 16.4) 유지 (§3 결정 참고)
- CI 연동, Tauri(Rust) 측 테스트, E2E/브라우저 모드
- App 보일러플레이트에 대한 테스트 (곧 교체될 코드라 throwaway)

## 3. 결정 사항과 근거

| 결정 | 선택 | 근거 |
|---|---|---|
| Vite 버전 | **7 → 8 업그레이드** (8.0.16) | 사용자 요청. Vite 8 = Rolldown/Oxc 단일 번들러. Node `^20.19 || >=22.12` 요구(24.4.1 충족). Tauri는 bundler-agnostic이라 호환 |
| plugin-react | **4.7 → 6** (6.0.2) | plugin-react 6 peer가 `vite ^8` **전용** → vite 8과 **반드시 함께 범프**(peer-lock). Babel 제거(Refresh는 Oxc 코어)되나 순수 `react()` 사용이라 코드 무변경 |
| build.target | **Vite 8 기본값 유지 (Safari 16.4)** | 사용자 결정. 최신 macOS 단일 사용자 전제 → 명시 안 함으로 더 작은 출력. 구형 macOS WKWebView 리스크는 수용(§5) |
| 테스트 환경 | node + jsdom 분리 (`test.projects`) | 순수 로직은 node에서 가볍게, 컴포넌트는 jsdom에서. Vitest 4는 `vitest.workspace.ts`를 제거하고 `projects`가 정식 방식 |
| 테스트 프레임워크 버전 | **Vitest 4.1.8 정확 핀** | Vite 8 지원은 **4.1+** 부터(4.0.x의 `@vitest/mocker`가 vite 8 peer 거부, 이슈 #9807). `@vitest/coverage-v8`도 **4.1.8 동일 버전**(peer가 정확 핀) |
| 커버리지 | v8 provider, 리포트만 (threshold 없음) | 현재 테스트 대상이 사실상 없어 임계값 강제 시 바로 실패. 가시성만 먼저 확보 |
| 산출물 | config만 (예제/스모크 spec 미포함) | 보일러플레이트에 쓰는 테스트는 곧 버려짐. 검증은 임시 spec으로 하고 산출물엔 남기지 않음 |
| config 위치 | 별도 `vitest.config.ts` | Tauri 전용 `vite.config.ts`(server/port/HMR)와 관심사 분리, surgical |
| 환경 split 방식 | 파일 확장자 컨벤션 (`*.spec.ts`→node, `*.spec.tsx`→jsdom) | test-code-style의 colocate 컨벤션과 자연스럽게 일치 |

## 4. 설계

### 4.0 1단계: Vite 7 → 8 업그레이드

Vite 8은 esbuild+Rollup을 **Rolldown+Oxc** 단일 러스트 번들러로 교체한다. 이 프로젝트가 실제로 손대는
설정 표면은 **하나도 바뀌지 않는다**(async `defineConfig`, `plugins:[react()]`, `server.{port,strictPort,host,hmr,watch.ignored}`,
`clearScreen` 모두 Vite 8에서 그대로 유효). 따라서 업그레이드는 **버전 범프 + 검증**이 전부다.

**버전 범프 (함께 — peer-lock):**
- `vite` `^7.0.4` → `^8.0.0` (8.0.16)
- `@vitejs/plugin-react` `^4.6.0` → `^6.0.0` (6.0.2)

> plugin-react 6은 `vite ^8` 전용이고 현재 4.7.0은 `vite ^7`까지만 → **둘을 따로 올리면 pnpm peer 충돌**.
> 한 변경(커밋)에서 동시에 올린다. plugin-react 6은 Babel 기능을 제거(React Refresh는 Vite 8 코어 Oxc가 처리)하지만,
> 스캐폴드는 `babel` 옵션 없는 순수 `react()`라 **코드/설정 변경이 없다**.

**config 변경:** 없음. `vite.config.ts`/`src-tauri/tauri.conf.json`/`tsconfig`/`src/vite-env.d.ts` 모두 그대로.
(`build.target`은 §3 결정대로 Vite 8 기본값 유지 → 명시 안 함.)

**pnpm 주의:** Vite 8의 네이티브 빌드는 esbuild가 아니라 Rolldown/Oxc다. 첫 설치 시 pnpm이 새 네이티브 패키지의
build script를 막으면 승인한다. 기존 `pnpm.onlyBuiltDependencies:["esbuild"]`는 Vite 8에선 inert(무해)하므로 그대로 둔다.

검증은 §6 1단계 참고. **1단계가 green이 된 뒤 2단계로 진행**한다.

### 4.1 2단계 — 추가 의존성 (devDependencies)

- `vitest@4.1.8` (정확 핀). Vite 8 지원은 4.1+ 부터(4.0.x는 `@vitest/mocker`가 vite 8 peer 거부). peer: vite `^6 || ^7 || ^8`
- `@vitest/coverage-v8@4.1.8` — **vitest와 동일 버전**. peerDependency가 vitest 정확 버전(`4.1.8`)을 핀
- `jsdom@^29` (최신 29.1.1). Node 24.4.1(mise 핀)이 jsdom 29의 Node ≥ 22.13 요구를 충족. vitest의 optional peer라 별도 설치
- `@testing-library/react@^16` (React 19는 16.1.0+ 부터 지원; 최신 16.3.x)
- `@testing-library/dom@^10` (RTL v16의 required peer — 별도 설치)
- `@testing-library/jest-dom@^6`
- `@testing-library/user-event@^14`

JSX 변환은 **1단계에서 `^6`으로 올린** `@vitejs/plugin-react`를 재사용한다 (새 플러그인 불필요).

**툴체인 (이미 구성됨):** Node는 **mise로 24.4.1 핀**(`mise.toml`), 패키지 매니저는 **pnpm 10.27.0**(`package.json` `packageManager` 필드 + mise). Node 24.4.1은 Vite 8(node `^20.19||>=22.12`)·Vitest 4.1·jsdom 29를 모두 충족. 테스트 의존성은 `pnpm add -D`로 설치한다. (위 test 의존성들은 postinstall build script가 없어 추가 승인 불필요.)

### 4.2 생성 / 수정 파일

| 동작 | 파일 | 내용 |
|---|---|---|
| 수정 (1단계) | `package.json` | `vite ^8` + `@vitejs/plugin-react ^6` 범프 |
| 수정 (2단계) | `package.json` | 위 test devDeps + scripts(§4.4) |
| 생성 | `vitest.config.ts` | `test.projects`(node/jsdom) + 루트 `coverage`(v8) + `passWithNoTests:true`. **jsdom 프로젝트 entry에 `plugins:[react()]` 직접 선언**(§4.3 참고) |
| 생성 | `vitest.setup.ts` | jsdom 프로젝트 setupFile. `import '@testing-library/jest-dom/vitest'` (matcher 등록 + 타입 augmentation) |
| 생성 | `src/vitest.d.ts` | `/// <reference types="vitest/globals" />` — 기존 tsconfig `types` 배열을 건드리지 않고 전역 타입 인식 |
| 수정 | `.gitignore` | `coverage/` 추가 |
| 변경 없음 | `vite.config.ts` | Vite 8에서도 Tauri 설정 그대로 유효 (build.target 미지정) |

### 4.3 vitest config 형태 (개요)

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

> **확정 사항 (Vitest 4 교차검증):** inline project는 기본적으로 루트 config를 상속하지 않는다(`extends: false` 기본값).
> 따라서 루트에 `plugins`를 둬도 jsdom 프로젝트로 전파되지 않아 `.tsx`를 변환하지 못한다. 위처럼 **jsdom 프로젝트
> entry의 객체 루트 레벨(`test`의 형제)에 `plugins:[react()]`를 직접 선언**해야 한다(`test`에는 `plugins` 필드 없음).
> 대안으로 entry에 `extends: true`를 줄 수도 있으나, node 프로젝트엔 react가 불필요하므로 jsdom entry 국소 선언이 더 surgical.
> `coverage`·`passWithNoTests`는 프로젝트 레벨에 둘 수 없고 **루트 `test`에만** 설정 가능(확정).
> 이 `react()`는 1단계에서 올린 plugin-react 6이며, Vite 8 코어로 `.tsx`를 변환한다.

### 4.4 npm scripts (pnpm로 실행)

```jsonc
{
  "test": "vitest run",
  "test:watch": "vitest",
  "coverage": "vitest run --coverage"
}
```

### 4.5 환경 split 컨벤션

- `*.spec.ts` → `node` 프로젝트 (순수 함수 유닛 테스트)
- `*.spec.tsx` → `jsdom` 프로젝트 (React 컴포넌트 테스트)
- **탈출구:** `.ts` 파일의 헬퍼가 DOM API를 필요로 하는 드문 경우, 해당 spec 상단에
  `// @vitest-environment jsdom` docblock으로 파일 단위 override. (이 파일은 여전히 `node` 프로젝트에
  매칭되고, 그 파일만 jsdom 환경으로 실행됨 — 프로젝트 재배정이 아니라 환경 override.)

## 5. 트레이드오프 / 리스크

### Vite 8 (1단계)
- **번들러 엔진 교체 (Rolldown/Oxc/Lightning CSS)**: 설정 표면은 안 바뀌지만 출력 엔진이 바뀐다. 빌드 exit 0만으로
  부족 — **실제 WKWebView에서 마크다운 렌더**(react-markdown 10 / shiki 4 / @shikijs/rehype 4 / remark-gfm 4)를 확인한다(§6 1단계).
- **build.target 기본값 수용**: Vite 8 기본 baseline은 Safari 16.4. 최신 macOS 단일 사용자 전제라 OK이나,
  **구형 macOS WKWebView에서 실행 시 미지원 syntax 가능성**(빌드는 통과해도 런타임 에러). 필요 시 `build.target`을 보수적 값(예: `safari13`)으로 명시.
- **vite ↔ plugin-react peer-lock**: 6.x는 vite 8 전용, vite 8은 plugin-react ≥6 필요. 한쪽만 되돌리면 peer 충돌 → **둘은 항상 함께** 이동.
- **pnpm 네이티브 빌드 승인**: Rolldown/Oxc 네이티브 패키지의 postinstall을 pnpm이 막을 수 있어 첫 설치 시 승인 필요할 수 있음.
- **CJS interop 변화**: Vite 8은 CJS default-import interop을 일관화. ESM 프로젝트라 거의 무관하나, CJS-only 전이 의존성이 있으면 빌드 시 표면화 가능(탈출구 `legacy.inconsistentCjsInterop:true`, 필요 시에만).

### vitest 인프라 (2단계)
- **vitest 4.1 floor**: 4.0.x는 vite 8 불가(@vitest/mocker peer #9807). 반드시 4.1.8. `@vitest/coverage-v8`도 동일 버전(정확 핀).
- **확장자 기반 split**: `.ts` 파일이 DOM을 건드리면 node 환경에서 실패. → 4.5의 docblock 탈출구로 해결.
- **빌드 시 spec 타입체크**: tsconfig `include`가 `["src"]`라 프로덕션 빌드의 `tsc`가 spec도 타입체크. 테스트 타입 패키지가
  설치돼 있으면 문제 없고 오히려 타입 안전성에 이로움. (§6 2단계에서 확인)
- **`types` 배열 미사용**: tsconfig에 `types:["vitest/globals"]`를 넣으면 자동 @types 포함이 꺼지는 부작용 → 대신 `src/vitest.d.ts` triple-slash reference.
- **jsdom Node 하한 (해소됨)**: jsdom 29는 Node ≥ 22.13 요구하나 mise가 Node 24.4.1로 핀하므로 충족.

## 6. 검증 기준 (Goal-Driven)

### 1단계 — Vite 8 업그레이드
1. `package.json`에서 `vite ^8` + `@vitejs/plugin-react ^6` 함께 범프 → `pnpm install` → vite/plugin-react peer 경고 없이 성공 (pnpm이 Rolldown/Oxc 네이티브 build script를 막으면 승인)
2. `pnpm build` (`tsc && vite build`) → exit 0 + `dist/` 생성
3. `pnpm tauri dev` → `http://localhost:1420` Rolldown dev 서버 도달 + **WKWebView에서 마크다운 실제 렌더** 확인
4. `pnpm tauri build` → 번들 빌드 + 패키지 앱이 WKWebView에서 정상 렌더 (새 엔진이므로 단순 빌드 통과가 아니라 실제 렌더 확인). **green이면 1단계 커밋**

### 2단계 — vitest 인프라
5. `pnpm add -D vitest@4.1.8 @vitest/coverage-v8@4.1.8 jsdom@^29 @testing-library/react@^16 @testing-library/dom@^10 @testing-library/jest-dom@^6 @testing-library/user-event@^14` → `@vitest/mocker`/vitest의 vite peer 경고 없이 성공(4.1.x가 vite 8 peer 충족), coverage-v8 == vitest 동일 버전
6. `pnpm test` → spec이 없으므로 `passWithNoTests`로 **exit 0 (green)**
7. **임시 검증 (산출물 미포함):** node용 `.spec.ts` 1개 + jsdom용 `.spec.tsx` 1개를 임시로 추가해 `pnpm test`에서 `node`·`jsdom` 두 프로젝트가 모두 실제로 spec을 실행·통과하는지 확인한 뒤 **삭제**
8. `pnpm coverage` → 커버리지 리포트 생성 + exit 0
9. `pnpm build` → 테스트 타입/설정이 프로덕션 빌드를 깨지 않음

## 7. 향후 (이 설계 밖, 참고)

- 실제 모듈이 생기면 colocated spec 작성 + 그 시점에 커버리지 threshold 도입 검토
- 필요 시 CI에서 `pnpm test` + `pnpm coverage` 실행
- 구형 macOS 배포가 생기면 `build.target`을 보수적 값으로 명시 재검토
