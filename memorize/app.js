// memorize/app.js — 52주 암송 + 암송모드(TTS: 듣기→텀→반복) / 접힘 UI (REFAC)
// - 토글은 접기/펼치기만 (재생/정지 X)
// - ▶️/⏹ 버튼으로만 재생/정지
// - Google 한국어(가능 시) 디폴트 + 음성 선택 + 속도 프리셋 + 텍스트 정리
// - iPhone 등 Google 음성 없으면 ko-KR/ko 내장 음성으로 자동 fallback
(() => {
  // ======================
  // Constants / Helpers
  // ======================
  const MS_DAY = 1000 * 60 * 60 * 24;
  const WEEK_MIN = 1;
  const WEEK_MAX = 52;

  const OPT_KEY = "memorize:options:v1";
  const TTS_KEY = "memorize:tts:v4";

  const $q = (sel) => $(sel);
  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

  const safeJSON = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
      } catch (_) {
        return fallback;
      }
    },
    write(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
  };

  // ======================
  // Date / Week
  // ======================
  const computeFirstMonday = (year) => {
    // 1/1(포함) 이후 첫 월요일 (월요일이면 그대로)
    const d = new Date(year, 0, 1);
    const day = d.getDay(); // 0=일 ... 1=월
    const offset = (8 - day) % 7;
    d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    return d;
  };

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
    const base = new Date(startDate);
    const s = new Date(base.getTime() + (week - 1) * 7 * MS_DAY);
    const e = new Date(s.getTime() + 6 * MS_DAY);
    return { s, e };
  };

  // ======================
  // Storage (progress/options)
  // ======================
  const doneKey = (year) => `memorized:${year}`;

  const getDoneMap = (year) => safeJSON.read(doneKey(year), {});
  const setDoneMap = (year, map) => safeJSON.write(doneKey(year), map);
  const countDone = (map) => Object.values(map).filter(Boolean).length;

  const getOptions = () => safeJSON.read(OPT_KEY, { autoNextAfterDoneCurrent: false });
  const setOptions = (o) => safeJSON.write(OPT_KEY, o);

  const getTTS = () =>
    safeJSON.read(TTS_KEY, {
      open: false,
      gapSec: 10,
      ratePreset: "normal", // slow | normal | fast
      voiceURI: "",
    });

  const setTTS = (o) => safeJSON.write(TTS_KEY, o);

  // ======================
  // URL
  // ======================
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
    const title = "나의신앙생활 · 주간 암송";

    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url.toString());
        alert("링크를 복사했어요!");
      }
    } catch (_) {}
  };

  // ======================
  // Option logic
  // ======================
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

  // ======================
  // TTS Core
  // ======================
  const ttsRuntime = {
    playing: false,
    timer: null,
  };

  const clearTTSTimer = () => {
    if (ttsRuntime.timer) clearTimeout(ttsRuntime.timer);
    ttsRuntime.timer = null;
  };

  const setTTSStatus = (msg) => {
    $q("#tts-mini-status").text(msg || "");
    $q("#tts-panel-status").text(msg || "");
  };

  const stopTTS = () => {
    ttsRuntime.playing = false;
    clearTTSTimer();
    try {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch (_) {}
    setTTSStatus("");
  };

  const sanitizeForTTS = (text) => {
    if (!text) return "";
    return String(text)
      .replace(/[\r\n]+/g, " ")
      .replace(/[—·•]/g, " ")
      .replace(/[()［］\[\]{}]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  };

  const getRateByPreset = (preset) => {
    if (preset === "slow") return 0.95;
    if (preset === "fast") return 1.05;
    return 1.0;
  };

  const getAllVoices = () => {
    if (!("speechSynthesis" in window)) return [];
    try {
      return window.speechSynthesis.getVoices?.() || [];
    } catch (_) {
      return [];
    }
  };

  const findGoogleKoreanVoice = (voices) => {
    return (
      voices.find((v) => /google/i.test(v.name || "") && /^ko/i.test(v.lang || "")) ||
      voices.find((v) => /google/i.test(v.name || "") && (v.lang || "").toLowerCase() === "ko-kr") ||
      null
    );
  };

  const pickKoreanVoice = (voiceURI) => {
    const voices = getAllVoices();
    if (!voices.length) return null;

    if (voiceURI) {
      const saved = voices.find((v) => v.voiceURI === voiceURI);
      if (saved) return saved;
    }

    const googleKo = findGoogleKoreanVoice(voices);
    if (googleKo) return googleKo;

    return (
      voices.find((v) => (v.lang || "").toLowerCase() === "ko-kr") ||
      voices.find((v) => (v.lang || "").toLowerCase().startsWith("ko")) ||
      null
    );
  };

  const ensureDefaultGoogleVoiceSavedIfAvailable = () => {
    const cfg = getTTS();
    if (cfg.voiceURI) return;

    const voices = getAllVoices();
    if (!voices.length) return;

    const googleKo = findGoogleKoreanVoice(voices);
    if (!googleKo) return;

    setTTS({ ...cfg, voiceURI: googleKo.voiceURI });
  };

  const speakOnce = (text, cfg) => {
    if (!("speechSynthesis" in window)) {
      alert("이 브라우저는 음성 읽기(TTS)를 지원하지 않아요.");
      return null;
    }

    window.speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = getRateByPreset(cfg.ratePreset);

    const v = pickKoreanVoice(cfg.voiceURI);
    if (v) u.voice = v;

    window.speechSynthesis.speak(u);
    return u;
  };

  const startTTS = (state) => {
    const verse = state.DATA.weeks.find((v) => v.week === state.selectedWeek);
    if (!verse) return;

    ensureDefaultGoogleVoiceSavedIfAvailable();

    const cfg = getTTS();
    const text = sanitizeForTTS(verse.text);

    ttsRuntime.playing = true;
    setTTSStatus(`암송: ${cfg.gapSec}초 텀`);

    const u = speakOnce(text, cfg);
    if (!u) {
      stopTTS();
      return;
    }

    u.onend = () => {
      if (!ttsRuntime.playing) return;

      const cur = getTTS();
      const gapMs = clamp(Number(cur.gapSec) || 10, 1, 999) * 1000;

      clearTTSTimer();
      ttsRuntime.timer = setTimeout(() => {
        if (!ttsRuntime.playing) return;
        startTTS(state);
      }, gapMs);
    };

    u.onerror = () => stopTTS();
  };

  // ======================
  // Render
  // ======================
  const updateNavButtons = (state) => {
    const w = state.selectedWeek;
    $q("#prev-btn").toggleClass("invisible pointer-events-none", w <= WEEK_MIN);
    $q("#next-btn").toggleClass("invisible pointer-events-none", w >= WEEK_MAX);
  };

  const renderHeader = (state) => {
    const doneMap = getDoneMap(state.activeYear);
    const { s, e } = weekRange(state.startDate, state.selectedWeek);

    $q("#week-badge").text(
      `${state.activeYear}년 · ${state.selectedWeek}주 · ${fmtKOR(s)} ~ ${fmtKOR(e)}`
    );
    $q("#progress").text(`진행률: ${countDone(doneMap)}/${WEEK_MAX}`);
  };

  const renderOptions = () => {
    const opt = getOptions();
    $q("#auto-next-toggle").prop("checked", !!opt.autoNextAfterDoneCurrent);
  };

  const renderMainCard = (state) => {
    const verse = state.DATA.weeks.find((v) => v.week === state.selectedWeek);
    if (!verse) return $q("#main-card").empty();

    const doneMap = getDoneMap(state.activeYear);
    const done = !!doneMap[String(state.selectedWeek)];
    const isCurrent = state.selectedWeek === state.currentWeek;

    $q("#main-card").html(`
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow p-5
                  border border-gray-100 dark:border-gray-700">
        <div class="inline-flex items-center gap-2">
          <span class="text-xs px-2 py-1 rounded-full
            ${isCurrent
              ? "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-100"
              : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-200"
            }">
            ${isCurrent ? "이번 주" : "미리보기"}
          </span>
          <span class="text-xs text-gray-500 dark:text-gray-300">${state.selectedWeek}주</span>
        </div>

        <div class="mt-3 text-[17px] leading-relaxed break-words text-gray-900 dark:text-gray-100">
          ${verse.text}
        </div>

        <div class="mt-3 text-sm text-gray-500 dark:text-gray-300">— ${verse.ref}</div>

        <button id="done-btn"
          class="mt-4 w-full py-3 rounded-xl text-white font-semibold shadow-sm active:scale-[0.99]
          ${done ? "bg-green-600" : "bg-blue-600"}">
          ${done ? "완료됨 ✓ (다시 누르면 해제)" : "암송했어요 :)"}
        </button>
      </div>
    `);

    $q("#done-btn")
      .off("click")
      .on("click", () => {
        stopTTS();

        const beforeCount = countDone(doneMap);
        const nowDone = !done;

        const nextMap = { ...doneMap, [String(state.selectedWeek)]: nowDone };
        const afterCount = countDone(nextMap);

        setDoneMap(state.activeYear, nextMap);

        if (nowDone && afterCount > beforeCount) {
          if (afterCount >= WEEK_MAX) window.SiteFX?.burstBig?.();
          else window.SiteFX?.burstSmall?.();
        }

        renderAll(state);
      });
  };


  const renderTTS = (state) => {
    ensureDefaultGoogleVoiceSavedIfAvailable();

    const cfg = getTTS();

    const allVoices = getAllVoices();
    const koVoices = allVoices.filter((v) => (v.lang || "").toLowerCase().startsWith("ko"));
    const gapOptions = [5, 10, 20, 30];

  $q("#tts-area").html(`
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow p-4
                border border-gray-100 dark:border-gray-700">
      <button id="tts-toggle"
        class="w-full flex items-center justify-between gap-3 rounded-xl
              border border-gray-200 dark:border-gray-700
              bg-white/60 dark:bg-gray-900/40
              px-4 py-3 active:scale-[0.99]">
        <div class="flex items-center gap-2">
          <span class="text-base">🎧</span>
          <span class="font-semibold text-gray-900 dark:text-gray-100">암송듣기</span>
          <span id="tts-mini-status" class="text-xs text-gray-500 dark:text-gray-300"></span>
        </div>
        <span class="text-sm text-gray-500 dark:text-gray-300">${cfg.open ? "▲" : "▼"}</span>
      </button>

      <div id="tts-panel" class="${cfg.open ? "" : "hidden"} mt-3">
        <div class="text-xs text-gray-500 dark:text-gray-300 mb-2">
          말씀을 1회 듣고, 암송할 시간을 둔 뒤 다시 들려줘요
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="text-xs text-gray-500 dark:text-gray-300 mr-1">텀(초):</div>
          ${gapOptions.map((sec) => `
            <label class="inline-flex items-center gap-1 px-2 py-1 rounded-lg
                          border border-gray-200 dark:border-gray-700
                          bg-white dark:bg-gray-900/40
                          text-sm text-gray-800 dark:text-gray-100">
              <input type="radio" name="gap-sec" value="${sec}" ${Number(cfg.gapSec) === sec ? "checked" : ""}>
              <span>${sec}</span>
            </label>
          `).join("")}
        </div>

        <div class="mt-3">
          <div class="text-xs text-gray-500 dark:text-gray-300 mb-1">속도</div>
          <div class="grid grid-cols-3 gap-2">
            <button data-rate="slow"
              class="rate-btn rounded-xl border border-gray-200 dark:border-gray-700 py-2 text-sm font-semibold
                ${cfg.ratePreset === "slow"
                  ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-100 dark:border-blue-800"
                  : "bg-white dark:bg-gray-900/40 text-gray-800 dark:text-gray-100"
                }">느림</button>

            <button data-rate="normal"
              class="rate-btn rounded-xl border border-gray-200 dark:border-gray-700 py-2 text-sm font-semibold
                ${cfg.ratePreset === "normal"
                  ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-100 dark:border-blue-800"
                  : "bg-white dark:bg-gray-900/40 text-gray-800 dark:text-gray-100"
                }">보통</button>

            <button data-rate="fast"
              class="rate-btn rounded-xl border border-gray-200 dark:border-gray-700 py-2 text-sm font-semibold
                ${cfg.ratePreset === "fast"
                  ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-100 dark:border-blue-800"
                  : "bg-white dark:bg-gray-900/40 text-gray-800 dark:text-gray-100"
                }">빠름</button>
          </div>
        </div>

        ${koVoices.length ? `
          <div class="mt-3 hidden">
            <div class="text-xs text-gray-500 dark:text-gray-300 mb-1">음성</div>
            <select id="tts-voice"
              class="w-full rounded-xl border border-gray-200 dark:border-gray-700
                    bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100">
              <option value="">자동(가능하면 Google)</option>
              ${koVoices.map((v) => `
                <option value="${v.voiceURI}" ${cfg.voiceURI === v.voiceURI ? "selected" : ""}>
                  ${(v.name || "Korean Voice")} (${v.lang})
                </option>
              `).join("")}
            </select>
            <div class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              * 기기/OS에 따라 Google 음성이 없을 수 있어요(iPhone 등)
            </div>
          </div>
        ` : ``}

        <div class="mt-3 grid grid-cols-2 gap-2">
          <button id="tts-play" class="rounded-xl bg-blue-600 text-white py-3 font-semibold shadow-sm active:scale-[0.99]">
            ▶ 시작
          </button>
          <button id="tts-stop"
            class="rounded-xl border border-gray-200 dark:border-gray-700
                  bg-white dark:bg-gray-900/40
                  text-gray-800 dark:text-gray-100
                  py-3 font-semibold active:scale-[0.99]">
            ■ 정지
          </button>
        </div>

        <div id="tts-panel-status" class="mt-2 text-xs text-gray-500 dark:text-gray-300"></div>
      </div>
    </div>
  `);

    // Events (TTS area only)
    $q("#tts-toggle")
      .off("click")
      .on("click", () => {
        const cur = getTTS();
        setTTS({ ...cur, open: !cur.open }); // UI만 토글
        renderTTS(state);
      });

    $q('input[name="gap-sec"]')
      .off("change")
      .on("change", function () {
        const v = parseInt(this.value, 10);
        const cur = getTTS();
        setTTS({ ...cur, gapSec: clamp(v || 10, 1, 999) });
        // 상태 표시만 즉시 반영
        const now = getTTS();
        if (ttsRuntime.playing) setTTSStatus(`암송: ${now.gapSec}초 텀`);
      });

    $q(".rate-btn")
      .off("click")
      .on("click", function () {
        const preset = $(this).data("rate");
        const cur = getTTS();
        setTTS({ ...cur, ratePreset: preset });
        renderTTS(state);
      });

    $q("#tts-voice")
      .off("change")
      .on("change", function () {
        const cur = getTTS();
        setTTS({ ...cur, voiceURI: this.value || "" });
      });

    $q("#tts-play")
      .off("click")
      .on("click", () => {
        stopTTS();
        startTTS(state);
      });

    $q("#tts-stop").off("click").on("click", () => stopTTS());

    // 상태 반영
    if (ttsRuntime.playing) setTTSStatus(`암송: ${cfg.gapSec}초 텀`);
    else setTTSStatus("");
  };

  const renderAll = (state) => {
    renderHeader(state);
    renderOptions();
    renderMainCard(state);
    renderTTS(state);
    updateNavButtons(state);
  };

  // ======================
  // Bind events
  // ======================
  const bindStaticEvents = (state) => {
    $q("#go-home").off("click").on("click", () => {
      stopTTS();
      window.location.replace("/");
    });

    $q("#share-btn").off("click").on("click", () => tryShare(state.selectedWeek));

    $q("#prev-btn").off("click").on("click", () => state.setSelectedWeek(state.selectedWeek - 1));
    $q("#next-btn").off("click").on("click", () => state.setSelectedWeek(state.selectedWeek + 1));
    $q("#go-current").off("click").on("click", () => state.setSelectedWeek(state.currentWeek));

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopTTS();
    });

    window.addEventListener("beforeunload", () => stopTTS());
  };

  const bindOptionEvents = () => {
    $q("#auto-next-toggle")
      .off("change")
      .on("change", function () {
        const cur = getOptions();
        setOptions({ ...cur, autoNextAfterDoneCurrent: this.checked });
      });
  };

  // ======================
  // Init
  // ======================
  (async function init() {
    const res = await fetch("./data.json", { cache: "no-store" });
    const DATA = await res.json();

    // 연도 자동 매핑
    const activeYear = new Date().getFullYear();
    const startDate = computeFirstMonday(activeYear);

    // voices 준비(일부 브라우저 비동기)
    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => {
          ensureDefaultGoogleVoiceSavedIfAvailable();
          if (window.__memorize_state__) renderTTS(window.__memorize_state__);
        };
      } catch (_) {}
    }

    const currentWeek = getWeekIndex(startDate);
    const queryWeek = getQueryWeek();
    const opt = getOptions();

    let initialWeek = queryWeek ?? currentWeek;

    if (queryWeek == null && opt.autoNextAfterDoneCurrent) {
      const doneMap = getDoneMap(activeYear);
      if (!!doneMap[String(currentWeek)]) {
        initialWeek = findNextUndoneWeek(activeYear, currentWeek);
      }
    }

    const state = {
      DATA,
      activeYear,
      startDate,
      currentWeek,
      selectedWeek: clamp(initialWeek, WEEK_MIN, WEEK_MAX),

      setSelectedWeek: (w) => {
        stopTTS();
        state.selectedWeek = clamp(w, WEEK_MIN, WEEK_MAX);
        setQueryWeek(state.selectedWeek);
        renderAll(state);
      },
    };

    window.__memorize_state__ = state;

    if (queryWeek == null) setQueryWeek(state.selectedWeek);

    bindStaticEvents(state);
    bindOptionEvents();

    // 초기 1회: voices가 이미 준비된 경우 Google 디폴트 저장
    ensureDefaultGoogleVoiceSavedIfAvailable();

    renderAll(state);

    // voices 늦게 로드되는 경우를 대비해 1회 추가 렌더
    setTimeout(() => renderTTS(state), 300);
  })();
})();
