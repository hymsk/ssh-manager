// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, State};

/// Handle to the bundled Node backend, so we can stop it on exit.
struct BackendProcess(Mutex<Option<Child>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            // In dev the backend is started by beforeDevCommand. In production we
            // spawn the sidecar binary that ships next to the app executable.
            #[cfg(not(debug_assertions))]
            {
                if let Ok(exe_dir) = std::env::current_exe() {
                    if let Some(dir) = exe_dir.parent() {
                        let bin = dir.join(if cfg!(windows) { "server-x86_64-pc-windows-msvc.exe" } else { "server-x86_64-unknown-linux-gnu" });
                        if bin.exists() {
                            match Command::new(&bin).env("PORT", "8899").spawn() {
                                Ok(child) => {
                                    let state: State<BackendProcess> = app.state();
                                    *state.0.lock().unwrap() = Some(child);
                                    println!("[ssh-manager] backend started: {:?}", bin);
                                }
                                Err(err) => eprintln!("[ssh-manager] failed to start backend: {err}"),
                            }
                        }
                    }
                }
            }
            let _ = app;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                let state: State<BackendProcess> = app_handle.state();
                if let Some(mut child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
