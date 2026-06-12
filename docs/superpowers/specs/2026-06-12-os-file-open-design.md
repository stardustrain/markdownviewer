# OS 파일 열기 (Finder 더블클릭 + CLI open) 설계 — 로드맵 5번

- 날짜: 2026-06-12
- 상태: 승인됨 (구현 계획 작성 전)
- 진행 위치: `worktree-file-open-rendering` 브랜치에 스택, 4번(watcher) 다음 구현 (5번은 번들 빌드로만 테스트 가능하므로)
- 검증: fileAssociations 스키마(tauri-utils 소스)·RunEvent::Opened·LaunchServices 동작·`open -a`·percent-decoding을 다중 에이전트로 소스/공식 문서 레벨 확인, 사용자 macOS에서 mdls로 UTI 확인 완료(2026-06-12). 관련 스펙: [2026-06-12-file-watcher-design.md](2026-06-12-file-watcher-design.md)

Finder 더블클릭("다음으로 열기" 포함)과 CLI(`open -a markdownviewer A.md`)로 파일을 열 수 있게 한다. `mkv` 명령은 앱 밖 사용자 환경 설정(쉘 스크립트/alias — `exec open -a markdownviewer "$@"`)이므로 이 스펙의 산출물이 아니다.

## 1. 목표 / 비목표

### 목표

- `.md`/`.markdown`/`.mdx` 파일 연결 선언 (기본 핸들러 지정 없이 — "다음으로 열기"와 `open -a` 동작이 목표)
- 콜드 스타트(파일로 앱 실행)·실행 중 양쪽에서 파일 수신 → 기존 `openPath` 흐름으로 열기(현재 문서 교체, watcher 자동 전환)
- 여러 파일 동시 수신 시 **마지막 파일만** (단일 문서, 사용자 결정)
- 실행 중 수신 시 창 활성화(unminimize + focus)

### 비목표

- `.md` 기본 앱 지정(사용자가 Finder에서 직접), `mkv` 스크립트 설치, 멀티 윈도우, deep link URL 스킴
- tao#1206 우회 구현 (§5 — upstream 미수정 버그, 문서화만)

## 2. 결정 사항과 근거

| 결정 | 선택 | 근거 |
|---|---|---|
| 파일 연결 선언 | `bundle.fileAssociations: [{ ext: ["md","markdown","mdx"], name: "Markdown", role: "Viewer" }]` | `role` 기본값이 Editor라 읽기 전용 뷰어는 Viewer 명시. Info.plist의 CFBundleDocumentTypes로 변환(확장자 기반 클레임) |
| `mimeType` 미지정 | **넣으면 안 됨** | tauri-utils가 LSItemContentTypes를 주입하면 macOS가 CFBundleTypeExtensions를 무시 — plain-text 전체를 클레임하는 사고 (소스 검증) |
| `exportedType` 미지정 | **넣으면 안 됨** | `.md`/`.markdown`은 시스템이 이미 `net.daringfireball.markdown`으로 선언(사용자 macOS에서 mdls 확인). exportedType은 소유권 클레임 + 추론된 content type 전부 대체 |
| 수신 메커니즘 | `RunEvent::Opened { urls }` (macOS는 argv로 경로가 오지 않음 — Apple Events) | 공식 file-associations 예제 패턴. `url.to_file_path()`가 percent-decode 처리(한글/공백 파일명 확인됨), `filter_map(.ok())`로 비파일 URL 제거 |
| lib.rs 구조 | `.run(generate_context!())` → **`.build(generate_context!()).expect(...).run(\|app, event\| ...)`** | RunEvent 관찰은 클로저 형태만 가능(문서 검증). RunEvent는 `#[non_exhaustive]` — 와일드카드 암 필수, Opened는 `#[cfg(target_os = "macos")]` 가드 |
| 콜드 스타트 | managed state 버퍼 + `opened_files` 커맨드 (프론트가 마운트 후 1회 pull) | **Opened가 웹뷰 로드 전에 발생**(검증: Opened → Ready 순서)하므로 emit만으론 유실. 버퍼는 **읽을 때 drain**(`mem::take`) — 웹뷰 리로드 시 이전 파일 재전달·무한 증식 방지 |
| 실행 중 | `app.emit("opened", files)` + `unminimize()`/`set_focus()` | listen으로 즉시 반영. macOS가 앱은 자동 활성화하지만 최소화 창은 복구 안 함 — 방어적으로 포함 |
| 프론트 | `fetchOpenedFiles`/`subscribeOpened` DI prop, 둘 다 `.at(-1)` last-wins → 기존 `openPath` | 기존 DI·단일 문서 정책과 일치. pull과 emit 사이 중복 전달은 last-wins openPath로 멱등 — 테스트로 고정 |

## 3. 설계

### 3.1 데이터 흐름

```
[콜드 스타트] Finder/open -a → 앱 실행 → RunEvent::Opened(웹뷰 로드 전) → OpenedFiles 버퍼 적재
              → 프론트 마운트 → fetchOpenedFiles() (drain) → .at(-1) → openPath
[실행 중]     RunEvent::Opened → 버퍼 적재 + emit "opened" + unminimize/focus
              → subscribeOpened 리스너 → .at(-1) → openPath (현재 문서 교체 → watcher 자동 전환)
```

### 3.2 모듈 구성

| 파일 | 역할 | DI |
|---|---|---|
| `src-tauri/tauri.conf.json` (수정) | `bundle.fileAssociations` 추가 | — |
| `src-tauri/src/lib.rs` (수정) | `.build().run(클로저)` 재구성, `OpenedFiles(Mutex<Vec<String>>)` state, `opened_files` 커맨드(drain), Opened 핸들러(to_file_path → 적재 + emit + 창 복구) | — |
| `src/App.tsx` (수정) | 마운트 시 1회 `fetchOpenedFiles` → 열기, `subscribeOpened` 구독 → 열기 | `fetchOpenedFiles?: () => Promise<string[]>`, `subscribeOpened?: (args: { onOpen: (args: { paths: string[] }) => void }) => Promise<() => void>` |

기존 모듈 재사용: 열기는 전부 `openPath`(읽기 실패 → notice, 성공 → watcher 교체 — 4번 스펙). 확장자 검증은 하지 않는다(OS가 선언된 연결로만 보냄; `open -a`로 다른 확장자를 강제로 보내는 경우는 읽어서 보여주면 그만).

## 4. 검증 기준

**TDD (DI fake):** `App.spec.tsx` 추가 — 콜드 스타트 pull: fetchOpenedFiles가 `["/a.md","/b.md"]` 반환 → b.md만 열림 / 실행 중: fake subscribeOpened의 onOpen 호출 → 현재 문서 교체 / pull+emit 중복 전달 → 마지막 상태 동일(멱등) / 빈 배열 pull → 무동작.

**수동 (번들 필수 — `RunEvent::Opened`는 `tauri dev`로 발화 불가, 검증됨):**

```bash
pnpm tauri build --debug --bundles app   # 반복 테스트용 (dmg 생략)
# 등록: 번들 1회 실행 또는 /Applications 복사. 이름 충돌 시 경로로: open -a <bundle path> A.md
```

- [ ] 콜드 스타트: 앱 종료 상태에서 `open -a markdownviewer A.md` → 앱 뜨고 문서 렌더
- [ ] 실행 중: 다른 파일 `open -a` → 현재 창에서 교체 + 창 전면
- [ ] Finder 더블클릭("다음으로 열기 → markdownviewer")
- [ ] 한글·공백 파일명
- [ ] 멀티 선택 열기 → 마지막 파일만
- [ ] 열린 뒤 저장 → watcher 갱신(4번과 통합 동작)
- [ ] (한계 확인) quarantine 파일을 실행 중에 더블클릭 → 무시됨이 정상(tao#1206)

## 5. 트레이드오프 / 리스크

- **tao#1206 (upstream, 미수정·확인됨)**: macOS 26 Tahoe에서 `com.apple.quarantine` xattr가 붙은 파일은 **앱이 이미 실행 중일 때** Finder 열기가 조용히 무시됨(Opened 미발화). 콜드 스타트는 정상, `xattr -d`로 제거하면 정상. 다운로드한 md 파일이 해당 — 알려진 한계로 문서화, 우회 구현하지 않음
- LaunchServices에 stale 번들이 여러 개 등록되면 `open -a 이름`이 비결정적 — 테스트는 번들 경로 직접 지정 또는 /Applications 단일 사본 유지
- `tauri dev`로 5번 기능 반복 테스트 불가 → 수정마다 `--debug --bundles app` 빌드 (Rust 증분 컴파일이라 수 분 미만)
- Opened는 deep link와 공유 채널 — `to_file_path().ok()` 필터가 방어 (이 앱은 스킴 선언 없음)
