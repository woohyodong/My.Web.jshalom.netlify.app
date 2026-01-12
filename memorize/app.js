// app.js (refactored) — Home + Share(?week=23) + stable render
(() => {
  const MS_DAY = 1000 * 60 * 60 * 24;
  const WEEK_MIN = 1;
  const WEEK_MAX = 52;

  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

  const qs = (sel) => $(sel);

  const getWeekIndex = (startDate) => {
    const start = new Date(startDate);
    const today = new Date();
    const diffDays = Math.floor((today - start) / MS_DAY);
    const week = Math.floor(diffDays / 7) + 1;
    return clamp(week, WEEK_MIN, WEEK_MAX);
  };

  const storageKey = (year) => `memorized:${year}`;

  const getDoneMap = (year) =>
    JSON.parse(localStorage.getItem(storageKey(year)) || "{}");

  const setDoneMap = (year, map) =>
    localStorage.setItem(storageKey(year), JSON.stringify(map));

  const countDone = (map) => Object.values(map).filter(Boolean).length;

  const getQueryWeek = () => {
    const params = new URLSearchParams(window.location.search);
    const w = parseInt(params.get("week"), 10);
    return Number.isFinite(w) ? clamp(w, WEEK_MIN, WEEK_MAX) : null;
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
    } catch (_) {
      // fall through to clipboard
    }

    try {
      await navigator.clipboard.writeText(url);
      alert("공유 링크가 복사되었습니다");
    } catch (_) {
      // last resort
      prompt("아래 링크를 복사해 공유하세요:", url);
    }
  };

  // ---------- UI RENDERERS ----------
  const renderMainCard = (state) => {
    const { DATA, selectedWeek, currentWeek } = state;
    const verse = DATA.weeks.find((v) => v.week === selectedWeek);
    if (!verse) return qs("#main-card").empty();

    const doneMap = getDoneMap(DATA.year);
    const done = !!doneMap[selectedWeek];
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

    qs("#done-btn")
      .off("click")
      .on("click", () => {
        const next = { ...doneMap, [selectedWeek]: !done };
        setDoneMap(DATA.year, next);
        render(state); // re-render with same state
      });
  };

  const renderPreviewCard = (state, week, targetId, label) => {
    const { DATA } = state;
    const verse = DATA.weeks.find((v) => v.week === week);
    if (!verse) return qs(targetId).empty();

    // ref-only (fixed height)
    qs(targetId).html(`
      <button class="w-full text-left bg-white rounded-2xl shadow p-3 flex flex-col justify-between
        hover:shadow-md active:scale-[0.99]">
        <div class="text-xs text-gray-500">${label} <span class="text-sm font-semibold text-gray-900">(${week}주)</span></div>
        <div class="text text-gray-500 mt-1 truncate">${verse.ref}</div>
      </button>
    `);

    qs(targetId)
      .off("click")
      .on("click", () => {
        state.setSelectedWeek(week);
      });
  };

  const renderHeader = (state) => {
    const { DATA, selectedWeek, currentWeek } = state;
    const doneMap = getDoneMap(DATA.year);

    qs("#week-badge").text(`${DATA.year}년 · ${selectedWeek}주`);
    qs("#progress").text(`진행률: ${countDone(doneMap)}/${WEEK_MAX}`);

    // "이번 주로" 버튼(기존) + 홈/공유 버튼(추가된 경우도 지원)
    qs("#go-current").toggle(selectedWeek !== currentWeek);

    // 홈 버튼(있으면)
    qs("#go-home")
      .off("click")
      .on("click", () => {
        window.location.replace("/");
      });

    // 공유 버튼(있으면)
    qs("#share-btn")
      .off("click")
      .on("click", () => tryShare(selectedWeek));

    // "이번 주로"(있으면)
    qs("#go-current")
      .off("click")
      .on("click", () => state.setSelectedWeek(currentWeek));
  };

  const render = (state) => {
    renderHeader(state);
    renderMainCard(state);
    renderPreviewCard(state, state.selectedWeek - 1, "#prev-card", "이전");
    renderPreviewCard(state, state.selectedWeek + 1, "#next-card", "다음");
  };

  // ---------- INIT ----------
  const initPWA = () => {
    if ("serviceWorker" in navigator) {
      // 루트/서브폴더 모두 안전: 같은 폴더의 sw.js 기준
      navigator.serviceWorker.register("/sw.js");
    }
  };

  (async function init() {
    const res = await fetch("./data.json");
    const DATA = await res.json();

    const currentWeek = getWeekIndex(DATA.startDate);
    const queryWeek = getQueryWeek();

    const state = {
      DATA,
      currentWeek,
      selectedWeek: queryWeek ?? currentWeek,
      setSelectedWeek: (w) => {
        state.selectedWeek = clamp(w, WEEK_MIN, WEEK_MAX);

        // URL도 함께 업데이트(공유/뒤로가기 UX 좋게)
        const url = new URL(window.location.href);
        url.searchParams.set("week", String(state.selectedWeek));
        window.history.replaceState({}, "", url);

        render(state);
      }
    };

    // 첫 렌더 전에 URL 정규화
    if (queryWeek == null) {
      const url = new URL(window.location.href);
      url.searchParams.set("week", String(state.selectedWeek));
      window.history.replaceState({}, "", url);
    }

    render(state);
    initPWA();
  })();
})();
