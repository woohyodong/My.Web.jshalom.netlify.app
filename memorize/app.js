// memorize/app.js — 52주 암송 (UI 통일: 하단 3버튼 + 옵션 스위치)
// 공유: ?week=23
(() => {
  const MS_DAY = 1000 * 60 * 60 * 24;
  const WEEK_MIN = 1;
  const WEEK_MAX = 52;
  const OPT_KEY = "memorize:options:v1";

  const qs = (sel) => $(sel);
  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

  // ---------- Date / Week ----------
  const getWeekIndex = (startDate) => {
    const start = new Date(startDate);
    const today = new Date();
    const diffDays = Math.floor((today - start) / MS_DAY);
    return clamp(Math.floor(diffDays / 7) + 1, WEEK_MIN, WEEK_MAX);
  };

  const fmtKOR = (d) => {
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}.${m}.${da} (${days[d.getDay()]})`;
  };

  const weekRange = (startDate, week) => {
    const base = new Date(startDate); // 1주 시작일
    const s = new Date(base.getTime() + (week - 1) * 7 * MS_DAY);
    const e = new Date(s.getTime() + 6 * MS_DAY);
    return { s, e };
  };

  // ---------- Storage ----------
  const doneKey = (year) => `memorized:${year}`;

  const getDoneMap = (year) =>
    JSON.parse(localStorage.getItem(doneKey(year)) || "{}");

  const setDoneMap = (year, map) =>
    localStorage.setItem(doneKey(year), JSON.stringify(map));

  const countDone = (map) => Object.values(map).filter(Boolean).length;

  const loadOptions = () => {
    try {
      const raw = localStorage.getItem(OPT_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    const init = { autoNextAfterDoneCurrent: false };
    localStorage.setItem(OPT_KEY, JSON.stringify(init));
    return init;
  };

  const saveOptions = (o) => localStorage.setItem(OPT_KEY, JSON.stringify(o));

  // ---------- URL helpers ----------
  const getQueryWeek = () => {
    const params = new URLSearchParams(window.location.search);
    const w = parseInt(params.get("week"), 10);
    return Number.isFinite(w) ? clamp(w, WEEK_MIN, WEEK_MAX) : null;
  };

  const setQueryWeek = (week) => {
    const url = new URL(window.location.href);
    url.searchParams.set("week", String(week));
    window.history.replaceState({}, "", url);
  };

  const buildShareUrl = (week) => {
    const url = new URL(window.location.href);
    url.searchParams.set("week", String(week));
    return url.toString();
  };

  const tryShare = async (week) => {
    const url = buildShareUrl(week);
    const title = "주평강교회 · 주간 암송";

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

  // ---------- Option logic ----------
  const findNextUndoneWeek = (year, startWeek) => {
    const doneMap = getDoneMap(year);

    for (let w = startWeek + 1; w <= WEEK_MAX; w++) {
      if (!doneMap[String(w)]) return w;
    }
    for (let w = WEEK_MIN; w <= startWeek; w++) {
      if (!doneMap[String(w)]) return w;
    }
    return startWeek;
  };

  // ---------- UI ----------
  const bindStaticEvents = (state) => {
    qs("#go-home").off("click").on("click", () => window.location.replace("/"));

    qs("#share-btn")
      .off("click")
      .on("click", () => tryShare(state.selectedWeek));

    qs("#prev-btn")
      .off("click")
      .on("click", () => state.setSelectedWeek(state.selectedWeek - 1));

    qs("#next-btn")
      .off("click")
      .on("click", () => state.setSelectedWeek(state.selectedWeek + 1));

    qs("#go-current")
      .off("click")
      .on("click", () => state.setSelectedWeek(state.currentWeek));
  };

  const bindOptionEvents = () => {
    qs("#auto-next-toggle")
      .off("change")
      .on("change", function () {
        const cur = loadOptions();
        saveOptions({ ...cur, autoNextAfterDoneCurrent: this.checked });
      });
  };

  const renderHeader = (state) => {
    const { DATA, selectedWeek } = state;
    const doneMap = getDoneMap(DATA.year);

    const { s, e } = weekRange(DATA.startDate, selectedWeek);
    qs("#week-badge").text(
      `${DATA.year}년 · ${selectedWeek}주 · ${fmtKOR(s)} ~ ${fmtKOR(e)}`
    );

    qs("#progress").text(`진행률: ${countDone(doneMap)}/${WEEK_MAX}`);
  };

  const renderMainCard = (state) => {
    const { DATA, selectedWeek, currentWeek } = state;
    const verse = DATA.weeks.find((v) => v.week === selectedWeek);
    if (!verse) return qs("#main-card").empty();

    const doneMap = getDoneMap(DATA.year);
    const done = !!doneMap[String(selectedWeek)];
    const isCurrent = selectedWeek === currentWeek;

    qs("#main-card").html(`
      <div class="bg-white rounded-2xl shadow p-5">
        <div class="inline-flex items-center gap-2">
          <span class="text-xs px-2 py-1 rounded-full ${
            isCurrent ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"
          }">
            ${isCurrent ? "이번 주" : "미리보기"}
          </span>
          <span class="text-xs text-gray-500">${selectedWeek}주</span>
        </div>

        <div class="mt-3 text-[17px] leading-relaxed break-words text-gray-900">
          ${verse.text}
        </div>
        <div class="mt-3 text-sm text-gray-500">— ${verse.ref}</div>

        <button id="done-btn"
          class="mt-4 w-full py-3 rounded-xl text-white font-semibold shadow-sm active:scale-[0.99]
          ${done ? "bg-green-600" : "bg-blue-600"}">
          ${done ? "완료됨 ✓ (다시 누르면 해제)" : "암송했어요 :)"}
        </button>
      </div>
    `);

    qs("#done-btn").off("click").on("click", () => {
      const next = { ...doneMap, [String(selectedWeek)]: !done };
      setDoneMap(DATA.year, next);
      render(state);
    });
  };

  const renderOptions = () => {
    const opt = loadOptions();
    qs("#auto-next-toggle").prop("checked", !!opt.autoNextAfterDoneCurrent);
  };

  const render = (state) => {
    renderHeader(state);
    renderOptions();
    renderMainCard(state);
  };

  // ---------- INIT ----------
  const initPWA = () => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
  };

  (async function init() {
    const res = await fetch("./data.json", { cache: "no-store" });
    const DATA = await res.json();

    const currentWeek = getWeekIndex(DATA.startDate);
    const queryWeek = getQueryWeek();
    const opt = loadOptions();

    let initialWeek = queryWeek ?? currentWeek;

    // ✅ 옵션 ON + 쿼리없음 + 이번 주 완료면 → 다음 미완료로 이동
    if (queryWeek == null && opt.autoNextAfterDoneCurrent) {
      const doneMap = getDoneMap(DATA.year);
      if (!!doneMap[String(currentWeek)]) {
        initialWeek = findNextUndoneWeek(DATA.year, currentWeek);
      }
    }

    const state = {
      DATA,
      currentWeek,
      selectedWeek: clamp(initialWeek, WEEK_MIN, WEEK_MAX),
      setSelectedWeek: (w) => {
        state.selectedWeek = clamp(w, WEEK_MIN, WEEK_MAX);
        setQueryWeek(state.selectedWeek);
        render(state);
      }
    };

    // URL 정규화
    if (queryWeek == null) setQueryWeek(state.selectedWeek);

    bindStaticEvents(state);
    bindOptionEvents();

    render(state);
    initPWA();
  })();
})();
