(() => {
  const DAY_MIN = 1;
  const qs = (sel) => $(sel);
  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

  // ---------- Bible DB ----------
  const BIBLE_DB_URL = "/data/bible_db.json";
  let __bibleDbPromise = null;
  let __bibleIndex = null;

  // ---------- TTS (암송 쪽 방식 이식: Google 우선) ----------
  const BIBLE_TTS_KEY = "bibleRead:tts:v1";

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

  const getTTS = () =>
    safeJSON.read(BIBLE_TTS_KEY, {
      open: false,
      ratePreset: "normal", // slow|normal|fast
      voiceURI: "",         // 사용자 선택 음성 저장
    });

  const setTTS = (o) => safeJSON.write(BIBLE_TTS_KEY, o);

  // ✅ runtime: 큐(청크) 재생용
  const ttsRuntime = {
    playing: false,
    queue: [],
    idx: 0,
    utter: null,
    session: 0, // stop/restart 구분용 토큰
  };

  const stopTTS = () => {
    ttsRuntime.playing = false;
    ttsRuntime.queue = [];
    ttsRuntime.idx = 0;
    ttsRuntime.utter = null;
    ttsRuntime.session += 1; // 진행 중 onend 무효화

    try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch (_) {}
    qs("#bible-tts-mini-status").text("");
    qs("#bible-tts-panel-status").text("");
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
    try { return window.speechSynthesis.getVoices?.() || []; } catch (_) { return []; }
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

  // ✅ 긴 문장/본문을 "자연스럽게" 분리해서 큐로 (첫 청크 즉시 재생)
  const splitForTTS = (text, maxLen = 180) => {
    const t = sanitizeForTTS(text);
    if (!t) return [];

    // 1) 구두점 기준 1차 분리
    const rough = t
      .split(/(?<=[\.\!\?\。\！\？…])\s+|(?<=[。])\s+|(?<=[,，;；:：])\s+|\s+(?=[-–—])/g)
      .map((s) => s.trim())
      .filter(Boolean);

    // 2) 너무 긴 덩어리는 길이 기준 2차 분리 (공백 기준)
    const out = [];
    for (const part of rough.length ? rough : [t]) {
      if (part.length <= maxLen) {
        out.push(part);
        continue;
      }
      const words = part.split(/\s+/).filter(Boolean);
      let buf = "";
      for (const w of words) {
        const next = buf ? `${buf} ${w}` : w;
        if (next.length > maxLen && buf) {
          out.push(buf);
          buf = w;
        } else {
          buf = next;
        }
      }
      if (buf) out.push(buf);
    }
    return out;
  };

  const speakChunk = (chunk, cfg) => {
    if (!("speechSynthesis" in window)) return null;

    const u = new SpeechSynthesisUtterance(chunk);
    u.lang = "ko-KR";
    u.rate = getRateByPreset(cfg.ratePreset);

    const v = pickKoreanVoice(cfg.voiceURI);
    if (v) u.voice = v;

    window.speechSynthesis.speak(u);
    return u;
  };

  // 다이얼로그 본문을 읽기 좋은 텍스트로 합치기
  const getModalPlainTextForTTS = () => {
    const $body = qs("#bible-modal-body");
    const text = $body.text() || "";
    return sanitizeForTTS(text);
  };

  // ✅ 큐 재생 (첫 청크 즉시 speak -> “바로 재생” 체감)
  const startBibleTTS = () => {
    ensureDefaultGoogleVoiceSavedIfAvailable();
    const cfg = getTTS();
    const text = getModalPlainTextForTTS();

    if (!text) {
      alert("읽을 본문이 없어요.");
      return;
    }
    if (!("speechSynthesis" in window)) {
      alert("이 브라우저는 성경듣기(TTS)를 지원하지 않아요.");
      return;
    }

    // 기존 재생 정리 후 새 세션 시작
    stopTTS();
    const mySession = ttsRuntime.session;

    const queue = splitForTTS(text, 180);
    if (!queue.length) {
      alert("읽을 본문이 없어요.");
      return;
    }

    ttsRuntime.playing = true;
    ttsRuntime.queue = queue;
    ttsRuntime.idx = 0;

    qs("#bible-tts-mini-status").text("재생 중…");
    qs("#bible-tts-panel-status").text(`재생 중… (1/${queue.length})`);

    // 일부 환경 안정성
    try { window.speechSynthesis.cancel(); } catch (_) {}

    const playNext = () => {
      if (!ttsRuntime.playing) return;
      if (ttsRuntime.session !== mySession) return;
      if (ttsRuntime.idx >= ttsRuntime.queue.length) {
        ttsRuntime.playing = false;
        qs("#bible-tts-mini-status").text("");
        qs("#bible-tts-panel-status").text("");
        return;
      }

      qs("#bible-tts-panel-status").text(`재생 중… (${ttsRuntime.idx + 1}/${queue.length})`);

      const u = speakChunk(ttsRuntime.queue[ttsRuntime.idx], cfg);
      if (!u) {
        stopTTS();
        return;
      }
      ttsRuntime.utter = u;

      u.onend = () => {
        if (!ttsRuntime.playing) return;
        if (ttsRuntime.session !== mySession) return;
        ttsRuntime.idx += 1;
        playNext();
      };
      u.onerror = () => stopTTS();
    };

    playNext(); // ✅ 첫 청크 즉시
  };

  // ---------- Helpers ----------
  const escapeHTML = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const escapeAttr = (s) => escapeHTML(s).replaceAll("`", "&#96;");

// ✅ (교체) "에9,10" / "눅1:1-38" / "시119:1-24" / "창9-10" 지원
const parseReadingToken = (token) => {
  const raw = String(token || "").trim();
  if (!raw) return null;

  // 1) 책 약어 + 나머지
  const m = raw.match(/^([가-힣]+)\s*(.+)$/);
  if (!m) return null;

  const short = m[1].trim();
  const rest = m[2].trim();
  if (!rest) return null;

  // 2) 쉼표로 여러 구간 분리 (에9,10 / 시52,53,54)
  const segs = rest.split(/\s*,\s*/).filter(Boolean);
  if (!segs.length) return null;

  const parts = [];

  for (const seg of segs) {
    // seg 예: "1", "9-10", "1:1-38", "119:1-24"
    // (A) 절 포함: ch:vStart-vEnd
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

    // (B) 장만: chStart-chEnd
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

  // 정렬(표기 안정화)
  parts.sort((a, b) => (a.chStart - b.chStart) || ((a.vStart ?? 0) - (b.vStart ?? 0)));

  return { short, parts };
};


  const buildBibleIndex = (rows) => {
    const shortToBook = new Map();
    const bookToLong = new Map();
    const bcToVerses = new Map(); // "book:chapter" -> [{p,s}]
    for (const r of rows) {
      if (!shortToBook.has(r.short_label)) shortToBook.set(r.short_label, r.book);
      if (!bookToLong.has(r.book)) bookToLong.set(r.book, r.long_label);
      const key = `${r.book}:${r.chapter}`;
      if (!bcToVerses.has(key)) bcToVerses.set(key, []);
      bcToVerses.get(key).push({ p: r.paragraph, s: r.sentence });
    }
    return { shortToBook, bookToLong, bcToVerses };
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

  const renderReadingsHTML = (readings) => {
    return readings
      .map((t, i) => {
        const sep = i < readings.length - 1 ? ` <span class="text-gray-300">·</span> ` : "";
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

const openBibleModal = async (token) => {
  stopTTS();

  const parsed = parseReadingToken(token);
  qs("#bible-modal").removeClass("hidden");
  qs("#bible-modal-title").text(token || "성경");
  qs("#bible-modal-subtitle").text("");
  
  window.SiteOverlay?.open("bible-modal", closeBibleModal);

  const $body = qs("#bible-modal-body");
  $body.html(`<div class="text-sm text-gray-500">불러오는 중…</div>`);

  if (!parsed) {
    qs("#bible-modal-subtitle").text("지원되지 않는 표기");
    $body.html(`<div class="text-sm text-gray-600">"${escapeHTML(token)}" 표기는 아직 지원하지 않아요.</div>`);
    return;
  }

  try {
    const idx = await loadBibleDb();
    const bookNum = idx.shortToBook.get(parsed.short);
    if (!bookNum) {
      qs("#bible-modal-subtitle").text("책을 찾을 수 없음");
      $body.html(`<div class="text-sm text-gray-600">"${escapeHTML(parsed.short)}" 약어를 성경DB에서 찾지 못했어요.</div>`);
      return;
    }

    const longLabel = idx.bookToLong.get(bookNum) || parsed.short;

    // ✅ subtitle용 표기 정리
    const labelParts = parsed.parts.map((p) => {
      const ch = p.chStart === p.chEnd ? `${p.chStart}` : `${p.chStart}-${p.chEnd}`;
      if (p.vStart != null) return `${p.chStart}:${p.vStart}-${p.vEnd}`;
      return ch;
    });
    qs("#bible-modal-subtitle").text(`${escapeHTML(longLabel)} ${escapeHTML(labelParts.join(", "))}`);

    let html = "";

    for (const part of parsed.parts) {
      for (let ch = part.chStart; ch <= part.chEnd; ch++) {
        let verses = idx.bcToVerses.get(`${bookNum}:${ch}`) || [];

        // ✅ 절 범위가 있으면 paragraph(=절) 기준으로 필터링
        if (part.vStart != null && part.chStart === part.chEnd) {
          verses = verses.filter((v) => {
            const n = Number(v.p);
            return Number.isFinite(n) && n >= part.vStart && n <= part.vEnd;
          });
        }

        html += `
          <div class="mb-5">
            <div class="font-extrabold text-gray-900">${escapeHTML(longLabel)} ${ch}장</div>
            <div class="mt-2 space-y-2">
              ${
                verses.length
                  ? verses
                      .map(
                        (v) => `
                          <div class="flex gap-2">
                            <div class="shrink-0 w-7 text-right text-xs text-gray-400 pt-[2px]">${escapeHTML(v.p)}</div>
                            <div class="text-gray-900">${escapeHTML(v.s)}</div>
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

    ensureDefaultGoogleVoiceSavedIfAvailable();
    renderBibleTTSUI();
  } catch (e) {
    qs("#bible-modal-subtitle").text("로드 오류");
    $body.html(`<div class="text-sm text-red-600">본문을 불러오지 못했어요. (오프라인이거나 파일 경로를 확인해 주세요)</div>`);
    console.error(e);
  }
};


  const closeBibleModal = () => {
    stopTTS();
    qs("#bible-modal").addClass("hidden");
    window.SiteOverlay?.close("bible-modal");
  };

  // ---------- Reading plan / progress ----------
  const STORAGE_KEY = "bibleRead:progress:v2";
  const OPT_KEY = "bibleRead:options:v1";

  const nowIso = () => new Date().toISOString();

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

  const countDone = (completedMap) => Object.values(completedMap || {}).filter(Boolean).length;

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

      if ((!month || !dayOfMonth) && typeof date === "string" && /^\d{2}-\d{2}$/.test(date)) {
        const [mm, dd] = date.split("-").map(Number);
        month = mm;
        dayOfMonth = dd;
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
          ${hasReadings ? renderReadingsHTML(readings) : "(데이터 준비중)"}
        </div>

        <button id="done-btn"
          class="mt-4 w-full py-3 rounded-xl text-white font-semibold shadow-sm active:scale-[0.99]
          ${done ? "bg-green-600" : "bg-blue-600"}">
          ${done ? "완료됨 ✓ (다시 누르면 해제)" : "읽었어요 :)"}
        </button>

        <div class="mt-3 text-[11px] text-gray-400 break-all hidden">
          day=${selectedDay} · readings=${Array.isArray(readings) ? readings.length : "NA"}
        </div>
      </div>
    `);

    qs("#done-btn").off("click").on("click", () => {
      const p2 = loadProgress();
      ensureCycle(p2, cycle);
      const cur = !!p2.cycles[String(cycle)].completed[String(selectedDay)];
      p2.cycles[String(cycle)].completed[String(selectedDay)] = !cur;

      if (p2.cycles[String(cycle)].startedAt === null) p2.cycles[String(cycle)].startedAt = nowIso();

      const doneCount = countDone(p2.cycles[String(cycle)].completed);
      if (doneCount >= days) p2.cycles[String(cycle)].finishedAt = nowIso();
      else p2.cycles[String(cycle)].finishedAt = null;

      saveProgress(p2);

      const opt = loadOptions();
      const todayDay = state.todayDay;
      if (opt.autoNextAfterDoneToday && selectedDay === todayDay && !cur) {
        state.setSelectedDay(findNextUndoneDay(p2, cycle, todayDay, days));
        return;
      }

      render(state);
    });
  };

  const renderProgress = (state) => {
    const p = loadProgress();
    ensureCycle(p, state.cycle);
    const doneMap = p.cycles[String(state.cycle)]?.completed || {};
    qs("#progress").text(`진행률: ${countDone(doneMap)}/${state.days}`);
  };

  const renderHeader = (state) => {
    const { selectedDay } = state;

    qs("#share-btn").off("click").on("click", async () => {
      const url = new URL(location.href);
      url.searchParams.set("day", String(selectedDay));
      const shareData = { title: "나의신앙생활 · 365일 일독", text: "오늘 분량을 확인해요", url: url.toString() };
      try {
        if (navigator.share) await navigator.share(shareData);
        else {
          await navigator.clipboard.writeText(url.toString());
          alert("링크를 복사했어요!");
        }
      } catch {}
    });

    // ✅ 홈 이동 전 TTS 종료
    qs("#go-home").off("click").on("click", () => {
      stopTTS();
      location.assign("/");
    });
  };

  const initBottomNav = (state) => {
    qs("#prev-btn").off("click").on("click", () => {
      if (state.selectedDay <= DAY_MIN) return;
      state.setSelectedDay(state.selectedDay - 1);
    });
    qs("#next-btn").off("click").on("click", () => {
      if (state.selectedDay >= state.days) return;
      state.setSelectedDay(state.selectedDay + 1);
    });
    qs("#today-btn").off("click").on("click", () => state.setSelectedDay(state.todayDay));
  };

  const initOptions = () => {
    const opt = loadOptions();
    qs("#opt-auto-next").prop("checked", !!opt.autoNextAfterDoneToday);
    qs("#opt-auto-next").off("change").on("change", (e) => {
      const next = { ...loadOptions(), autoNextAfterDoneToday: !!e.target.checked };
      saveOptions(next);
    });
  };

  // ---------- Bible TTS UI render/bind ----------
  const renderBibleTTSUI = () => {
    const cfg = getTTS();

    qs("#bible-tts-panel").toggleClass("hidden", !cfg.open);
    qs("#bible-tts-toggle-icon").text(cfg.open ? "▲" : "▼");

    $(".bible-rate-btn").each(function () {
      const p = $(this).data("rate");
      $(this)
        .toggleClass("bg-blue-50 text-blue-700 border-blue-200", cfg.ratePreset === p)
        .toggleClass("border-gray-200", cfg.ratePreset !== p);
    });

    const voices = getAllVoices();
    const koVoices = voices.filter((v) => (v.lang || "").toLowerCase().startsWith("ko"));

    const $sel = qs("#bible-tts-voice");
    if ($sel.length) {
      const curVal = cfg.voiceURI || "";
      const opts =
        `<option value="">자동(가능하면 Google)</option>` +
        koVoices
          .map((v) => {
            const selected = v.voiceURI === curVal ? "selected" : "";
            return `<option value="${escapeAttr(v.voiceURI)}" ${selected}>${escapeHTML(v.name || "Korean Voice")} (${escapeHTML(v.lang)})</option>`;
          })
          .join("");
      $sel.html(opts);
    }

    if (ttsRuntime.playing) {
      qs("#bible-tts-mini-status").text("재생 중…");
      qs("#bible-tts-panel-status").text(`재생 중… (${ttsRuntime.idx + 1}/${ttsRuntime.queue.length || 1})`);
    } else {
      qs("#bible-tts-mini-status").text("");
      qs("#bible-tts-panel-status").text("");
    }
  };

  const bindBibleTTSEvents = () => {
    qs("#bible-tts-toggle").off("click").on("click", () => {
      const cur = getTTS();
      setTTS({ ...cur, open: !cur.open });
      renderBibleTTSUI();
    });

    $(document).off("click.bibleRate").on("click.bibleRate", ".bible-rate-btn", function () {
      const preset = $(this).data("rate");
      const cur = getTTS();
      setTTS({ ...cur, ratePreset: preset });
      renderBibleTTSUI();
    });

    qs("#bible-tts-voice").off("change").on("change", function () {
      const cur = getTTS();
      setTTS({ ...cur, voiceURI: this.value || "" });
      if (ttsRuntime.playing) {
        stopTTS();
        startBibleTTS();
      }
      renderBibleTTSUI();
    });

    qs("#bible-tts-play").off("click").on("click", () => {
      stopTTS();
      startBibleTTS();
      renderBibleTTSUI();
    });

    qs("#bible-tts-stop").off("click").on("click", () => {
      stopTTS();
      renderBibleTTSUI();
    });

    // ✅ 탭 숨김 / 페이지 이탈 / 뒤로가기 포함 종료
    $(document).off("visibilitychange.bibleTTS").on("visibilitychange.bibleTTS", () => {
      if (document.hidden) stopTTS();
    });

    // beforeunload: 데스크탑 중심
    $(window).off("beforeunload.bibleTTS").on("beforeunload.bibleTTS", () => stopTTS());

    // ✅ pagehide: iOS/Safari/모바일에서 "뒤로가기/홈화면/탭전환" 때 더 잘 잡힘
    window.removeEventListener("pagehide", stopTTS, true);
    window.addEventListener("pagehide", stopTTS, true);

    // ✅ history.back / 브라우저 뒤로가기(히스토리 이동) 시도 포함
    window.removeEventListener("popstate", stopTTS, true);
    window.addEventListener("popstate", stopTTS, true);

    $(document).off("click.bibleClose").on("click.bibleClose", "[data-bible-close]", () => closeBibleModal());
    $(document).off("keydown.bibleEsc").on("keydown.bibleEsc", (ev) => {
      if (ev.key === "Escape") closeBibleModal();
    });
  };

  const updateNavButtons = (state) => {
    qs("#prev-btn").toggleClass("invisible pointer-events-none", state.selectedDay <= DAY_MIN);
    qs("#next-btn").toggleClass("invisible pointer-events-none", state.selectedDay >= state.days);
  };

  // ---------- Main render ----------
  const render = (state) => {
    renderHeader(state);
    renderMainCard(state);
    updateNavButtons(state);
    renderProgress(state);
  };

  // ---------- Boot ----------
  (async () => {
    try {
      const RAW = await fetch("./data.json", { cache: "no-cache" }).then((r) => r.json());
      const PLAN = normalizePlan(RAW);

      if (!Array.isArray(PLAN) || PLAN.length === 0) {
        renderFatal("data.json이 비어있거나 형식이 올바르지 않아요.", "bible-read/data.json 내용을 확인해 주세요.");
        return;
      }

      if ("speechSynthesis" in window) {
        try {
          window.speechSynthesis.getVoices();
          window.speechSynthesis.onvoiceschanged = () => {
            ensureDefaultGoogleVoiceSavedIfAvailable();
            renderBibleTTSUI();
          };
        } catch (_) {}
      }

      const days = PLAN.length;
      const todayDay = getTodayDay(PLAN);

      const p = loadProgress();
      ensureCycle(p, p.activeCycle);
      saveProgress(p);

      initOptions();

      let initialDay = todayDay;
      const queryDay = getQueryDay();
      if (queryDay != null) initialDay = clamp(queryDay, DAY_MIN, days);

      const opt = loadOptions();
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
        },
      };

      initBottomNav(state);
      render(state);

      $(document).off("click.bibleRef").on("click.bibleRef", ".reading-ref", async (e) => {
        const ref = $(e.currentTarget).data("ref");
        if (!ref) return;
        openBibleModal(ref);        
      });

      bindBibleTTSEvents();

      ensureDefaultGoogleVoiceSavedIfAvailable();
      renderBibleTTSUI();
      setTimeout(() => renderBibleTTSUI(), 300);
    } catch (e) {
      renderFatal("예상치 못한 오류", String(e?.message || e));
      console.error(e);
    }
  })();
})();
