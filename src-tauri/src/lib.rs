// ---------- 钥匙串（跨平台，存/取/删密码）----------
const KEYCHAIN_SERVICE: &str = "com.suishouji.notes";

#[tauri::command]
fn keychain_set(account: String, secret: String) -> Result<(), String> {
  let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
  entry.set_password(&secret).map_err(|e| e.to_string())
}

// 注意：故意没有单独的"读钥匙串"命令。读密码只能走 biometric_unlock——
// 指纹在 Rust 这边验过才返回密码。以前是前端先调指纹、再调 keychain_get，
// 校验只在 JS 里，前端一旦被注入脚本就能跳过指纹直接把密码拿走。
fn keychain_read(account: &str) -> Result<Option<String>, String> {
  let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account).map_err(|e| e.to_string())?;
  match entry.get_password() {
    Ok(p) => Ok(Some(p)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
fn keychain_delete(account: String) -> Result<(), String> {
  let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
  match entry.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}

// ---------- Touch ID（macOS）----------
#[cfg(target_os = "macos")]
#[tauri::command]
fn biometric_available() -> bool {
  use objc2_local_authentication::{LAContext, LAPolicy};
  let context = unsafe { LAContext::new() };
  unsafe {
    context
      .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
      .is_ok()
  }
}

#[cfg(target_os = "macos")]
fn biometric_evaluate(reason: &str) -> Result<bool, String> {
  use block2::RcBlock;
  use objc2_foundation::{NSError, NSString};
  use objc2_local_authentication::{LAContext, LAPolicy};
  use std::sync::mpsc::channel;

  let context = unsafe { LAContext::new() };
  let reason = NSString::from_str(reason);
  let (tx, rx) = channel::<bool>();
  let handler = RcBlock::new(move |success: objc2::runtime::Bool, _error: *mut NSError| {
    let _ = tx.send(success.as_bool());
  });
  unsafe {
    context.evaluatePolicy_localizedReason_reply(
      LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
      &reason,
      &handler,
    );
  }
  rx.recv_timeout(std::time::Duration::from_secs(120))
    .map_err(|_| "认证超时或被取消".to_string())
}

/// 指纹通过 → 返回钥匙串里的密码；指纹没过 → Err；钥匙串里没存 → Ok(None)
#[cfg(target_os = "macos")]
#[tauri::command]
fn biometric_unlock(reason: String, account: String) -> Result<Option<String>, String> {
  if !biometric_evaluate(&reason)? {
    return Err("Touch ID 未通过".to_string());
  }
  keychain_read(&account)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn biometric_available() -> bool {
  false
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn biometric_unlock(_reason: String, _account: String) -> Result<Option<String>, String> {
  Err("当前平台不支持生物识别".to_string())
}

// ---------- 外部链接 ----------
const MAX_EXTERNAL_URL_LEN: usize = 2048;

/// 只放行 http/https/mailto，拒绝带账号密码、控制字符或超长的网址。
fn external_url_allowed(raw: &str) -> bool {
  if raw.len() > MAX_EXTERNAL_URL_LEN || raw.chars().any(char::is_control) {
    return false;
  }
  match tauri::Url::parse(raw) {
    Ok(u) => {
      matches!(u.scheme(), "http" | "https" | "mailto") && u.username().is_empty() && u.password().is_none()
    }
    Err(_) => false,
  }
}

/// 打开外部链接前由 Rust 弹原生确认框，显示完整网址。
/// 前端脚本点不了这个对话框，所以就算被注入，也不能悄悄用浏览器把数据带出去。
/// async：对话框要等主线程，放在主线程上跑会死锁。
#[tauri::command(async)]
fn open_external(app: tauri::AppHandle, url: String) -> Result<bool, String> {
  use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
  use tauri_plugin_opener::OpenerExt;
  if !external_url_allowed(&url) {
    return Err("不允许打开这个地址".to_string());
  }
  let confirmed = app
    .dialog()
    .message(url.clone())
    .title("用浏览器打开这个链接？")
    .buttons(MessageDialogButtons::OkCancelCustom("打开".to_string(), "取消".to_string()))
    .blocking_show();
  if !confirmed {
    return Ok(false);
  }
  app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())?;
  Ok(true)
}

// ---------- 页面跳转 ----------
/// 主窗口只能显示应用自己的页面。外部地址一律不许跳转（链接走 open_external）。
fn navigation_allowed(url: &tauri::Url) -> bool {
  if cfg!(dev) && url.scheme() == "http" && url.host_str() == Some("localhost") && url.port() == Some(5173) {
    return true;
  }
  url.scheme() == "tauri" && url.host_str() == Some("localhost")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      keychain_set,
      keychain_delete,
      biometric_available,
      biometric_unlock,
      open_external
    ])
    .setup(|app| {
      // 窗口在这里创建（配置里 create=false），才能挂上跳转和新窗口的拦截
      let config = app.config().app.windows[0].clone();
      tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
        .on_navigation(|url| navigation_allowed(url))
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        // WebRTC 能绕过 CSP 直接建网络连接（STUN/TURN），应用用不到，页面脚本运行前就删掉
        .initialization_script(
          "for (const k of ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel','RTCRtpSender','RTCRtpReceiver','RTCIceCandidate','RTCSessionDescription']) { try { delete window[k]; Object.defineProperty(window, k, { value: undefined, writable: false, configurable: false }); } catch (e) {} }",
        )
        .build()?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn external_urls() {
    for ok in ["https://example.com/a?b=1", "http://example.com", "mailto:a@example.com"] {
      assert!(external_url_allowed(ok), "{ok}");
    }
    let long = format!("https://example.com/{}", "a".repeat(MAX_EXTERNAL_URL_LEN));
    for bad in [
      "javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "smb://host/share", "x-apple.systempreferences:",
      "https://user:pw@example.com", "https://example.com/\nx", "not a url", long.as_str(),
    ] {
      assert!(!external_url_allowed(bad), "{bad}");
    }
  }

  #[test]
  fn navigation() {
    let ok = |s: &str| navigation_allowed(&tauri::Url::parse(s).unwrap());
    assert!(ok("tauri://localhost/index.html"));
    for bad in ["https://example.com/?x=secret", "http://tauri.localhost/", "tauri://evil/", "file:///etc/passwd", "data:text/html,x", "about:blank"] {
      assert!(!ok(bad), "{bad}");
    }
  }
}
