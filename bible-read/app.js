// bible-read/app.js — 365일 통독
// data.json(권장): [{ day, date:"MM-DD", month, dayOfMonth, readings:[string...] }, ...]
// 공유: ?day=123
(() => {
  const DAY_MIN = 1;

  const qs = (sel) => $(sel);
  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

  // ---------- Storage ----------
  const STORAGE_KEY = "bibleRead:progress:v2";
  const OPT_KEY = "bibleRead:options:v1";

  const nowIso = () => new Date().toISOString();

  const loadProgress = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}

    const init = {
      activeCycle: 1,
      cycles: { "1": { completed: {}, startedAt: nowIso(), finishedAt: null } }
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

  const loadOptions = () => {
    try {
      const raw = localStorage.getItem(OPT_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    const init = { autoNextAfterDoneToday: false };
    localStorage.setItem(OPT_KEY, JSON.stringify(init));
    return init;
  };

  const saveOptions = (o) => localStorage.setItem(OPT_KEY, JSON.stringify(o));

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
    } catch (_) {}

    try {
      await navigator.clipboard.writeText(url);
      alert("공유 링크가 복사되었습니다");
    } catch (_) {
      prompt("아래 링크를 복사해 공유하세요:", url);
    }
  };

  // ---------- Date/Plan helpers ----------
  const formatKoreanDate = (y, mmdd) => {
    const [mm, dd] = (mmdd || "").split("-").map((x) => parseInt(x, 10));
    if (!mm || !dd) return `${y}년`;

    const d = new Date(y, mm - 1, dd);
    const w = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    const m2 = String(mm).padStart(2, "0");
    const d2 = String(dd).padStart(2, "0");
    return `${y}.${m2}.${d2} (${w})`;
  };

  // 오늘 날짜(월/일)로 plan에서 day 찾기 (윤년 2/29는 plan이 없으니 2/28로 처리)
  const getTodayDayFromPlan = (plan) => {
    const t = new Date();
    const m = t.getMonth() + 1;
    const d = t.getDate();

    if (m === 2 && d === 29) {
      const feb28 = plan.find((x) => x.month === 2 && x.dayOfMonth === 28);
      return feb28 ? feb28.day : 59;
    }

    const hit = plan.find((x) => x.month === m && x.dayOfMonth === d);
    return hit ? hit.day : 1;
  };

  // ---------- Data normalize ----------
  const normalizePlan = (raw) => {
    if (!Array.isArray(raw)) return [];

    const splitTokens = (v) => {
      return String(v)
        .replace(/[·]/g, " ")
        .replace(/[,/]/g, " ")
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    };

    return raw.map((row, idx) => {
      const day = Number(row?.day) || (idx + 1);

      let readings = [];

      if (Array.isArray(row?.readings)) {
        readings = row.readings.flatMap((x) => splitTokens(x));
      } else if (typeof row?.readings === "string") {
        readings = splitTokens(row.readings);
      } else if (typeof row?.reading === "string") {
        readings = splitTokens(row.reading);
      } else if (typeof row?.content === "string") {
        readings = splitTokens(row.content);
      } else if (typeof row?.text === "string") {
        readings = splitTokens(row.text);
      }

      readings = readings.map((s) => String(s).trim()).filter(Boolean);

      let date = row?.date;
      let month = row?.month;
      let dayOfMonth = row?.dayOfMonth;

      if (typeof date === "string" && date.includes("-")) {
        const [mm, dd] = date.split("-").map((x) => parseInt(x, 10));
        if (!Number.isFinite(month)) month = mm;
        if (!Number.isFinite(dayOfMonth)) dayOfMonth = dd;
      }

      return { ...row, day, date, month, dayOfMonth, readings };
    });
  };

  const renderFatal = (msg, extra = "") => {
    qs("#main-card").html(`
      <div class="bg-white rounded-2xl shadow p-5">
        <div class="text-red-600 font-extrabold">데이터 로딩 오류</div>
        <div class="mt-2 text-gray-800 font-semibold">${msg}</div>
        ${extra ? `<div class="mt-3 text-sm text-gray-500">${extra}</div>` : ""}
      </div>
    `);
  };

  // ---------- Option logic ----------
  const findNextUndoneDay = (progress, cycle, startDay, days) => {
    const c = String(cycle);
    const doneMap = progress?.cycles?.[c]?.completed || {};

    for (let d = startDay + 1; d <= days; d++) {
      if (!doneMap[String(d)]) return d;
    }
    for (let d = 1; d <= startDay; d++) {
      if (!doneMap[String(d)]) return d;
    }
    return startDay;
  };

  // ---------- Render ----------
  const renderMainCard = (state) => {
    const { PLAN, selectedDay, cycle, days } = state;
    const entry = PLAN[selectedDay - 1];

    const p = loadProgress();
    ensureCycle(p, cycle);
    const done = !!p.cycles[String(cycle)].completed[String(selectedDay)];

    const readings = entry?.readings ?? [];
    const hasReadings = Array.isArray(readings) && readings.length > 0;

    qs("#main-card").html(`
      <div class="bg-white rounded-2xl shadow p-5">
        <div class="inline-flex items-center gap-2">
          <span class="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700">${cycle}독</span>
          <span class="text-xs text-gray-500">Day ${selectedDay} / ${days}</span>
        </div>

        <div class="mt-3 text-[17px] leading-relaxed break-words text-gray-900">
          ${hasReadings ? readings.join(" · ") : "(데이터 준비중)"}
        </div>

        <button id="done-btn"
          class="mt-4 w-full py-3 rounded-xl text-white font-semibold shadow-sm active:scale-[0.99]
          ${done ? "bg-green-600" : "bg-blue-600"}">
          ${done ? "완료됨 ✓ (다시 누르면 해제)" : "읽었어요 :)"}
        </button>

        <!-- 문제가 계속되면 이 줄로 확인 가능 -->
        <div class="mt-3 text-[11px] text-gray-400 break-all hidden">
          day=${selectedDay} · readings=${Array.isArray(readings) ? readings.length : "NA"}
        </div>
      </div>
    `);

    qs("#done-btn").off("click").on("click", () => {
      const p2 = loadProgress();
      ensureCycle(p2, cycle);

      const key = String(selectedDay);
      p2.cycles[String(cycle)].completed[key] = !p2.cycles[String(cycle)].completed[key];

      if (p2.cycles[String(cycle)].startedAt === null) p2.cycles[String(cycle)].startedAt = nowIso();
      saveProgress(p2);

      render(state);
    });
  };

  const renderHeader = (state) => {
    const { PLAN, selectedDay, todayDay, cycle, days } = state;

    const year = new Date().getFullYear();
    const entry = PLAN[selectedDay - 1];
    const badge = entry?.date
      ? `${year}년 · ${selectedDay}일차 · ${formatKoreanDate(year, entry.date)}`
      : `${year}년 · ${selectedDay}일차`;

    qs("#day-badge").text(badge);

    const p = loadProgress();
    ensureCycle(p, cycle);
    const doneCount = countDone(p.cycles[String(cycle)].completed);
    qs("#progress-count").text(doneCount);
    qs("#progress-total").text(` / ${days} 완료`);

    qs("#go-home").off("click").on("click", () => window.location.replace("/"));
    qs("#share-btn").off("click").on("click", () => tryShare(selectedDay));
  };

  const render = (state) => {
    renderHeader(state);
    renderMainCard(state);
  };

  // ---------- Init ----------
  const initPWA = () => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
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
    try {
      // ✅ base href + 슬래시 보정이 있어도, 가장 안전하게 절대경로로 고정
      // (여기가 꼬이면 (데이터 준비중) 계속 뜸)
      const res = await fetch("/bible-read/data.json", { cache: "no-store" });

      if (!res.ok) {
        renderFatal(`data.json 로딩 실패 (${res.status})`, "https://도메인/bible-read/data.json 이 직접 열리는지 확인하세요.");
        return;
      }

      const RAW = await res.json();
      const PLAN = normalizePlan(RAW);

      if (!Array.isArray(PLAN) || PLAN.length === 0) {
        renderFatal("data.json이 배열이 아니거나 비어있습니다.", "data.json 최상단이 [ ... ] 형태인지 확인하세요.");
        return;
      }

      const days = PLAN.length;
      const todayDay = clamp(getTodayDayFromPlan(PLAN), DAY_MIN, days);

      const queryDay = getQueryDay();
      const p = loadProgress();
      const opt = loadOptions();
      ensureCycle(p, p.activeCycle);

      // 초기 선택 day 결정
      let initialDay = clamp(queryDay ?? todayDay, DAY_MIN, days);

      // ✅ 옵션 ON + 쿼리없음 + 오늘 완료면 → 다음 미완료로 이동
      if (queryDay == null && opt.autoNextAfterDoneToday) {
        const doneToday = !!p.cycles[String(p.activeCycle)]?.completed?.[String(todayDay)];
        if (doneToday) initialDay = findNextUndoneDay(p, p.activeCycle, todayDay, days);
      }

      const state = {
        PLAN,
        days,
        todayDay,
        selectedDay: initialDay,
        cycle: p.activeCycle,
        setSelectedDay: (d) => {
          state.selectedDay = clamp(d, DAY_MIN, days);
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

      // 옵션 스위치
      $("#auto-next-toggle").prop("checked", !!opt.autoNextAfterDoneToday);
      $("#auto-next-toggle").off("change").on("change", function () {
        const nextOpt = { ...loadOptions(), autoNextAfterDoneToday: this.checked };
        saveOptions(nextOpt);
      });

      initCycleSelect(state);
      render(state);
      initPWA();

      // 콘솔 디버그
      console.log("[bible-read] data.json loaded:", { len: RAW?.length, first: RAW?.[0] });
      console.log("[bible-read] normalized first:", PLAN[0]);
    } catch (e) {
      renderFatal("예상치 못한 오류", String(e?.message || e));
      console.error(e);
    }
  })();
})();
