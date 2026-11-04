// Touch ID + 钥匙串桥接。仅 Tauri 桌面端有效；浏览器里全部安全降级。
const isTauri = !!window.__TAURI_INTERNALS__;
let _invoke = null;

async function invoke(cmd, args) {
  if (!isTauri) throw new Error("not tauri");
  if (!_invoke) {
    const core = await import("@tauri-apps/api/core");
    _invoke = core.invoke;
  }
  return _invoke(cmd, args);
}

export async function biometricAvailable() {
  if (!isTauri) return false;
  try {
    return await invoke("biometric_available");
  } catch {
    return false;
  }
}

// 弹出 Touch ID，通过后由 Rust 端直接从钥匙串取出密码。
// 返回 { passed, password }：指纹没过 passed=false；过了但钥匙串里没存 password=null。
// 没有单独的"读钥匙串"接口——那样前端被注入脚本时就能绕过指纹。
export async function biometricUnlock(reason, account) {
  if (!isTauri) return { passed: false, password: null };
  try {
    const password = await invoke("biometric_unlock", { reason, account });
    return { passed: true, password: password ?? null };
  } catch {
    return { passed: false, password: null };
  }
}

export async function keychainSet(account, secret) {
  if (!isTauri) return false;
  try {
    await invoke("keychain_set", { account, secret });
    return true;
  } catch (e) {
    console.error("[keychain] set 失败", e);
    return false;
  }
}

export async function keychainDelete(account) {
  if (!isTauri) return;
  try {
    await invoke("keychain_delete", { account });
  } catch {}
}
