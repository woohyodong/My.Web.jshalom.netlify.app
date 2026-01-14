// /js/site.js
(() => {
  // (선택) 우클릭/롱프레스/드래그 선택 방지 — 기존 유지
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("selectstart", (e) => e.preventDefault());

  // =========================
  // Overlay Back Manager
  // =========================
  const STACK = []; // [{ key, close }]
  let internalPop = false;

  const top = () => STACK[STACK.length - 1];

  const isSameKeyOnTop = (key) => top()?.key === key;

  const open = (key, closeFn) => {
    if (!key || typeof closeFn !== "function") return;

    // 이미 top이면 중복 push 방지
    if (isSameKeyOnTop(key)) return;

    STACK.push({ key, close: closeFn });

    // “오버레이 1개 열림”을 히스토리에 기록 (URL은 그대로)
    try {
      history.pushState({ __overlay: true, key }, "", location.href);
    } catch (_) {}
  };

  const close = (key, opts = {}) => {
    const { fromPopstate = false } = opts;

    // key가 없으면 top 닫기
    if (!key) key = top()?.key;
    if (!key) return;

    // stack에서 key 항목 제거(보통 top)
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

    // 사용자가 '닫기 버튼'으로 닫은 경우: 우리가 쌓은 히스토리 1칸을 되돌려 정리
    if (!fromPopstate) {
      internalPop = true;
      try {
        history.back();
      } catch (_) {}
      // popstate가 안 오는 환경 대비 안전장치
      setTimeout(() => (internalPop = false), 150);
    }
  };

  // Android back(popstate) 처리
  window.addEventListener(
    "popstate",
    () => {
      if (internalPop) {
        internalPop = false;
        return;
      }
      if (!STACK.length) return;

      // “페이지 뒤로가기” 대신 “오버레이 닫기”
      const t = top();
      if (!t) return;

      // popstate로 닫을 때는 history.back() 다시 호출하면 안 됨
      close(t.key, { fromPopstate: true });
    },
    true
  );

  // 전역으로 노출 (각 페이지/app.js에서 호출)
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
    fire({ particleCount: 160, spread: 110, startVelocity: 55, origin: { y: 0.4} });
    setTimeout(() =>
      fire({ particleCount: 120, spread: 90, startVelocity: 45, origin: { y: 0.45 } }),
    180);
  };

  window.SiteFX = {
    burstSmall,
    burstBig,
  };
})();
