// /js/site.js
(() => {
  // (선택) 우클릭/롱프레스/드래그 선택 방지 — 기존 유지
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("selectstart", (e) => e.preventDefault());

  // =========================
  // Theme (Global)
  // =========================
  const THEME_KEY = "theme"; // "light" | "dark"
  const root = document.documentElement;

  const apply = (theme) => {
    const isDark = theme === "dark";
    root.classList.toggle("dark", isDark);

    // (선택) 브라우저 UI 색도 맞추고 싶으면 meta theme-color도 교체 가능
    // const meta = document.querySelector('meta[name="theme-color"]');
    // if (meta) meta.setAttribute("content", isDark ? "#0B1220" : "#2563EB");
  };

  const get = () => localStorage.getItem(THEME_KEY) || "light";
  const set = (theme) => {
    localStorage.setItem(THEME_KEY, theme === "dark" ? "dark" : "light");
    apply(get());
  };
  const toggle = () => set(get() === "dark" ? "light" : "dark");

  // 페이지 진입 시 항상 적용(홈에서 설정한 값이 서브에 자동 반영)
  apply(get());

  // 홈에서만 버튼 바인딩할 수 있도록 헬퍼 제공
  const bindToggleButton = (btnOrSelector) => {
    const btn =
      typeof btnOrSelector === "string"
        ? document.querySelector(btnOrSelector)
        : btnOrSelector;

    if (!btn) return;

    const paintIcon = () => {
      btn.textContent = get() === "dark" ? "☀️" : "🌙";
      btn.setAttribute("aria-label", get() === "dark" ? "라이트 모드" : "다크 모드");
    };

    paintIcon();
    btn.addEventListener("click", () => {
      toggle();
      paintIcon();
    });

    // 다른 탭/창에서 바꿔도 아이콘 동기화
    window.addEventListener("storage", (e) => {
      if (e.key !== THEME_KEY) return;
      apply(get());
      paintIcon();
    });
  };

  window.SiteTheme = { get, set, toggle, apply, bindToggleButton };

  // =========================
  // Overlay Back Manager
  // =========================
  const STACK = []; // [{ key, close }]
  let internalPop = false;

  const top = () => STACK[STACK.length - 1];
  const isSameKeyOnTop = (key) => top()?.key === key;

  const open = (key, closeFn) => {
    if (!key || typeof closeFn !== "function") return;
    if (isSameKeyOnTop(key)) return;

    STACK.push({ key, close: closeFn });

    try {
      history.pushState({ __overlay: true, key }, "", location.href);
    } catch (_) {}
  };

  const close = (key, opts = {}) => {
    const { fromPopstate = false } = opts;

    if (!key) key = top()?.key;
    if (!key) return;

    let idx = -1;
    for (let i = STACK.length - 1; i >= 0; i--) {
      if (STACK[i].key === key) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;

    const item = STACK.splice(idx, 1)[0];
    try {
      item.close?.();
    } catch (_) {}

    if (!fromPopstate) {
      internalPop = true;
      try {
        history.back();
      } catch (_) {}
      setTimeout(() => (internalPop = false), 150);
    }
  };

  window.addEventListener(
    "popstate",
    () => {
      if (internalPop) {
        internalPop = false;
        return;
      }
      if (!STACK.length) return;

      const t = top();
      if (!t) return;

      close(t.key, { fromPopstate: true });
    },
    true
  );

  window.SiteOverlay = { open, close, stack: STACK };
})();

// =========================
// Effects (Confetti)
// =========================
(() => {
  const reduced = () =>
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  const fire = (opts) => {
    if (reduced()) return;
    if (typeof window.confetti !== "function") return;
    try { window.confetti(opts); } catch (_) {}
  };

  const burstSmall = () => {
    fire({ particleCount: 60, spread: 70, startVelocity: 35, origin: { y: 0.45 } });
  };

  const burstBig = () => {
    fire({ particleCount: 160, spread: 110, startVelocity: 55, origin: { y: 0.4 } });
    setTimeout(
      () => fire({ particleCount: 120, spread: 90, startVelocity: 45, origin: { y: 0.45 } }),
      180
    );
  };

  window.SiteFX = { burstSmall, burstBig };
})();
