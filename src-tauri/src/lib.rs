use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_full::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, Debouncer, RecommendedCache,
};
use serde::Serialize;
use tauri::{Emitter, Manager};

struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>);

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![read_file, start_watching])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
