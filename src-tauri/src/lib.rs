use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_full::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, Debouncer, RecommendedCache,
};
use serde::Serialize;
use tauri::{Emitter, Manager};

struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>);

/// 웹뷰가 뜨기 전(콜드 스타트)에 도착한 파일 경로 버퍼.
/// 읽을 때 비운다(drain) — 웹뷰 리로드 시 이전 파일 재전달·무한 증식 방지 (스펙 §2)
struct OpenedFiles(Mutex<Vec<String>>);

#[derive(Clone, Serialize)]
struct FileWatchPayload {
    path: String,
    kind: &'static str, // "changed" | "removed"
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|err| err.to_string())
}

#[tauri::command]
fn start_watching(app: tauri::AppHandle, path: String) -> Result<String, String> {
    // FSEvents가 경로를 canonicalize하므로(/tmp -> /private/tmp) 처음부터 canonical을
    // 문서 식별자로 쓴다 — 반환값을 프론트가 저장해 이벤트 필터에 사용 (스펙 §2)
    let canonical = std::fs::canonicalize(&path).map_err(|err| err.to_string())?;
    let parent = canonical
        .parent()
        .ok_or_else(|| "감시할 부모 디렉터리가 없습니다".to_string())?
        .to_path_buf();
    let file_name = canonical
        .file_name()
        .ok_or_else(|| "파일 이름이 없습니다".to_string())?
        .to_os_string();

    let emit_path = canonical.to_string_lossy().into_owned();
    let target = canonical.clone();
    let handle = app.clone();
    let emit_path_closure = emit_path.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        None, // tick = timeout/4
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return; // watcher 사망 감지는 비목표 (스펙 §5)
            };
            let touches_target = events
                .iter()
                .flat_map(|event| event.paths.iter())
                .any(|event_path| event_path.file_name() == Some(file_name.as_os_str()));
            if !touches_target {
                return;
            }
            // EventKind 분기 대신 stat — 에디터별 atomic save 편차 회피 (스펙 §2)
            let kind = if target.exists() { "changed" } else { "removed" };
            let _ = handle.emit(
                "file-watch",
                FileWatchPayload {
                    path: emit_path_closure.clone(),
                    kind,
                },
            );
        },
    )
    .map_err(|err| err.to_string())?;

    // 파일이 아닌 부모 디렉터리를 watch — 파일이 지워져도 watch가 살아 재생성을 감지 (스펙 §2)
    debouncer
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|err| err.to_string())?;

    // 교체 = 이전 Debouncer drop = 정지 (drop 가드, non-blocking)
    *app.state::<WatcherState>().0.lock().unwrap() = Some(debouncer);

    Ok(emit_path)
}

#[tauri::command]
fn opened_files(app: tauri::AppHandle) -> Vec<String> {
    std::mem::take(&mut *app.state::<OpenedFiles>().0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(None)))
        .manage(OpenedFiles(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![
            read_file,
            start_watching,
            opened_files
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // RunEvent는 #[non_exhaustive] — if let으로 Opened만 처리
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                // file:// URL → 경로 (to_file_path가 percent-decode — 한글/공백 OK).
                // filter_map은 비파일(deep link) URL 방어 (스펙 §2)
                let files: Vec<String> = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect();
                if files.is_empty() {
                    return;
                }
                app.state::<OpenedFiles>()
                    .0
                    .lock()
                    .unwrap()
                    .extend(files.clone());
                // 실행 중인 경우 즉시 반영 — 콜드 스타트에선 웹뷰 로드 전이라 유실되므로
                // 버퍼 + opened_files pull이 본선 (스펙 §2)
                let _ = app.emit("opened", files);
                // macOS가 앱은 자동 활성화하지만 최소화 창은 복구 안 함 — 방어적 복구
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        });
}
