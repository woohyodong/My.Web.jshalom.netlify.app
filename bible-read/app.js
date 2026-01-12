// bible-read/app.js — 365일 통독 (회차 누적, 공유: ?day=123)
(() => {
  const MS_DAY = 1000 * 60 * 60 * 24;
  const DAY_MIN = 1;

  const qs = (sel) => $(sel);
  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

  // ---------- Date helpers ----------
  const dayOfYear = (date) => {
    const start = new Date(date.getFullYear(), 0, 0);
    return Math.floor((date - start) / MS_DAY); // 1..365/366
  };

  const formatKoreanDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const w = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    return `${y}.${m}.${day} (${w})`;
  };

  const dateFromDayOfYear = (year, doy) => {
    const d = new Date(year, 0, 1);
    d.setDate(d.getDate() + (doy - 1));
    return d;
  };

  // ---------- Storage ----------
  const STORAGE_KEY = "bibleRead:progress:v1";

  const nowIso = () => new Date().toISOString();

  const loadProgress = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}

    const init = {
      activeCycle: 1,
      cycles: {
        "1": { completed: {}, startedAt: nowIso(), finishedAt: null }
      }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(init));
    return init;
  };

  const saveProgress = (p) => localStorage.setItem(STORAGE_KEY, JSON.stringify(p));

  const ensureCycle = (p, cycle) => {
    const k = String(cycle);
    if (!p.cycles[k]) p.cycles[k] = { completed: {}, startedAt: null, finishedAt: null };
    return p;
  };

  const countDone = (completedMap) => Object.values(completedMap || {}).filter(Boolean).length;

  // ---------- Query helpers ----------
  const getQueryDay = () => {
    const params = new URLSearchParams(window.location.search);
    const d = parseInt(params.get("day"), 10);
    return Number.isFinite(d) ? d : null;
  };

  const setQueryDay = (day) => {
    const url = new URL(window.location.href);
    url.searchParams.set("day", String(day));
    window.history.replaceState({}, "", url);
  };

  const buildShareUrl = (day) => {
    const url = new URL(window.location.href);
    url.searchParams.set("day", String(day));
    return url.toString();
  };

  const tryShare = async (day) => {
    const url = buildShareUrl(day);
    const title = "주평강교회 · 365일 통독";

    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
    } catch (_) {
      // fall through
    }

    try {
      await navigator.clipboard.writeText(url);
      alert("공유 링크가 복사되었습니다");
    } catch (_) {
      prompt("아래 링크를 복사해 공유하세요:", url);
    }
  };

  // ---------- Render ----------
  const readingText = (r) => {
    if (!r) return "";
    const range = (r.start === r.end) ? `${r.start}` : `${r.start}–${r.end}`;
    const verse = r.verses ? `:${r.verses}` : "";
    return `${r.book}${range}${verse}`;
  };

  const renderMainCard = (state) => {
    const { DATA, selectedDay, cycle } = state;
    const entry = DATA.plan.find((x) => x.day === selectedDay);

    const p = loadProgress();
    ensureCycle(p, cycle);
    const done = !!p.cycles[String(cycle)].completed[String(selectedDay)];

    const readings = (entry && Array.isArray(entry.readings)) ? entry.readings : [];
    const hasReadings = readings.length > 0;

    qs("#main-card").html(`
      <div class="bg-white rounded-2xl shadow p-5">
        <div class="inline-flex items-center gap-2">
          <span class="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700">${cycle}독</span>
          <span class="text-xs text-gray-500">Day ${selectedDay}</span>
        </div>

        <div class="mt-3 text-[17px] leading-relaxed break-words text-gray-900">
          ${hasReadings ? readings.map(readingText).join(" · ") : "(데이터 준비중)"}
        </div>

        <button id="done-btn"
          class="mt-4 w-full py-3 rounded-xl text-white font-semibold shadow-sm active:scale-[0.99]
          ${done ? "bg-green-600" : "bg-blue-600"}">
          ${done ? "완료됨 ✓ (다시 누르면 해제)" : "읽었어요 :)"}
        </button>
      </div>
    `);

    qs("#done-btn").off("click").on("click", () => {
      const p2 = loadProgress();
      ensureCycle(p2, cycle);
      const key = String(selectedDay);
      const cur = !!p2.cycles[String(cycle)].completed[key];
      p2.cycles[String(cycle)].completed[key] = !cur;
      if (p2.cycles[String(cycle)].startedAt === null) p2.cycles[String(cycle)].startedAt = nowIso();
      saveProgress(p2);
      render(state);
    });
  };

  const renderHeader = (state) => {
    const { DATA, selectedDay, todayDay, cycle } = state;

    const year = new Date().getFullYear();
    const date = dateFromDayOfYear(year, clamp(selectedDay, DAY_MIN, DATA.days));

    qs("#day-badge").text(`${year}년 · ${selectedDay}일차 · ${formatKoreanDate(date)}`);

    // progress
    const p = loadProgress();
    ensureCycle(p, cycle);
    const doneCount = countDone(p.cycles[String(cycle)].completed);
    qs("#progress-count").text(doneCount);
    qs("#progress-total").text(` / ${DATA.days} 완료`);

    // buttons
    qs("#go-home").off("click").on("click", () => window.location.replace("/"));
    qs("#go-today").toggle(selectedDay !== todayDay);
    qs("#go-today").off("click").on("click", () => state.setSelectedDay(todayDay));

    qs("#share-btn").off("click").on("click", () => tryShare(selectedDay));
  };

  const render = (state) => {
    renderHeader(state);
    renderMainCard(state);
  };

  // ---------- Init ----------
  const initPWA = () => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js");
    }
  };

  const initCycleSelect = (state) => {
    const $sel = qs("#cycle-select");
    $sel.empty();
    for (let i = 1; i <= 10; i++) $sel.append(`<option value="${i}">${i}독</option>`);

    const p = loadProgress();
    $sel.val(String(p.activeCycle));

    $sel.off("change").on("change", () => {
      const next = Number($sel.val());
      const p2 = loadProgress();
      ensureCycle(p2, next);
      p2.activeCycle = next;
      if (p2.cycles[String(next)].startedAt === null) p2.cycles[String(next)].startedAt = nowIso();
      saveProgress(p2);
      state.cycle = next;
      render(state);
    });
  };

  (async function init() {
    const res = await fetch("./data.json");
    const DATA = await res.json();

    const todayDay = clamp(dayOfYear(new Date()), DAY_MIN, DATA.days);
    const queryDay = getQueryDay();

    const p = loadProgress();

    const state = {
      DATA,
      todayDay,
      selectedDay: clamp(queryDay ?? todayDay, DAY_MIN, DATA.days),
      cycle: p.activeCycle,
      setSelectedDay: (d) => {
        state.selectedDay = clamp(d, DAY_MIN, DATA.days);
        setQueryDay(state.selectedDay);
        render(state);
      }
    };

    // URL 정규화
    if (queryDay == null) setQueryDay(state.selectedDay);

    // nav
    qs("#prev-btn").off("click").on("click", () => state.setSelectedDay(state.selectedDay - 1));
    qs("#next-btn").off("click").on("click", () => state.setSelectedDay(state.selectedDay + 1));
    qs("#today-btn").off("click").on("click", () => state.setSelectedDay(todayDay));

    initCycleSelect(state);
    render(state);
    initPWA();
  })();
})();
