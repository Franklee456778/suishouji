// 应用内弹窗，替代浏览器原生 prompt/confirm
// （原生弹窗在预览 iframe 和 Tauri WKWebView 中都不可用）
const el = (id) => document.getElementById(id);

// fields: [{ key, type, placeholder, inputmode }]
// validate(values) -> 错误字符串(留在弹窗) | null(通过)
function openModal({ title, message, fields = [], okLabel, danger, validate }) {
  return new Promise((resolve) => {
    const overlay = el("modal-overlay");
    el("modal-title").textContent = title || "";
    const msg = el("modal-message");
    msg.textContent = message || "";
    msg.style.display = message ? "" : "none";

    const errEl = el("modal-error");
    errEl.textContent = "";
    errEl.style.display = "none";

    // 渲染输入字段
    const fieldsWrap = el("modal-fields");
    fieldsWrap.innerHTML = "";
    const inputs = [];
    fields.forEach((f) => {
      const input = document.createElement("input");
      input.className = "modal-input";
      input.type = f.type || "text";
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.inputmode) input.inputMode = f.inputmode;
      input.dataset.key = f.key;
      input.value = f.value || "";
      fieldsWrap.appendChild(input);
      inputs.push(input);
    });

    const okBtn = el("modal-ok");
    okBtn.textContent = okLabel || "确定";
    okBtn.classList.toggle("modal-danger", !!danger);

    overlay.classList.add("open");
    if (inputs.length) {
      inputs[0].focus();
      inputs[0].select();
    } else {
      okBtn.focus();
    }

    function values() {
      const v = {};
      inputs.forEach((i) => (v[i.dataset.key] = i.value));
      return v;
    }
    function cleanup(result) {
      overlay.classList.remove("open");
      okBtn.removeEventListener("click", onOk);
      el("modal-cancel").removeEventListener("click", onCancel);
      overlay.removeEventListener("mousedown", onOverlay);
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    }
    function onOk() {
      const v = values();
      if (validate) {
        const err = validate(v);
        if (err) {
          errEl.textContent = err;
          errEl.style.display = "";
          return; // 不关闭，让用户改
        }
      }
      cleanup(fields.length ? v : true);
    }
    const onCancel = () => cleanup(fields.length ? null : false);
    const onOverlay = (e) => {
      if (e.target === overlay) onCancel();
    };
    const onKey = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onOk();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    okBtn.addEventListener("click", onOk);
    el("modal-cancel").addEventListener("click", onCancel);
    overlay.addEventListener("mousedown", onOverlay);
    document.addEventListener("keydown", onKey, true);
  });
}

// 输入框弹窗 → 返回字符串或 null
export async function showPrompt(title, defaultValue = "", okLabel = "确定") {
  const v = await openModal({
    title,
    fields: [{ key: "v", type: "text", value: defaultValue }],
    okLabel,
  });
  return v ? v.v.trim() || null : null;
}

// 确认弹窗 → 返回 true / false
export function showConfirm(title, { message = "", okLabel = "确定", danger = false } = {}) {
  return openModal({ title, message, fields: [], okLabel, danger });
}

// 密码弹窗 → 返回密码字符串或 null。confirm=true 时要求两次一致。
export async function showPassword(title, { confirm = false, message = "", okLabel = "确定" } = {}) {
  const fields = [{ key: "pw", type: "password", placeholder: "密码（可用数字）", inputmode: "text" }];
  if (confirm)
    fields.push({ key: "pw2", type: "password", placeholder: "再次输入确认", inputmode: "text" });
  const v = await openModal({
    title,
    message,
    fields,
    okLabel,
    validate: (vals) => {
      if (!vals.pw) return "请输入密码";
      if (confirm && vals.pw.length < 4) return "密码至少 4 位";
      if (confirm && vals.pw !== vals.pw2) return "两次输入不一致";
      return null;
    },
  });
  return v ? v.pw : null;
}
