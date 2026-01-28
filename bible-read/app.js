(() => {
  // =========================================================
  // 0) Core Utils / Constants
  // =========================================================
  let currentBibleCtx = null;
  const DAY_MIN = 1;

  const qs = (sel) => $(sel);
  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
  const nowIso = () => new Date().toISOString();

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

  // HTML escape helpers
  const escapeHTML = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const escapeAttr = (s) => escapeHTML(s).replaceAll("`", "&#96;");

  // =========================================================
  // 1) GOODTV Bible MP3 (공식 음원)
  // =========================================================
  const GOODTV_AUDIO_BASE =
    "https://online.goodtv.co.kr/online_bible/goodtvbible/Revision";
  const pad3 = (n) => String(n).padStart(3, "0");

  const buildGoodTvBibleAudioUrl = (bookNum, chapter) => {
    if (!Number.isFinite(bookNum) || !Number.isFinite(chapter)) return null;
    return `${GOODTV_AUDIO_BASE}/${bookNum}/${pad3(chapter)}.mp3`;
  };

  // =========================================================
  // 2) GOODTV Audio Panel - 자체 컨트롤
  // =========================================================
  const BIBLE_AUDIO_KEY = "bibleRead:audio:v1";

  const getAUDIO = () =>
    safeJSON.read(BIBLE_AUDIO_KEY, {
      open: false,
    });

  const setAUDIO = (o) => safeJSON.write(BIBLE_AUDIO_KEY, o);

  const goodtvAudio = {
    el: null,
    playing: false,
    lastUrl: null, // 마지막으로 로드한 음원 URL (패널 토글로 재로딩 방지)
  };

  const ensureGoodtvAudio = () => {
    if (goodtvAudio.el) return goodtvAudio.el;
    const a = new Audio();
    a.preload = "none";
    goodtvAudio.el = a;
    return a;
  };

  const fmtTime = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const setGoodtvPanelText = (title, sub) => {
    qs("#goodtv-audio-title").text(title || "GOOD TV 원음");
    qs("#goodtv-audio-sub").text(sub || "");
  };

  const formatGoodtvRef = async (ctx) => {
    try {
      const idx = await loadBibleDb();
      const long = idx.bookToLong.get(ctx.bookNum) || `${ctx.bookNum}권`;
      const short = idx.bookToShort?.get(ctx.bookNum) || long.slice(0, 1);

      // 작은 화면에서는 "창2" 처럼 짧게
      const useShort =
        window.matchMedia &&
        window.matchMedia("(max-width: 380px)").matches;

      return useShort ? `${short}${ctx.chapter}` : `${long} ${ctx.chapter}장`;
    } catch (_) {
      // DB 로드 실패 시 최소 표기
      return `${ctx.bookNum}권 ${ctx.chapter}장`;
    }
  };

  const setGoodtvPlayBtn = (playing) => {
    qs("#goodtv-play").text(playing ? "❚❚" : "▶");
  };

  const stopGoodtvAudio = () => {
    const a = ensureGoodtvAudio();
    try {
      a.pause();
      a.currentTime = 0;
    } catch (_) {}
    goodtvAudio.playing = false;
    setGoodtvPlayBtn(false);
    qs("#goodtv-seek").val(0);
    qs("#goodtv-time").text("0:00");
    qs("#goodtv-duration").text("0:00");
  };

  // =========================================================
  // 2.1) "패널은 유지, 상태만 초기화" (Day 변경 / 구절 변경 공통)
  // =========================================================
  const resetGoodtvStateKeepPanel = () => {
    // ✅ 패널 hidden 토글은 건드리지 않음
    try {
      stopGoodtvDayQueue();
    } catch (_) {}
    try {
      stopGoodtvAudio();
    } catch (_) {}

    const a = ensureGoodtvAudio();
    try {
      a.removeAttribute("src"); // ✅ 잔상 방지
      a.load();
    } catch (_) {}

    goodtvAudio.lastUrl = null;
    currentBibleCtx = null;

    // 표시 초기화
    setGoodtvPanelText("GOOD TV 원음", "");
    qs("#goodtv-day-status").text("");
    qs("#goodtv-day-label").addClass("hidden");
  };

  // Day 변경 시 GOODTV 패널/컨트롤 초기화 (패널은 유지)
  const resetGoodtvForDayChange = () => {
    resetGoodtvStateKeepPanel(); // ✅
  };

  const getGoodtvUrlFromCtx = () => {
    const ctx = currentBibleCtx;
    if (!ctx?.bookNum || !ctx?.chapter) return null;
    return buildGoodTvBibleAudioUrl(ctx.bookNum, ctx.chapter);
  };

  const loadGoodtvFromCtx = async ({
    autoplay = false,
    preserve = false,
  } = {}) => {
    const ctx = currentBibleCtx;
    if (!ctx) {
      alert("성경을 먼저 선택해 주세요.");
      return;
    }

    const url = getGoodtvUrlFromCtx();
    if (!url) {
      alert("음원 주소를 만들 수 없어요.");
      return;
    }

    const a = ensureGoodtvAudio();

    // 패널을 닫았다가 다시 열 때(토글) 음원을 다시 로드하면 재생이 끊김.
    // preserve=true 이고 URL이 동일하면 src/seek 리셋을 하지 않는다.
    if (preserve && (goodtvAudio.lastUrl === url || a.src === url)) {
      setGoodtvPanelText("GOOD TV 원음", await formatGoodtvRef(ctx));
      return;
    }

    goodtvAudio.lastUrl = url; // ✅ 여기서만 갱신
    a.src = url;

    setGoodtvPanelText("GOOD TV 원음", await formatGoodtvRef(ctx));

    // UI 리셋
    qs("#goodtv-seek").val(0);
    qs("#goodtv-time").text("0:00");
    qs("#goodtv-duration").text("0:00");

    if (autoplay) {
      try {
        await a.play(); // ✅ 사용자 클릭 흐름에서 호출되도록 보장
        goodtvAudio.playing = true;
        setGoodtvPlayBtn(true);
      } catch (_) {
        goodtvAudio.playing = false;
        setGoodtvPlayBtn(false);
      }
    } else {
      goodtvAudio.playing = false;
      setGoodtvPlayBtn(false);
    }
    try {
      window.__goodtvUpdateNav && window.__goodtvUpdateNav();
    } catch (_) {}
  };

  const toggleGoodtvPanel = async () => {
    const $panel = qs("#goodtv-audio-panel");
    if (!$panel.length) return;

    const willOpen = $panel.hasClass("hidden");

    const cur = getAUDIO();
    setAUDIO({ ...cur, open: willOpen });

    if (willOpen) {
      $panel.removeClass("hidden");
      await loadGoodtvFromCtx({ autoplay: false, preserve: true }); // 열 때는 준비만 (재생 유지)
      qs("#open-label").text("▲");
    } else {
      $panel.addClass("hidden");
      qs("#open-label").text("▼");
      // NOTE: 패널 토글은 UI만 처리 (재생/큐 재생에는 영향 없음)
    }
  };

  const bindGoodtvControls = (state) => {
    const a = ensureGoodtvAudio();

    // 재생/일시정지
    qs("#goodtv-play")
      .off("click")
      .on("click", async () => {
        if (!a.src) await loadGoodtvFromCtx({ autoplay: false });
        if (!a.src) return;

        if (!goodtvAudio.playing) {
          try {
            await a.play();
            goodtvAudio.playing = true;
            setGoodtvPlayBtn(true);
          } catch (_) {
            goodtvAudio.playing = false;
            setGoodtvPlayBtn(false);
          }
        } else {
          a.pause();
          goodtvAudio.playing = false;
          setGoodtvPlayBtn(false);
        }
      });

    // 이전/다음 장 (단순 ±1)
    const navCache = { day: null, queue: null };

    const getNavQueue = async () => {
      const day = Number(state?.selectedDay || 1);
      if (navCache.day === day && Array.isArray(navCache.queue)) return navCache.queue;
      navCache.day = day;
      navCache.queue = await buildGoodtvDayQueue(state);
      return navCache.queue;
    };

    // timeupdate -> 진행바
    a.addEventListener("timeupdate", () => {
      const cur = a.currentTime || 0;
      const dur = a.duration || 0;
      const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;

      qs("#goodtv-time").text(fmtTime(cur));
      qs("#goodtv-duration").text(fmtTime(dur));
      qs("#goodtv-seek").val(pct);
    });

    // 시킹
    qs("#goodtv-seek")
      .off("input")
      .on("input", function () {
        const dur = a.duration || 0;
        if (!dur) return;
        const pct = Number(this.value || 0);
        a.currentTime = (dur * pct) / 100;
      });

    // 끝나면 버튼만 정리 (큐 모드일 땐 큐 핸들러가 다음 트랙 진행)
    a.addEventListener("ended", () => {
      if (goodtvDayRuntime.playing) return; // ✅ 큐 모드면 여기서 처리 X
      goodtvAudio.playing = false;
      setGoodtvPlayBtn(false);
    });
  };

  // =========================================================
  // 2.2) "전체 듣기" 중 본문(#bible-modal-body) 동기화
  // =========================================================
  const renderBibleModalForChapter = async ({
    bookNum,
    chapter,
    titleText,
  }) => {
    // 모달이 열려있을 때만 동기화
    const $modal = qs("#bible-modal");
    if (!$modal.length || $modal.hasClass("hidden")) return;

    try {
      const idx = await loadBibleDb();
      const longLabel = idx.bookToLong.get(bookNum) || `${bookNum}권`;
      const shortLabel = idx.bookToShort?.get(bookNum) || longLabel.slice(0, 1);

      qs("#bible-modal-title").text(titleText || `${shortLabel}${chapter}`);
      qs("#bible-modal-subtitle").text(`${longLabel} ${chapter}장`);

      const $body = qs("#bible-modal-body");
      let verses = idx.bcToVerses.get(`${bookNum}:${chapter}`) || [];

      const html = `
        <div class="mb-5">
          <div class="font-extrabold text-gray-900 dark:text-gray-100">${escapeHTML(
            longLabel
          )} ${chapter}장</div>
          <div class="mt-2 space-y-2">
            ${
              verses.length
                ? verses
                    .map(
                      (v) => `
                        <div class="flex gap-2">
                          <div class="shrink-0 w-7 text-right text-xs text-gray-400 pt-[2px]">${escapeHTML(
                            v.p
                          )}</div>
                          <div class="text-gray-900 dark:text-gray-100">${escapeHTML(
                            v.s
                          )}</div>
                        </div>
                      `
                    )
                    .join("")
                : `<div class="text-sm text-gray-500">본문 데이터가 없어요.</div>`
            }
          </div>
        </div>
      `;
      $body.html(html);
    } catch (e) {
      // 본문 동기화 실패는 치명적이 아니므로 조용히
      console.warn("renderBibleModalForChapter failed", e);
    }
  };

  // =========================================================
  // 2.5) GOODTV "선택한 Day 분량 이어듣기" (Day Queue)
  // =========================================================
  const goodtvDayRuntime = {
    playing: false,
    queue: [],
    idx: 0,
    session: 0,
    playAt: null,
  };

  const stopGoodtvDayQueue = () => {
    if (!goodtvDayRuntime.playing) return;
    goodtvDayRuntime.playing = false;
    goodtvDayRuntime.session += 1;
    qs("#goodtv-day-status").text("정지됨");
  };

  const markSelectedDayDone = (state) => {
    try {
      const p2 = loadProgress();
      const cycle = Number(state.cycle || 1);
      const day = Number(state.selectedDay || 1);
      ensureCycle(p2, cycle);

      // 이미 완료면 유지
      if (!p2.cycles[String(cycle)].completed) p2.cycles[String(cycle)].completed = {};
      if (!p2.cycles[String(cycle)].completed[String(day)]) {
        p2.cycles[String(cycle)].completed[String(day)] = true;

        if (p2.cycles[String(cycle)].startedAt === null)
          p2.cycles[String(cycle)].startedAt = nowIso();

        const doneCount = countDone(p2.cycles[String(cycle)].completed);
        if (doneCount >= state.days) p2.cycles[String(cycle)].finishedAt = nowIso();
      }
      saveProgress(p2);
    } catch (e) {
      console.warn("markSelectedDayDone failed", e);
    }
  };

  const buildGoodtvDayQueue = async (state) => {
    const entry = state?.PLAN?.[state.selectedDay - 1];
    const readings = Array.isArray(entry?.readings) ? entry.readings : [];
    if (!readings.length) return [];

    const idx = await loadBibleDb(); // short -> bookNum 매핑
    const out = [];

    for (const token of readings) {
      const parsed = parseReadingToken(token);
      if (!parsed) continue;

      const bookNum = idx.shortToBook.get(parsed.short);
      if (!bookNum) continue;

      // parts를 chapter 단위로 확장
      for (const part of parsed.parts || []) {
        for (let ch = part.chStart; ch <= part.chEnd; ch++) {
          out.push({ token, short: parsed.short, bookNum, chapter: ch });
        }
      }
    }
    return out;
  };

  const playGoodtvDayQueue = async (state) => {
    const a = ensureGoodtvAudio();

    const queue = await buildGoodtvDayQueue(state);
    goodtvDayRuntime.queue = queue;
    goodtvDayRuntime.idx = 0;
    goodtvDayRuntime.session += 1;
    const mySession = goodtvDayRuntime.session;

    const preview = queue.map((x) => `${x.short}${x.chapter}`).join(" · ");
    qs("#goodtv-day-status").text(preview || "(선택 분량 없음)");
    qs("#goodtv-day-label").removeClass("hidden");

    if (!queue.length) {
      alert("선택한 Day 분량(읽기표)을 찾지 못했어요.");
      return;
    }

    // 패널 열기 (사용자 클릭 흐름)
    qs("#goodtv-audio-panel").removeClass("hidden");
    qs("#open-label").text("▲");
    // ✅ 전체듣기로 열렸다면 토글 상태도 open:true로 동기화
    setAUDIO({ ...getAUDIO(), open: true }); // ✅ (추가)

    goodtvDayRuntime.playing = true;

    const playAt = async (i) => {
      if (!goodtvDayRuntime.playing) return;
      if (goodtvDayRuntime.session !== mySession) return;

      const item = goodtvDayRuntime.queue[i];
      if (!item) {
        goodtvDayRuntime.playing = false;
        goodtvAudio.playing = false;
        setGoodtvPlayBtn(false);
        qs("#goodtv-day-status").text("선택 분량 재생 완료 ✓");
        // ✅ 전체 이어듣기(선택 분량) 완료 시, 완료 체크 처리
        markSelectedDayDone(state);
        try {
          render(state);
        } catch (_) {}
        return;
      }

      // ✅ 구절 변경: 패널은 유지, 재생/표시만 초기화 후 진행
      // (너무 강한 초기화를 원치 않으면 아래 2줄 중 stopGoodtvAudio만 남겨도 됨)
      stopGoodtvAudio(); // ✅ 재생 UI 리셋(간단)
      // resetGoodtvStateKeepPanel(); // (선택) 완전 초기화가 필요하면 사용

      // 모달/패널 표시용
      currentBibleCtx = { bookNum: item.bookNum, chapter: item.chapter }; // ✅ 현재 위치 동기화
      setGoodtvPanelText(
        "GOOD TV 원음",
        await formatGoodtvRef({ bookNum: item.bookNum, chapter: item.chapter })
      ); // ✅ 표시를 한글 책명으로
      qs("#goodtv-day-status").text(
        `재생 중… (${i + 1}/${goodtvDayRuntime.queue.length}) · ${item.short}${item.chapter}`
      );

      // ✅ 전체듣기 중 본문도 동기화
      await renderBibleModalForChapter({
        bookNum: item.bookNum,
        chapter: item.chapter,
        titleText: item.token || `${item.short}${item.chapter}`,
      }); // ✅ (추가)

      const url = buildGoodTvBibleAudioUrl(item.bookNum, item.chapter);
      goodtvAudio.lastUrl = url; // ✅ 큐 재생 중에도 마지막 URL 갱신 (패널 토글 재로딩 방지)
      a.src = url;

      // iOS/Safari 등에서 src 변경 직후 play()가 실패/끊김 나는 경우가 있어
      // load() + canplay 대기 후 재생을 시도한다.
      try {
        a.load();
        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            a.removeEventListener("canplay", onCanPlay);
            a.removeEventListener("error", onErr);
            resolve();
          };
          const onCanPlay = () => finish();
          const onErr = () => finish();
          a.addEventListener("canplay", onCanPlay, { once: true });
          a.addEventListener("error", onErr, { once: true });
          setTimeout(finish, 1500); // 너무 오래 대기하지 않기
        });
      } catch (_) {}

      // seek UI 리셋
      qs("#goodtv-seek").val(0);
      qs("#goodtv-time").text("0:00");
      qs("#goodtv-duration").text("0:00");

      try {
        await a.play();
        goodtvAudio.playing = true;
        setGoodtvPlayBtn(true);
      } catch (_) {
        goodtvAudio.playing = false;
        setGoodtvPlayBtn(false);
      }
    };

    // playAt은 호출마다 새 클로저가 생기므로, ended 핸들러가 최신 playAt을 쓰도록 런타임에 저장한다.
    goodtvDayRuntime.playAt = playAt; // ✅ 다음 트랙 진행에서 최신 playAt 사용

    // ended 핸들러(1회만 바인딩) - 내부에서 goodtvDayRuntime.playAt을 참조(클로저 고착 방지)
    if (!a.__goodtvDayQueueBound) {
      a.__goodtvDayQueueBound = true;
      a.addEventListener("ended", () => {
        if (!goodtvDayRuntime.playing) return;
        goodtvDayRuntime.idx += 1;
        // 다음 트랙 세팅/재생은 다음 틱에서 처리(브라우저별 ended 타이밍 이슈 방지)
        setTimeout(() => {
          try {
            if (typeof goodtvDayRuntime.playAt === "function") {
              goodtvDayRuntime.playAt(goodtvDayRuntime.idx);
            }
          } catch (_) {}
        }, 0);
      });
    }

    await playAt(0);
  };

  const bindGoodtvDayQueueButtons = (state) => {
    qs("#goodtv-play-day")
      .off("click")
      .on("click", async () => {
        await playGoodtvDayQueue(state);
      });

    qs("#goodtv-stop-day")
      .off("click")
      .on("click", () => {
        stopGoodtvDayQueue();
        stopGoodtvAudio(); // 정지 버튼은 실제 오디오도 정지
      });
  };

  // =========================================================
  // 3) Confetti FX (site.js wrapper optional)
  // =========================================================
  const prefersReducedMotion = () =>
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  const fxSmall = () => {
    if (prefersReducedMotion()) return;
    if (window.SiteFX?.burstSmall) return window.SiteFX.burstSmall();
    if (typeof window.confetti === "function") {
      try {
        window.confetti({
          particleCount: 60,
          spread: 70,
          startVelocity: 35,
          origin: { y: 0.75 },
        });
      } catch (_) {}
    }
  };

  const fxBig = () => {
    if (prefersReducedMotion()) return;
    if (window.SiteFX?.burstBig) return window.SiteFX.burstBig();
    if (typeof window.confetti === "function") {
      try {
        window.confetti({
          particleCount: 160,
          spread: 110,
          startVelocity: 55,
          origin: { y: 0.65 },
        });
        setTimeout(() => {
          window.confetti({
            particleCount: 120,
            spread: 90,
            startVelocity: 45,
            origin: { y: 0.65 },
          });
        }, 180);
      } catch (_) {}
    }
  };

  // =========================================================
  // 4) Bible DB (bible_db.json) - Index + Loader
  // =========================================================
  const BIBLE_DB_URL = "/data/bible_db.json";
  let __bibleDbPromise = null;
  let __bibleIndex = null;

  const buildBibleIndex = (rows) => {
    const shortToBook = new Map();
    const bookToLong = new Map();
    const bookToShort = new Map();
    const bcToVerses = new Map(); // "book:chapter" -> [{p,s}]

    for (const r of rows) {
      if (!shortToBook.has(r.short_label)) shortToBook.set(r.short_label, r.book);
      if (!bookToLong.has(r.book)) bookToLong.set(r.book, r.long_label);
      if (!bookToShort.has(r.book)) bookToShort.set(r.book, r.short_label);

      const key = `${r.book}:${r.chapter}`;
      if (!bcToVerses.has(key)) bcToVerses.set(key, []);
      bcToVerses.get(key).push({ p: r.paragraph, s: r.sentence });
    }

    return { shortToBook, bookToLong, bookToShort, bcToVerses };
  };

  const loadBibleDb = async () => {
    if (__bibleIndex) return __bibleIndex;

    if (!__bibleDbPromise) {
      __bibleDbPromise = fetch(BIBLE_DB_URL, { cache: "force-cache" })
        .then((r) => {
          if (!r.ok) throw new Error(`bible_db.json 로드 실패 (${r.status})`);
          return r.json();
        })
        .then((json) => {
          const rows = Array.isArray(json?.Bible) ? json.Bible : [];
          __bibleIndex = buildBibleIndex(rows);
          return __bibleIndex;
        });
    }

    return __bibleDbPromise;
  };

  // =========================================================
  // 5) Bible Token Parser + Modal Renderer
  // =========================================================
  // "에9,10" / "눅1:1-38" / "시119:1-24" / "창9-10" 지원
  const parseReadingToken = (token) => {
    const raw = String(token || "").trim();
    if (!raw) return null;

    const m = raw.match(/^([가-힣]+)\s*(.+)$/);
    if (!m) return null;

    const short = m[1].trim();
    const rest = m[2].trim();
    if (!rest) return null;

    const segs = rest.split(/\s*,\s*/).filter(Boolean);
    if (!segs.length) return null;

    const parts = [];

    for (const seg of segs) {
      if (seg.includes(":")) {
        const mm = seg.match(/^(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?$/);
        if (!mm) return null;
        const ch = Number(mm[1]);
        const vStart = Number(mm[2]);
        const vEnd = mm[3] ? Number(mm[3]) : vStart;
        if (![ch, vStart, vEnd].every(Number.isFinite)) return null;

        parts.push({
          chStart: ch,
          chEnd: ch,
          vStart: Math.min(vStart, vEnd),
          vEnd: Math.max(vStart, vEnd),
        });
        continue;
      }

      const mm = seg.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!mm) return null;
      const chStart = Number(mm[1]);
      const chEnd = mm[2] ? Number(mm[2]) : chStart;
      if (![chStart, chEnd].every(Number.isFinite)) return null;

      parts.push({
        chStart: Math.min(chStart, chEnd),
        chEnd: Math.max(chStart, chEnd),
      });
    }

    parts.sort(
      (a, b) => a.chStart - b.chStart || (a.vStart ?? 0) - (b.vStart ?? 0)
    );

    return { short, parts };
  };

  const renderReadingsHTML = (readings) => {
    return readings
      .map((t, i) => {
        const sep =
          i < readings.length - 1
            ? ` <span class="text-gray-300">·</span> `
            : "";
        return `
          <button type="button"
            class="reading-ref inline-flex items-center px-2 py-1 rounded-lg bg-blue-50 text-blue-800 font-semibold hover:bg-blue-100 active:scale-[0.99]"
            data-ref="${escapeAttr(t)}">
            ${escapeHTML(t)}
          </button>${sep}
        `;
      })
      .join("");
  };

  const closeBibleModal = () => {
    // ✅ 모달 닫으면 GOODTV도 정리
    resetGoodtvStateKeepPanel(); // ✅ (패널 유지)
    qs("#bible-modal").addClass("hidden");
    window.SiteOverlay?.close("bible-modal");
  };

  const openBibleModal = async (token) => {
    // ✅ 새 토큰(구절) 열 때: 패널은 유지하되 상태 초기화
    resetGoodtvStateKeepPanel(); // ✅

    const cfg = getAUDIO();
    qs("#goodtv-audio-panel").toggleClass("hidden", !cfg.open);
    qs("#open-label").text(cfg.open ? "▲" : "▼");

    const parsed = parseReadingToken(token);

    qs("#bible-modal").removeClass("hidden");
    qs("#bible-modal-title").text(token || "성경");
    qs("#bible-modal-subtitle").text("");
    window.SiteOverlay?.open("bible-modal", closeBibleModal);

    const $body = qs("#bible-modal-body");
    $body.html(`<div class="text-sm text-gray-500">불러오는 중…</div>`);

    if (!parsed) {
      qs("#bible-modal-subtitle").text("지원되지 않는 표기");
      $body.html(
        `<div class="text-sm text-gray-600">"${escapeHTML(
          token
        )}" 표기는 아직 지원하지 않아요.</div>`
      );
      return;
    }

    const firstPart = parsed.parts?.[0];
    const firstChapter = firstPart?.chStart;

    try {
      const idx = await loadBibleDb();
      const bookNum = idx.shortToBook.get(parsed.short);

      currentBibleCtx = {
        token,
        bookNum: bookNum,
        chapter: firstChapter || 1,
        vStart: firstPart?.vStart ?? null,
        vEnd: firstPart?.vEnd ?? null,
      };

      if (!bookNum) {
        qs("#bible-modal-subtitle").text("책을 찾을 수 없음");
        $body.html(
          `<div class="text-sm text-gray-600">"${escapeHTML(
            parsed.short
          )}" 약어를 성경DB에서 찾지 못했어요.</div>`
        );
        return;
      }

      const longLabel = idx.bookToLong.get(bookNum) || parsed.short;

      const labelParts = parsed.parts.map((p) => {
        const ch = p.chStart === p.chEnd ? `${p.chStart}` : `${p.chStart}-${p.chEnd}`;
        if (p.vStart != null) return `${p.chStart}:${p.vStart}-${p.vEnd}`;
        return ch;
      });

      qs("#bible-modal-subtitle").text(`${longLabel} ${labelParts.join(", ")}`);

      let html = "";

      for (const part of parsed.parts) {
        for (let ch = part.chStart; ch <= part.chEnd; ch++) {
          let verses = idx.bcToVerses.get(`${bookNum}:${ch}`) || [];

          if (part.vStart != null && part.chStart === part.chEnd) {
            verses = verses.filter((v) => {
              const n = Number(v.p);
              return Number.isFinite(n) && n >= part.vStart && n <= part.vEnd;
            });
          }

          html += `
            <div class="mb-5">
              <div class="font-extrabold text-gray-900 dark:text-gray-100">${escapeHTML(
                longLabel
              )} ${ch}장</div>
              <div class="mt-2 space-y-2">
                ${
                  verses.length
                    ? verses
                        .map(
                          (v) => `
                            <div class="flex gap-2">
                              <div class="shrink-0 w-7 text-right text-xs text-gray-400 pt-[2px]">${escapeHTML(
                                v.p
                              )}</div>
                              <div class="text-gray-900 dark:text-gray-100">${escapeHTML(
                                v.s
                              )}</div>
                            </div>
                          `
                        )
                        .join("")
                    : `<div class="text-sm text-gray-500">본문 데이터가 없어요.</div>`
                }
              </div>
            </div>
          `;
        }
      }

      $body.html(html || `<div class="text-sm text-gray-500">표시할 내용이 없어요.</div>`);
    } catch (e) {
      qs("#bible-modal-subtitle").text("로드 오류");
      $body.html(
        `<div class="text-sm text-red-600">본문을 불러오지 못했어요. (오프라인이거나 파일 경로를 확인해 주세요)</div>`
      );
      console.error(e);
    }
  };

  // =========================================================
  // 6) Progress / Options / Plan
  // =========================================================
  const STORAGE_KEY = "bibleRead:progress:v2";
  const OPT_KEY = "bibleRead:options:v1";

  const loadProgress = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { activeCycle: 1, cycles: {} };
  };

  const saveProgress = (p) => localStorage.setItem(STORAGE_KEY, JSON.stringify(p));

  const ensureCycle = (p, cycle) => {
    const k = String(cycle);
    if (!p.cycles[k]) p.cycles[k] = { completed: {}, startedAt: null, finishedAt: null };
    return p;
  };

  const countDone = (completedMap) =>
    Object.values(completedMap || {}).filter(Boolean).length;

  const loadOptions = () => {
    try {
      const raw = localStorage.getItem(OPT_KEY);
      if (raw) return { autoNextAfterDoneToday: false, ...JSON.parse(raw) };
    } catch {}
    return { autoNextAfterDoneToday: false };
  };

  const saveOptions = (opt) => localStorage.setItem(OPT_KEY, JSON.stringify(opt));

  const getQueryDay = () => {
    const u = new URL(location.href);
    const v = u.searchParams.get("day");
    const n = v == null ? null : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const setQueryDay = (day) => {
    const u = new URL(location.href);
    u.searchParams.set("day", String(day));
    history.replaceState({}, "", u);
  };

  const getTodayMMDD = () => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${mm}-${dd}`;
  };

  const normalizePlan = (raw) => {
    return (raw || []).map((row, i) => {
      const day = Number(row.day ?? row.Day ?? (i + 1));
      const date = row.date ?? row.Date ?? row.mmdd ?? row.MMDD ?? "";
      const readings = row.readings ?? row.Readings ?? row.reading ?? row.Reading ?? [];
      let month = row.month;
      let dayOfMonth = row.dayOfMonth;

      if (
        (!month || !dayOfMonth) &&
        typeof date === "string" &&
        /^\d{2}-\d{2}$/.test(date)
      ) {
        const [mm, dd] = date.split("-").map(Number);
        month = mm;
        dayOfMonth = dd;
      }

      return { ...row, day, date, month, dayOfMonth, readings };
    });
  };

  const renderFatal = (msg, extra = "") => {
    qs("#main-card").html(`
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow p-5 border border-gray-100 dark:border-gray-700">
        <div class="text-red-600 font-extrabold">데이터 로딩 오류</div>
        <div class="mt-2 text-gray-800 dark:text-gray-100 font-semibold">${escapeHTML(
          msg
        )}</div>
        ${
          extra
            ? `<div class="mt-3 text-sm text-gray-500 dark:text-gray-300">${escapeHTML(
                extra
              )}</div>`
            : ""
        }
      </div>
    `);
  };

  const getTodayDay = (PLAN) => {
    const mmdd = getTodayMMDD();
    const idx = PLAN.findIndex((x) => x.date === mmdd);
    return idx >= 0 ? idx + 1 : 1;
  };

  const findNextUndoneDay = (p, cycle, fromDay, days) => {
    const completed = p.cycles[String(cycle)]?.completed || {};
    for (let d = fromDay + 1; d <= days; d++) if (!completed[String(d)]) return d;
    for (let d = 1; d <= days; d++) if (!completed[String(d)]) return d;
    return clamp(fromDay + 1, 1, days);
  };

  const isCycleFinished = (p, cycle, days) => {
    ensureCycle(p, cycle);
    const doneCount = countDone(p.cycles[String(cycle)]?.completed);
    return doneCount >= days;
  };

  const advanceCycleIfFinished = (p, cycle, days) => {
    ensureCycle(p, cycle);
    const k = String(cycle);

    const doneCount = countDone(p.cycles[k]?.completed);
    if (doneCount >= days && !p.cycles[k].finishedAt) p.cycles[k].finishedAt = nowIso();
    if (doneCount < days) p.cycles[k].finishedAt = null;

    if (doneCount < days) return cycle;

    const next = Number(p.activeCycle || cycle) + 1;
    p.activeCycle = next;
    ensureCycle(p, next);
    saveProgress(p);
    return next;
  };

  const pickAutoDay = (p, cycle, todayDay, days) => {
    ensureCycle(p, cycle);
    const doneToday = !!p.cycles[String(cycle)]?.completed?.[String(todayDay)];
    if (!doneToday) return todayDay;
    return findNextUndoneDay(p, cycle, todayDay, days);
  };

  // =========================================================
  // 7) UI Render (Main / Header / Progress / Nav)
  // =========================================================
  const renderMainCard = (state) => {
    const { PLAN, selectedDay, cycle, days } = state;

    const entry = PLAN[selectedDay - 1];
    const p = loadProgress();
    ensureCycle(p, cycle);
    const done = !!p.cycles[String(cycle)].completed[String(selectedDay)];

    const readings = entry?.readings ?? [];
    const hasReadings = Array.isArray(readings) && readings.length > 0;

    qs("#main-card").html(`
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow p-5 border border-gray-100 dark:border-gray-700">
        <div class="inline-flex items-center gap-2">
          <span class="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-100">
            ${cycle}독
          </span>
          <span class="text-xs text-gray-500 dark:text-gray-300">
            Day ${selectedDay} / ${days}
          </span>
        </div>

        <div class="mt-3 text-[17px] leading-relaxed break-words text-gray-900 dark:text-gray-100 flex flex-wrap gap-2 gap-y-4">
          ${
            hasReadings
              ? renderReadingsHTML(readings)
              : `<span class="text-gray-500 dark:text-gray-300">(데이터 준비중)</span>`
          }
        </div>

        <button id="done-btn"
          class="mt-4 w-full py-3 rounded-xl text-white font-semibold shadow-sm active:scale-[0.99]
          ${done ? "bg-green-600" : "bg-blue-600"}">
          ${done ? "완료됨 ✓ (다시 누르면 해제)" : "읽었어요 :)"}
        </button>
      </div>
    `);

    qs("#done-btn")
      .off("click")
      .on("click", () => {
        const p2 = loadProgress();
        ensureCycle(p2, cycle);

        const wasDone = !!p2.cycles[String(cycle)].completed[String(selectedDay)];
        const nowDone = !wasDone;

        p2.cycles[String(cycle)].completed[String(selectedDay)] = nowDone;

        if (p2.cycles[String(cycle)].startedAt === null)
          p2.cycles[String(cycle)].startedAt = nowIso();

        const doneCount = countDone(p2.cycles[String(cycle)].completed);
        if (doneCount >= days) p2.cycles[String(cycle)].finishedAt = nowIso();
        else p2.cycles[String(cycle)].finishedAt = null;

        saveProgress(p2);

        // 7독 단위 축하
        if (nowDone && doneCount % 7 === 0) fxSmall();

        // 완독 시
        if (nowDone && doneCount >= days) {
          fxBig();

          const nextCycle = advanceCycleIfFinished(p2, cycle, days);
          state.cycle = nextCycle;

          const p3 = loadProgress();
          ensureCycle(p3, state.cycle);

          const nextDay = pickAutoDay(p3, state.cycle, state.todayDay, days);
          state.setSelectedDay(nextDay);
          return;
        }

        // 옵션: 완료 후 다음 미완료로 자동 진행
        const opt = loadOptions();
        if (opt.autoNextAfterDoneToday && nowDone) {
          state.setSelectedDay(findNextUndoneDay(p2, cycle, selectedDay, days)); // ✅ 변경: selectedDay 기준
          return;
        }

        render(state);
      });
  };

  const renderProgress = (state) => {
    const $p = qs("#progress");
    if (!$p.length) return;

    const p = loadProgress();
    ensureCycle(p, state.cycle);
    const doneMap = p.cycles[String(state.cycle)]?.completed || {};
    const doneCount = countDone(doneMap);
    const pct = Math.floor((doneCount / state.days) * 100);
    $p.text(`진행률: ${state.cycle}독 · ${doneCount}/${state.days} (${pct}%)`);
  };

  const renderHeader = (state) => {
    // share 버튼이 있을 때만
    const $share = qs("#share-btn");
    if ($share.length) {
      $share.off("click").on("click", async () => {
        const url = new URL(location.href);
        url.searchParams.set("day", String(state.selectedDay));
        const shareData = {
          title: "나의신앙생활 · 365일 일독",
          text: "오늘 분량을 확인해요",
          url: url.toString(),
        };
        try {
          if (navigator.share) await navigator.share(shareData);
          else {
            await navigator.clipboard.writeText(url.toString());
            alert("링크를 복사했어요!");
          }
        } catch {}
      });
    }

    // 홈 버튼이 있을 때만
    const $home = qs("#go-home");
    if ($home.length) {
      $home.off("click").on("click", () => {
        closeBibleModal();
        location.assign("/");
      });
    }
  };

  const updateNavButtons = (state) => {
    qs("#prev-btn").toggleClass(
      "invisible pointer-events-none",
      state.selectedDay <= DAY_MIN
    );
    qs("#next-btn").toggleClass(
      "invisible pointer-events-none",
      state.selectedDay >= state.days
    );
  };

  const initBottomNav = (state) => {
    qs("#prev-btn")
      .off("click")
      .on("click", () => {
        if (state.selectedDay <= DAY_MIN) return;
        state.setSelectedDay(state.selectedDay - 1);
      });

    qs("#next-btn")
      .off("click")
      .on("click", () => {
        if (state.selectedDay >= state.days) return;
        state.setSelectedDay(state.selectedDay + 1);
      });

    qs("#today-btn")
      .off("click")
      .on("click", () => state.setSelectedDay(state.todayDay));
  };

  // 옵션 UI가 있는 경우에만 연결(없으면 무시)
  const initOptions = () => {
    const $opt = qs("#opt-auto-next");
    if (!$opt.length) return;

    const opt = loadOptions();
    $opt.prop("checked", !!opt.autoNextAfterDoneToday);

    $opt.off("change").on("change", (e) => {
      const next = {
        ...loadOptions(),
        autoNextAfterDoneToday: !!e.target.checked,
      };
      saveOptions(next);
    });
  };

  // =========================================================
  // 8) Events (Modal Close / GOODTV Toggle / Reading Ref)
  // =========================================================
  const bindBibleModalEvents = (state) => {
    // 닫기 클릭
    $(document)
      .off("click.bibleClose")
      .on("click.bibleClose", "[data-bible-close]", () => closeBibleModal());

    // ESC
    $(document)
      .off("keydown.bibleEsc")
      .on("keydown.bibleEsc", (ev) => {
        if (ev.key === "Escape") closeBibleModal();
      });

    // ref 클릭 -> 성경 모달 오픈
    $(document)
      .off("click.bibleRef")
      .on("click.bibleRef", ".reading-ref", async (e) => {
        const ref = $(e.currentTarget).data("ref");
        if (!ref) return;
        openBibleModal(ref);
      });

    // GOODTV 토글(모달 내 버튼)
    $(document)
      .off("click.openBibleAudio")
      .on("click.openBibleAudio", "#open-bible-audio", async () => {
        await toggleGoodtvPanel();
      });

    // ✅ 선택한 Day 분량 이어듣기 버튼 바인딩
    bindGoodtvDayQueueButtons(state);
  };

  // =========================================================
  // 9) Main Render
  // =========================================================
  const render = (state) => {
    renderHeader(state);
    renderMainCard(state);
    updateNavButtons(state);
    renderProgress(state);
  };

  // =========================================================
  // 10) Boot
  // =========================================================
  (async () => {
    try {
      const RAW = await fetch("./data.json", { cache: "no-cache" }).then((r) =>
        r.json()
      );
      const PLAN = normalizePlan(RAW);

      if (!Array.isArray(PLAN) || PLAN.length === 0) {
        renderFatal(
          "data.json이 비어있거나 형식이 올바르지 않아요.",
          "bible-read/data.json 내용을 확인해 주세요."
        );
        return;
      }

      const days = PLAN.length;
      const todayDay = getTodayDay(PLAN);

      const p = loadProgress();
      ensureCycle(p, p.activeCycle);

      // 이미 완독 상태면 자동 다음 독
      if (isCycleFinished(p, p.activeCycle, days)) {
        p.activeCycle = advanceCycleIfFinished(p, p.activeCycle, days);
      } else {
        saveProgress(p);
      }

      initOptions();

      const queryDay = getQueryDay();
      const opt = loadOptions();

      // 초기 day 선택: 기본은 "오늘(미완료)" -> "가까운 미완료"
      let initialDay;
      if (queryDay != null) {
        initialDay = clamp(queryDay, DAY_MIN, days);
      } else {
        const p2 = loadProgress();
        const cycle = Number(p2.activeCycle || 1);
        ensureCycle(p2, cycle);

        const opt = loadOptions();

        if (opt.autoNextAfterDoneToday) {
          // ✅ ON: 오늘이 미완료면 오늘, 완료면 다음 미완료
          initialDay = pickAutoDay(p2, cycle, todayDay, days);
        } else {
          // ✅ OFF: 무조건 오늘 날짜 구간에 포커싱
          initialDay = todayDay;
        }
      }

      const pFinal = loadProgress();
      const state = {
        PLAN,
        days,
        todayDay,
        selectedDay: initialDay,
        cycle: Number(pFinal.activeCycle || 1),
        setSelectedDay: (d) => {
          state.selectedDay = clamp(d, DAY_MIN, days);
          setQueryDay(state.selectedDay);
          resetGoodtvForDayChange(); // ✅ Day 변경 시 "패널 유지 + 상태 초기화"
          render(state);
        },
      };

      initBottomNav(state);
      render(state);

      bindBibleModalEvents(state);
      bindGoodtvControls(state);
    } catch (e) {
      renderFatal("예상치 못한 오류", String(e?.message || e));
      console.error(e);
    }
  })();
})();
