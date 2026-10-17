use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Global show/hide toggle: Cmd+Shift+P on macOS, Ctrl+Shift+P on Windows.
pub fn setup_shortcuts(app: &tauri::AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut("CommandOrControl+Shift+P", |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("pet") {
                    let visible = window.is_visible().unwrap_or(false);
                    let state = app.state::<std::sync::Arc<crate::commands::AppState>>();
                    let _ = if visible {
                        crate::commands::hide_pet(app.clone(), state)
                    } else {
                        crate::commands::show_pet(app.clone(), state)
                    };
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}
