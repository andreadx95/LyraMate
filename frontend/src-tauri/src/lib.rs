use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            if let Some(monitor) = window.current_monitor().unwrap_or(None) {
                let screen_size = monitor.work_area();
                let screen_pos = monitor.position();
                let scale = monitor.scale_factor();
                let win_size = window.outer_size().unwrap();
                let x = screen_pos.x + (screen_size.size.width as i32 - win_size.width as i32);
                let y = screen_pos.y + (screen_size.size.height as i32 - win_size.height as i32);
                // Convert to logical position for proper DPI handlingW
                let logical_x = x as f64 / scale;
                let logical_y = y as f64 / scale;
                use tauri::LogicalPosition;
                window.set_position(LogicalPosition::new(logical_x, logical_y)).unwrap();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
