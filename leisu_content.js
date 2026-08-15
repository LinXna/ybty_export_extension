(() => {
  "use strict";

  const BUTTON_ID = "codex-leisu-live-export-button";
  const PREMATCH_BUTTON_ID = "codex-leisu-prematch-export-button";
  const SCRIPT_BUTTON_ID = "codex-leisu-script-export-button";
  const INTERFACE_DIAGNOSTIC_BUTTON_ID = "codex-leisu-interface-diagnostic-button";
  const FULL_CAPTURE_BUTTON_ID = "codex-leisu-full-capture-button";
  const HISTORY_KEY = "codex_leisu_live_history_v1";
  const STATUS_ID = "codex-leisu-export-status";
  const LIMIT_ID = "codex-leisu-export-limit";
  const CONCURRENCY_ID = "codex-leisu-detail-concurrency";
  const SELECT_ID = "codex-leisu-select-mode";
  const SCHEMA_VERSION = 3;
  const EXPORT_VERSION = "2.8.0";
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  let collecting = false;
  let selectionMode = false;
  const selectedEventIds = new Set();

  function download(payload, mode) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = URL.createObjectURL(blob);
    link.download = `leisu_v${EXPORT_VERSION}_${mode}_${stamp}.json`;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function showStatus(message, error = false) {
    let node = document.getElementById(STATUS_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = STATUS_ID;
      node.style.cssText = [
        "position:fixed",
        "right:18px",
        "bottom:18px",
        "z-index:2147483647",
        "max-width:360px",
        "padding:8px 10px",
        "border-radius:8px",
        "font:12px/1.45 Arial,sans-serif",
        "color:#fff",
        "box-shadow:0 4px 16px rgba(0,0,0,.28)"
      ].join(";");
      document.documentElement.appendChild(node);
    }
    node.style.background = error ? "#a61b1b" : "#162238";
    node.textContent = message;
  }

  function normalizeCardStatistics(event) {
    event._statistics ||= {};
    for (const key of ["yellow_cards", "red_cards"]) {
      const value = event._statistics[key];
      if (!value || typeof value !== "object") {
        event._statistics[key] = { home: 0, away: 0 };
        continue;
      }
      event._statistics[key] = {
        home: Number.isFinite(Number(value.home)) ? Number(value.home) : 0,
        away: Number.isFinite(Number(value.away)) ? Number(value.away) : 0
      };
    }
  }

  function sanitizeLineups(event) {
    const lineup = event._lineups || {};
    const homeStarters = Array.isArray(lineup.home?.starters) ? lineup.home.starters : [];
    const awayStarters = Array.isArray(lineup.away?.starters) ? lineup.away.starters : [];
    const formal = homeStarters.length > 0 && awayStarters.length > 0;
    if (!formal) {
      event._lineups = {
        available: false,
        source: lineup.source || null,
        home: { players: [], starters: [], substitutes: [] },
        away: { players: [], starters: [], substitutes: [] },
        entries: [],
        status: "not_obtained"
      };
    }
    return formal;
  }

  function buildTimedLiveEvents(entries) {
    const output = [];
    let pendingMinute = null;
    for (const raw of Array.isArray(entries) ? entries : []) {
      let text = clean(raw).replace(/^[-–—]\s*/, "");
      if (!text) continue;
      const clockOnly = text.match(/^(\d{1,3}(?:\+\d{1,2})?)\s*['′]$/);
      if (clockOnly) {
        pendingMinute = clockOnly[1];
        continue;
      }
      const embedded = text.match(/(?:^|\D)(\d{1,3}(?:\+\d{1,2})?)\s*(?:['′]|分钟)/);
      const minute = embedded?.[1] || pendingMinute;
      // 文本本身已有分钟时，先移除该分钟，避免 display 重复输出。
      const normalizedText = minute
        ? text
            .replace(new RegExp(`^${minute}\\s*['′]\\s*[-–—]?\\s*`, "i"), "")
            .replace(new RegExp(`^${minute}\\s*分钟[，,]?\\s*`, "i"), "")
            .trim()
        : text;
      const displayText = normalizedText
        .replace(/^[-–—]\s*/, "")
        .replace(/^Goal!\s*[-–—]?\s*/i, "")
        .trim();
      const display = minute ? `${minute}'- ${displayText}` : displayText;
      output.push({
        minute: minute || null,
        text: displayText,
        raw_text: clean(raw),
        display
      });
      pendingMinute = null;
    }
    return output;
  }

  function standaloneNumbers(value) {
    return [...value.matchAll(/(?:^|\s)(\d{1,2})(?=\s|$)/g)].map((item) =>
      Number(item[1])
    );
  }

  function scoreValues(rowText, home, away) {
    const homeIndex = rowText.indexOf(home);
    const awayIndex = rowText.indexOf(away, homeIndex + home.length);
    if (homeIndex < 0 || awayIndex < 0) return [0, 0];
    const beforeHome = rowText.slice(0, homeIndex);
    const afterAway = rowText
      .slice(awayIndex + away.length)
      .split("数据", 1)[0];
    const homeNumbers = standaloneNumbers(beforeHome);
    const awayNumbers = standaloneNumbers(afterAway);
    return [homeNumbers.at(-1) ?? 0, awayNumbers[0] ?? 0];
  }

  function canvasScoreValues(row) {
    const scoreText = capturedCanvasText(
      row.querySelector(".lier-score canvas.qcbf, .lier-score canvas, canvas.qcbf")
    );
    const match = scoreText.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
    return match
      ? { values: [Number(match[1]), Number(match[2])], text: match[0] }
      : null;
  }

  function capturedCanvasText(canvas) {
    if (!canvas) return "";
    try {
      return JSON.parse(canvas.dataset.codexCanvasText || "[]")
        .map((command) => command.text)
        .join(" ")
        .trim();
    } catch {
      return "";
    }
  }

  const PHASE_LABELS = {
    即时: "live",
    即時: "live",
    赛前: "pre_match",
    賽前: "pre_match",
    初盘: "opening",
    初盤: "opening"
  };

  const MARKET_LABELS = {
    让球: "asian_handicap",
    讓球: "asian_handicap",
    胜平负: "match_winner",
    勝平負: "match_winner",
    总进球: "total_goals",
    總進球: "total_goals",
    角球: "corners"
  };

  function classifyLabel(textValue, labels) {
    const value = clean(textValue);
    for (const [label, key] of Object.entries(labels)) {
      if (value.includes(label)) return key;
    }
    return null;
  }

  function numericOdds(textValue) {
    return [...clean(textValue).matchAll(/(?:^|\s)(\d{1,3}(?:\.\d{1,3}))(?=\s|$)/g)]
      .map((match) => Number(match[1]))
      .filter((value) => value >= 1 && value <= 1000);
  }

  function selectedAttributes(element) {
    const output = {};
    for (const attribute of element.attributes || []) {
      if (
        attribute.name === "title" ||
        attribute.name === "data-type" ||
        attribute.name === "data-market" ||
        attribute.name === "data-name" ||
        attribute.name === "data-odd" ||
        attribute.name === "data-odds"
      ) {
        output[attribute.name] = attribute.value;
      }
    }
    return output;
  }

  function oddsContext(node, row) {
    const parts = [];
    let current = node;
    while (current && current !== row) {
      let sibling = current.previousElementSibling;
      let count = 0;
      while (sibling && count < 4) {
        const value = clean(sibling.textContent);
        if (value) parts.unshift(value);
        sibling = sibling.previousElementSibling;
        count += 1;
      }
      current = current.parentElement;
    }
    return clean(parts.join(" "));
  }

  function parseOddsPanels(row, extraPanels = []) {
    const nodes = [...row.querySelectorAll(".lier-odd")];
    let lastPhase = null;
    let lastMarket = null;
    const entries = nodes.map((node, index) => {
      const rawText = clean(node.textContent);
      const context = oddsContext(node, row);
      const combined = clean(`${context} ${rawText}`);
      const phase =
        classifyLabel(combined, PHASE_LABELS) ||
        classifyLabel(rawText, PHASE_LABELS) ||
        lastPhase;
      const market =
        classifyLabel(combined, MARKET_LABELS) ||
        classifyLabel(rawText, MARKET_LABELS) ||
        lastMarket;
      if (phase) lastPhase = phase;
      if (market) lastMarket = market;
      return {
        index,
        phase,
        market,
        text: rawText,
        context,
        odds: numericOdds(rawText),
        class_name: clean(node.className),
        attributes: selectedAttributes(node)
      };
    });

    const markets = {};
    for (const entry of entries) {
      const market = entry.market || "unclassified";
      const phase = entry.phase || "unclassified";
      markets[market] ||= {};
      markets[market][phase] ||= [];
      markets[market][phase].push(entry);
    }
    const panelEntries = extraPanels.map((panel, index) => {
      const rawText = clean(panel.text);
      return {
        index: entries.length + index,
        phase: classifyLabel(rawText, PHASE_LABELS),
        market: classifyLabel(rawText, MARKET_LABELS),
        text: rawText,
        context: panel.selector || "dynamic_overlay",
        odds: numericOdds(rawText),
        class_name: panel.class_name || "",
        attributes: panel.attributes || {}
      };
    });
    for (const entry of panelEntries) {
      const market = entry.market || "unclassified";
      const phase = entry.phase || "unclassified";
      markets[market] ||= {};
      markets[market][phase] ||= [];
      markets[market][phase].push(entry);
    }
    const canvasGroups = {};
    for (const group of row.querySelectorAll(
      ".lier-odd .asian_odds, .lier-odd .daxiao_odds"
    )) {
      const market = group.classList.contains("asian_odds")
        ? "asian_handicap"
        : "total_goals";
      canvasGroups[market] = [...group.querySelectorAll("canvas")].map(
        (canvas, index) => {
          let commands = [];
          try {
            commands = JSON.parse(canvas.dataset.codexCanvasText || "[]");
          } catch {
            commands = [];
          }
          return {
            index,
            width: canvas.width,
            height: canvas.height,
            text: commands.map((command) => command.text).join(" ").trim(),
            commands
          };
        }
      );
    }
    const values = (market) =>
      (canvasGroups[market] || []).map((item) => item.text || null);
    const asian = values("asian_handicap");
    const totals = values("total_goals");
    const current = {
      asian_handicap: {
        home: asian[0] || null,
        line: asian[1] || null,
        away: asian[2] || null
      },
      total_goals: {
        over: totals[0] || null,
        line: totals[1] || null,
        under: totals[2] || null
      }
    };
    return {
      count: entries.length + panelEntries.length,
      markets,
      entries: [...entries, ...panelEntries],
      current,
      coverage: {
        live_asian_handicap: Boolean(
          current.asian_handicap.home &&
          current.asian_handicap.line &&
          current.asian_handicap.away
        ),
        live_total_goals: Boolean(
          current.total_goals.over &&
          current.total_goals.line &&
          current.total_goals.under
        ),
        corner_score_only: true,
        corner_odds: false,
        pre_match_closing: false
      },
      canvas_markets: canvasGroups,
      diagnostics: nodes.map((node) => ({
        html: node.outerHTML.slice(0, 8000),
        parent_html: node.parentElement?.outerHTML.slice(0, 16000) || ""
      }))
    };
  }

  function visible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0 &&
      rect.width > 2 &&
      rect.height > 2
    );
  }

  function dynamicOddsPanels() {
    const selectors = [
      '[role="tooltip"]',
      ".el-popper",
      ".el-popover",
      ".el-tooltip__popper",
      ".ant-popover",
      ".popover",
      ".tooltip",
      '[class*="odd-pop"]',
      '[class*="odds-pop"]',
      '[class*="odd-detail"]',
      '[class*="odds-detail"]'
    ];
    const seen = new Set();
    const output = [];
    for (const element of document.querySelectorAll(selectors.join(","))) {
      if (seen.has(element) || !visible(element)) continue;
      seen.add(element);
      const value = clean(element.innerText || element.textContent);
      const hasPhase = classifyLabel(value, PHASE_LABELS);
      const hasMarket = classifyLabel(value, MARKET_LABELS);
      if (!value || (!hasPhase && !hasMarket && !numericOdds(value).length)) continue;
      output.push({
        selector: selectors.find((selector) => element.matches(selector)) || "",
        text: value,
        class_name: clean(element.className),
        attributes: selectedAttributes(element)
      });
    }
    return output;
  }

  async function captureOdds(row) {
    return parseOddsPanels(row, dynamicOddsPanels());
  }



  async function enrichAllStatistics(events) {
    const statisticsConcurrency = 6;
    for (let index = 0; index < events.length; index += statisticsConcurrency) {
      const batch = events.slice(index, index + statisticsConcurrency);
      await Promise.all(
        batch.map((event, offset) =>
          enrichStatistics(event, index + offset, events.length)
        )
      );
      if (index + statisticsConcurrency < events.length) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }

  function parseRow(row, sectionMode = null) {
    let teamLinks = [...row.querySelectorAll(
      [
        'a[href*="/data/zuqiu/team-"]',
        'a[href*="/team-"]',
        ".team-name",
        '[class*="team-name"]',
        ".lab-team",
        '[class*="team-item"]'
      ].join(",")
    )]
      .map((link) => clean(link.textContent))
      .filter(Boolean);
    teamLinks = [...new Set(teamLinks)];
    if (teamLinks.length < 2) {
      const fallbackLinks = [...row.querySelectorAll("a")]
        .filter((link) => {
          const href = link.getAttribute("href") || "";
          return (
            !href.includes("/detail-") &&
            !href.includes("/comp-") &&
            clean(link.textContent).length >= 2
          );
        })
        .map((link) => clean(link.textContent))
        .filter(Boolean);
      teamLinks = [...new Set(fallbackLinks)].slice(-2);
    }
    if (teamLinks.length < 2) return null;

    const detail = row.querySelector('a[href*="/detail-"]');
    const detailUrl = detail?.href || "";
    const id =
      detailUrl.match(/detail-(\d+)/)?.[1] ||
      row.getAttribute("data-id") ||
      row.getAttribute("data-match-id") ||
      row.id ||
      `${teamLinks[0]}-${teamLinks[1]}`;
    if (!id) return null;

    const rowText = clean(row.innerText);
    const minuteMatch = rowText.match(/(?:^|\s)(\d{1,3})'/);
    const canvasScore = canvasScoreValues(row);
    const scores =
      (canvasScore && canvasScore.values) ||
      scoreValues(rowText, teamLinks[0], teamLinks[1]);
    const halftime = /(?:^|\s)中(?:\s|$)/.test(rowText);
    const notStarted = /(?:^|\s)未(?:\s|$)/.test(rowText);
    const league =
      clean(row.querySelector('a[href*="/data/zuqiu/comp-"]')?.textContent) ||
      rowText.split(" ")[0] ||
      "";
    const rowCanvasText = [...row.querySelectorAll("canvas")]
      .map(capturedCanvasText)
      .filter(Boolean)
      .join(" ");
    const visibleTime =
      rowCanvasText.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/)?.[0] || null;
    const startValue =
      row.getAttribute("data-start-time") ||
      row.getAttribute("data-match-time") ||
      row.querySelector("time[datetime]")?.getAttribute("datetime") ||
      null;
    let startTimestamp = null;
    if (startValue) {
      const numeric = Number(startValue);
      if (Number.isFinite(numeric)) {
        startTimestamp = numeric > 1e12 ? Math.floor(numeric / 1000) : numeric;
      } else {
        const parsed = Date.parse(startValue);
        if (Number.isFinite(parsed)) startTimestamp = Math.floor(parsed / 1000);
      }
    }
    const finished = /(?:^|\s)(?:完|完场)(?=\s|$)/.test(rowText);
    const scoreSource = canvasScore ? "score_canvas" : "row_text_fallback";

    return {
      id,
      _provider: "leisu",
      _minute: minuteMatch ? Number(minuteMatch[1]) : halftime ? 45 : null,
      _statistics: {},
      _incidents: [],
      detail_url: detailUrl,
      startTimestamp,
      _start_time_text: visibleTime,
      _row_canvas_text: rowCanvasText,
      _row_score_text: canvasScore && canvasScore.text ? canvasScore.text : null,
      _score_source: scoreSource,
      score_source: scoreSource,
      score_verified: Boolean(canvasScore),
      tournament: { name: league },
      homeTeam: { name: teamLinks[0] },
      awayTeam: { name: teamLinks[1] },
      status: {
        type:
          sectionMode === "live"
            ? (halftime ? "halftime" : "inprogress")
            : sectionMode === "prematch"
              ? "notstarted"
              : finished
                ? "finished"
                : minuteMatch && !notStarted
                  ? "inprogress"
                  : halftime
                    ? "halftime"
                    : "notstarted",
        source: sectionMode ? "leisu_section_title" : "row_text_fallback",
        verified: Boolean(sectionMode) || finished || Boolean(minuteMatch) || halftime || notStarted
      },
      homeScore: { current: scores[0] ?? 0 },
      awayScore: { current: scores[1] ?? 0 },
      corner_score: capturedCanvasText(row.querySelector(".lier-corner canvas")),
      time: {},
      odds: null,
      raw_text: rowText
    };
  }



  const NAMI_STAT_TYPES = {
    2: "corners",
    3: "yellow_cards",
    4: "red_cards",
    8: "penalties",
    21: "shots_on_target",
    22: "shots_off_target",
    23: "attacks",
    24: "dangerous_attacks",
    25: "possession"
  };

  function numberPair(home, away) {
    const left = Number(String(home ?? "").replace("%", ""));
    const right = Number(String(away ?? "").replace("%", ""));
    return Number.isFinite(left) && Number.isFinite(right)
      ? { home: left, away: right }
      : null;
  }

  function parseNamiStatistics(apiResult) {
    const statistics = {};
    const rawByEndpoint = {};
    const textTokens = new Set();
    const textRecords = [];
    const numberRecords = [];
    const namedKeys = {
      shots: "shots",
      shot: "shots",
      shots_total: "shots",
      shot_total: "shots",
      shots_on_target: "shots_on_target",
      shot_on_target: "shots_on_target",
      attacks: "attacks",
      attack: "attacks",
      dangerous_attacks: "dangerous_attacks",
      dangerous_attack: "dangerous_attacks",
      possession: "possession",
      ball_possession: "possession",
      corners: "corners",
      corner: "corners",
      penalties: "penalties",
      penalty: "penalties"
    };

    function decodeBase64(value) {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }

    function readableText(bytes) {
      try {
        const value = new TextDecoder("utf-8", { fatal: true })
          .decode(bytes)
          .replace(/\u0000/g, "")
          .trim();
        if (value.length < 2 || value.length > 240) return null;
        const visible = [...value].filter(
          (char) => !/[\u0000-\u0008\u000e-\u001f\u007f]/.test(char)
        ).length;
        return visible / value.length >= 0.92 ? value : null;
      } catch {
        return null;
      }
    }

    function collectProtoText(
      bytes,
      start = 0,
      end = bytes.length,
      depth = 0,
      path = [],
      endpoint = null
    ) {
      if (depth > 12 || start >= end) return;
      let position = start;
      while (position < end) {
        const key = readVarint(bytes, position, end);
        if (!key || !key.value) return;
        position = key.position;
        const field = Math.floor(key.value / 8);
        const wire = key.value % 8;
        if (wire === 0) {
          const item = readVarint(bytes, position, end);
          if (!item) return;
          numberRecords.push({
            endpoint,
            path: [...path, field].join("."),
            value: item.value
          });
          position = item.position;
        } else if (wire === 1) {
          position += 8;
        } else if (wire === 2) {
          const size = readVarint(bytes, position, end);
          if (!size) return;
          position = size.position;
          const nestedEnd = position + size.value;
          if (nestedEnd > end) return;
          const text = readableText(bytes.subarray(position, nestedEnd));
          if (text) {
            textTokens.add(text);
            textRecords.push({
              endpoint,
              path: [...path, field].join("."),
              text
            });
          }
          collectProtoText(
            bytes,
            position,
            nestedEnd,
            depth + 1,
            [...path, field],
            endpoint
          );
          position = nestedEnd;
        } else if (wire === 5) {
          position += 4;
        } else {
          return;
        }
        if (position > end) return;
      }
    }

    function readVarint(bytes, position, limit) {
      let value = 0;
      let shift = 0;
      let cursor = position;
      while (cursor < limit && shift <= 49) {
        const byte = bytes[cursor];
        value += (byte & 0x7f) * 2 ** shift;
        cursor += 1;
        if ((byte & 0x80) === 0) return { value, position: cursor };
        shift += 7;
      }
      return null;
    }

    function scanProtoMessage(bytes, start = 0, end = bytes.length, depth = 0) {
      if (depth > 12 || start >= end) return false;
      const fields = new Map();
      let position = start;
      while (position < end) {
        const key = readVarint(bytes, position, end);
        if (!key || !key.value) return false;
        position = key.position;
        const field = Math.floor(key.value / 8);
        const wire = key.value % 8;
        if (!field || field > 100000) return false;
        if (wire === 0) {
          const item = readVarint(bytes, position, end);
          if (!item) return false;
          position = item.position;
          if (!fields.has(field)) fields.set(field, item.value);
        } else if (wire === 1) {
          position += 8;
        } else if (wire === 2) {
          const size = readVarint(bytes, position, end);
          if (!size) return false;
          position = size.position;
          const nestedEnd = position + size.value;
          if (nestedEnd > end) return false;
          scanProtoMessage(bytes, position, nestedEnd, depth + 1);
          position = nestedEnd;
        } else if (wire === 5) {
          position += 4;
        } else {
          return false;
        }
        if (position > end) return false;
      }
      const type = Number(fields.get(1));
      if (
        NAMI_STAT_TYPES[type] &&
        (fields.has(2) || fields.has(3))
      ) {
        statistics[NAMI_STAT_TYPES[type]] = {
          home: Number(fields.get(2) || 0),
          away: Number(fields.get(3) || 0)
        };
      }
      return position === end;
    }

    function walk(value) {
      if (!value) return;
      if (Array.isArray(value)) {
        if (
          value.length >= 3 &&
          Number.isFinite(Number(value[0])) &&
          NAMI_STAT_TYPES[Number(value[0])]
        ) {
          const pair = numberPair(value[1], value[2]);
          if (pair) statistics[NAMI_STAT_TYPES[Number(value[0])]] = pair;
        }
        for (const item of value) walk(item);
        return;
      }
      if (typeof value === "string") {
        const text = value.trim();
        if (text.length >= 2 && text.length <= 240) textTokens.add(text);
        return;
      }
      if (typeof value !== "object") return;

      const type = Number(value.type ?? value.type_id ?? value.stat_type);
      const typedPair = numberPair(
        value.home ?? value.home_value ?? value.home_num,
        value.away ?? value.away_value ?? value.away_num
      );
      if (NAMI_STAT_TYPES[type] && typedPair) {
        statistics[NAMI_STAT_TYPES[type]] = typedPair;
      }

      for (const [key, item] of Object.entries(value)) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "_");
        const target = namedKeys[normalized];
        if (target && item && typeof item === "object") {
          const pair = numberPair(
            item.home ?? item.home_value ?? item[0],
            item.away ?? item.away_value ?? item[1]
          );
          if (pair) statistics[target] = pair;
        }
        walk(item);
      }
    }

    for (const [endpoint, payload] of Object.entries(
      apiResult?.endpoints || {}
    )) {
      rawByEndpoint[endpoint] = payload;
      const data = payload?.data;
      if (data?.encoding === "base64" && data.body) {
        // `vd` is the live statistics payload. The detail and incident
        // payloads reuse the same protobuf field numbers for unrelated data.
        const bytes = decodeBase64(data.body);
        collectProtoText(bytes, 0, bytes.length, 0, [], endpoint);
        if (endpoint === "vd") scanProtoMessage(bytes);
      } else {
        walk(data);
      }
    }

    // Nami reports shots on/off target separately.
    if (statistics.shots_on_target || statistics.shots_off_target) {
      const onTarget = statistics.shots_on_target || { home: 0, away: 0 };
      const offTarget = statistics.shots_off_target || { home: 0, away: 0 };
      statistics.shots = {
        home: onTarget.home + offTarget.home,
        away: onTarget.away + offTarget.away
      };
    }
    const tokens = [...textTokens]
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const weatherPattern =
      /^(?:晴|阴|多云|局部有云|阵雨|小雨|中雨|大雨|雷阵雨|小雪|中雪|大雪|雨夹雪|多云有雨)$|(?:天气|气温|温度|湿度|风速|风向|降雨)|^-?\d+(?:\.\d+)?\s*(?:°C|℃|m\/s|km\/h|mmHg|hPa|%)$/i;
    const incidentPattern =
      /进球|射门|射正|角球|黄牌|红牌|换人|替补|点球|受伤|伤停|中场|上半场|下半场|(?:^|\s)VAR(?:\s|$)/i;
    const lineupPattern =
      /首发|替补|阵容|阵型|守门员|门将|后卫|中场|前锋|教练|formation|lineup/i;
    const assetPattern =
      /(?:^|\/)[a-f0-9]{24,}\.(?:png|jpe?g|webp)$|football\/|jersey\//i;
    const metricPattern =
      /^-?\d+(?:\.\d+)?(?:%|°C|℃|m\/s|km\/h|mmHg|hPa)?$/i;
    const playerCandidates = tokens.filter((value) => {
      if (assetPattern.test(value) || metricPattern.test(value)) return false;
      if (weatherPattern.test(value) || lineupPattern.test(value)) return false;
      if (value.length < 2 || value.length > 48) return false;
      if (/https?:|足球|杯|联赛|超级|甲级|乙级|女足|U\d+/i.test(value)) {
        return false;
      }
      return /^[\p{L}][\p{L}\p{M} .·'’-]*$/u.test(value);
    });
    return {
      statistics,
      rawByEndpoint,
      context: {
        text_tokens: tokens,
        text_records: textRecords,
        number_records: numberRecords,
        weather_text: tokens.filter((value) => weatherPattern.test(value)),
        live_text: tokens.filter((value) => incidentPattern.test(value)),
        lineup_text: tokens.filter((value) => lineupPattern.test(value)),
        player_candidates: playerCandidates,
        coverage: {
          text_tokens: tokens.length > 0,
          weather: tokens.some((value) => weatherPattern.test(value)),
          live_text: tokens.some((value) => incidentPattern.test(value)),
          lineup: tokens.some((value) => lineupPattern.test(value)),
          player_candidates: playerCandidates.length > 0
        }
      }
    };
  }

  async function collectStatisticsApi(event) {
    return new Promise((resolve) => {
      const frame = document.createElement("iframe");
      frame.src = `https://widget.namitiyu.com/football?id=${encodeURIComponent(
        event.id
      )}`;
      frame.style.cssText =
        "position:fixed;width:2px;height:2px;left:-20px;bottom:-20px;opacity:.01;border:0";
      chrome.runtime.sendMessage(
        {
          type: "CODEX_COLLECT_LIVE_API",
          match_id: event.id
        },
        (response) => {
          frame.remove();
          if (chrome.runtime.lastError) {
            resolve({
              available: false,
              reason: chrome.runtime.lastError.message
            });
            return;
          }
          resolve(response || { available: false, reason: "empty_api_response" });
        }
      );
      document.documentElement.appendChild(frame);
    });
  }

  async function collectDetailApi(event, requireInterfaceRuntime = false) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "CODEX_COLLECT_LEISU_DETAIL_API",
          match_id: event.id,
          require_interface_runtime: requireInterfaceRuntime
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              available: false,
              reason: chrome.runtime.lastError.message,
              responses: {}
            });
            return;
          }
          resolve(response || {
            available: false,
            reason: "empty_detail_api_response",
            responses: {}
          });
        }
      );
    });
  }

  // Legacy detail export: DOM-only fields. Interface migration is intentionally excluded.
  async function enrichLegacyDetailDom(event, index, total) {
    try {
      const result = await collectDetailApi(event);
      const responses = result?.responses || {};
      const domLive = responses["dom:text-live"]?.data?.body;
      const domAnalysis = responses["dom:data-analysis"]?.data?.body;
      const domOdds = responses["dom:odd-panel"]?.data?.body;

      if (Array.isArray(domLive?.entries)) {
        event._live_text = {
          available: domLive.entries.length > 0,
          source: "leisu_detail_dom",
          source_selector: domLive.source_selector || null,
          source_type: domLive.source_type || "official_text_live_filtered",
          chat_content_excluded: domLive.chat_content_excluded === true,
          captured_at: domLive.captured_at || null,
          entries: domLive.entries
        };
      }
      event._historical_analysis = domAnalysis || {
        available: false,
        reason: "detail_data_analysis_not_exposed"
      };
      event._detail_odds_panel = domOdds || {
        available: false,
        reason: "detail_odd_panel_not_exposed",
        panels: []
      };
      if (domOdds?.available && Array.isArray(domOdds.panels)) {
        event.odds = {
          source: "leisu_detail_odd_panel",
          detail_page: domOdds
        };
      }
      const statisticsAvailable = Boolean(event._statistics && Object.keys(event._statistics).length);
      const eventsAvailable = Boolean(event._live_text?.available);
      event.detail_available = statisticsAvailable && eventsAvailable;
      event.detail_components = {
        ...(event.detail_components || {}),
        events: eventsAvailable,
        historical_analysis: Boolean(event._historical_analysis?.available),
        odds_detail: Boolean(event._detail_odds_panel?.available)
      };
    } catch (error) {
      event.detail_available = false;
    }
  }

  async function enrichAllLegacyDetailDom(events) {
    const concurrency = Math.min(detailConcurrency(), Math.max(1, events.length));
    for (let index = 0; index < events.length; index += concurrency) {
      const batch = events.slice(index, index + concurrency);
      await Promise.all(batch.map((event, offset) =>
        enrichLegacyDetailDom(event, index + offset, events.length)
      ));
    }
  }

  async function enrichStatistics(event, index, total) {
    button.textContent = `接口读取 ${index + 1}/${total}`;
    try {
      const apiResult = await collectStatisticsApi(event);
      const parsed = parseNamiStatistics(apiResult);
      event._weather = {
        available: parsed.context.coverage.weather,
        text: parsed.context.weather_text
      };
      event._live_text = {
        available: parsed.context.coverage.live_text,
        entries: parsed.context.live_text
      };
      const recordsAt = (path) =>
        parsed.context.text_records
          .filter((item) => item.path === path)
          .map((item) => item.text);
      const numbersAt = (path) =>
        parsed.context.number_records
          .filter((item) => item.path === path)
          .map((item) => Number(item.value));
      const uniqueNames = (items) =>
        [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
      const matchHomePlayers = uniqueNames(recordsAt("2.7.1.10"));
      const matchAwayPlayers = uniqueNames(recordsAt("2.7.2.10"));
      const squadHomePlayers = uniqueNames(recordsAt("2.11.2"));
      const squadAwayPlayers = uniqueNames(recordsAt("2.12.2"));
      const hasMatchLineup =
        matchHomePlayers.length >= 7 && matchAwayPlayers.length >= 7;
      const structuredPlayers = (side, names) => {
        const ids = numbersAt(`2.7.${side}.1`).slice(0, names.length);
        const shirts = numbersAt(`2.7.${side}.3`).slice(0, names.length);
        const x = numbersAt(`2.7.${side}.6`).slice(0, 11);
        const y = numbersAt(`2.7.${side}.7`).slice(0, 11);
        return names.map((name, index) => ({
          id: ids[index] || null,
          name,
          shirt_number: shirts[index] ?? null,
          starter: index < 11,
          substitute: index >= 11,
          formation_coordinate:
            index < 11 && x[index] != null && y[index] != null
              ? { x: x[index], y: y[index] }
              : null
        }));
      };
      const homeStructured = hasMatchLineup
        ? structuredPlayers(1, matchHomePlayers)
        : [];
      const awayStructured = hasMatchLineup
        ? structuredPlayers(2, matchAwayPlayers)
        : [];
      event._lineups = {
        available: hasMatchLineup,
        source: hasMatchLineup ? "namitiyu_api_match_lineup" : "not_obtained",
        home: {
          team: event.homeTeam?.name || null,
          players: hasMatchLineup ? homeStructured : [],
          starters: homeStructured.filter((item) => item.starter),
          substitutes: homeStructured.filter((item) => item.substitute)
        },
        away: {
          team: event.awayTeam?.name || null,
          players: hasMatchLineup ? awayStructured : [],
          starters: awayStructured.filter((item) => item.starter),
          substitutes: awayStructured.filter((item) => item.substitute)
        },
        entries: hasMatchLineup ? parsed.context.lineup_text : [],
        status: hasMatchLineup
          ? "home_away_mapped_role_mapping_pending"
          : "not_obtained"
      };
      if (Object.keys(parsed.statistics).length) {
        event._statistics = parsed.statistics;
        event._statistics_source = "namitiyu_api";
        return;
      }
    } catch (error) {
    }
    event._statistics ||= {};
    event._statistics_source = "namitiyu_api_unavailable";
  }


  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const value = JSON.parse(raw);
      if (!Array.isArray(value)) return [];
      return value.filter(
        (item) => item && typeof item === "object" && typeof item.timestamp === "number"
      );
    } catch {
      localStorage.removeItem(HISTORY_KEY); // 数据损坏时自动重置
      return [];
    }
  }

  function metricDelta(current, previous) {
    const output = {};
    for (const key of [
      "shots",
      "shots_on_target",
      "attacks",
      "dangerous_attacks",
      "penalties"
    ]) {
      if (!current[key] || !previous[key]) continue;
      const home = current[key].home - previous[key].home;
      const away = current[key].away - previous[key].away;
      if (home < 0 || away < 0) return null;
      output[key] = { home, away };
    }
    return output;
  }

  function timelineTrendFallback(event, minutes) {
    const currentMinute = Number(event._minute);
    const entries = event._live_text?.entries || [];
    if (!Number.isFinite(currentMinute) || !entries.length) return null;
    const startMinute = Math.max(0, currentMinute - minutes);
    const home = clean(event.homeTeam?.name);
    const away = clean(event.awayTeam?.name);
    const metrics = Object.fromEntries(
      ["shots", "shots_on_target", "corners", "goals", "yellow_cards", "red_cards", "substitutions"]
        .map((key) => [key, { home: 0, away: 0 }])
    );
    const observed = [];
    let pendingMinute = null;
    for (const rawEntry of entries) {
      const text = clean(rawEntry);
      const clockOnly = text.match(/^(\d{1,3})\s*['’]$/);
      if (clockOnly) {
        pendingMinute = Number(clockOnly[1]);
        continue;
      }
      const embedded = text.match(/(?:^|\D)(\d{1,3})\s*(?:['’]|分钟)/);
      const minute = embedded ? Number(embedded[1]) : pendingMinute;
      if (!Number.isFinite(minute) || minute <= startMinute || minute > currentMinute) continue;
      const homeMentioned = home && text.includes(home);
      const awayMentioned = away && text.includes(away);
      const side = homeMentioned !== awayMentioned ? (homeMentioned ? "home" : "away") : null;
      const categories = [];
      if (/进球|破门|球进啦|乌龙球/i.test(text)) categories.push("goals");
      if (/射门|打门|攻门|头球|单刀/i.test(text)) categories.push("shots");
      if (/射正|扑住|扑出|破门|球进啦/i.test(text) && categories.includes("shots")) categories.push("shots_on_target");
      if (/角球/i.test(text)) categories.push("corners");
      if (/黄牌/i.test(text)) categories.push("yellow_cards");
      if (/红牌/i.test(text)) categories.push("red_cards");
      if (/换人|替补/i.test(text)) categories.push("substitutions");
      for (const category of [...new Set(categories)]) {
        if (side) metrics[category][side] += 1;
      }
      if (categories.length) observed.push({ minute, side, categories: [...new Set(categories)], text });
      pendingMinute = null;
    }
    return {
      available: true,
      source: "leisu_text_timeline",
      coverage: "incident_timeline",
      window_start_minute: startMinute,
      window_end_minute: currentMinute,
      events_observed: observed.length,
      events: observed,
      ...metrics
    };
  }

  function attachTrends(events, history, now) {
    for (const event of events) {
      const snapshots = history.filter((item) => item.id === event.id);
      const trends = {};
      for (const minutes of [5, 15]) {
        const target = now - minutes * 60 * 1000;
        const prior = snapshots
          .filter((item) => item.timestamp <= target)
          .sort((a, b) => b.timestamp - a.timestamp)[0];
        const activeMinutes =
          prior && Number.isFinite(event._minute) && Number.isFinite(prior.minute)
            ? event._minute - prior.minute
            : 0;
        const hasEnoughActivePlay = activeMinutes >= Math.max(1, minutes - 2);
        const delta =
          prior && hasEnoughActivePlay
            ? metricDelta(event._statistics, prior.statistics)
            : {};
        trends[`last_${minutes}_minutes`] =
          prior && hasEnoughActivePlay && delta && Object.keys(delta).length
            ? {
              available: true,
              baseline_timestamp: prior.timestamp,
              ...delta
            }
            : {
              available: false,
              reason: !prior
                ? "no_baseline"
                : !hasEnoughActivePlay
                  ? "insufficient_active_play"
                  : "statistics_regressed"
            };
        const currentTrend = trends[`last_${minutes}_minutes`];
        if (!currentTrend.available && currentTrend.reason !== "statistics_regressed") {
          const fallback = timelineTrendFallback(event, minutes);
          if (fallback) trends[`last_${minutes}_minutes`] = fallback;
        }
      }
      event._recent_trends = trends;
      event.trend = trends;
    }
  }

  function saveHistory(events, history, now) {
    const cutoff = now - 3 * 60 * 60 * 1000;
    const retained = history.filter((item) => item.timestamp >= cutoff);
    for (const event of events) {
      retained.push({
        id: event.id,
        timestamp: now,
        minute: event._minute,
        score: {
          home: event.homeScore.current,
          away: event.awayScore.current
        },
        statistics: event._statistics
      });
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(retained.slice(-1200)));
  }

  function sectionRows(mode) {
    const selector = mode === "live" ? ".dd-live-title" : ".dd-notStart-title, .dd-finished-title";
    const rows = new Set();
    for (const title of document.querySelectorAll(selector)) {
      const panel = title.nextElementSibling;
      if (!panel?.matches("div.mod")) continue;
      for (const row of panel.querySelectorAll(".dd-item.data")) rows.add(row);
    }
    return [...rows];
  }

  function allMatchRows() {
    const rows = new Set(document.querySelectorAll(".dd-item.data"));
    const anchors = document.querySelectorAll(
      [
        'a[href*="/detail-"]',
        'a[href*="/data/zuqiu/team-"]',
        'a[href*="/team-"]'
      ].join(",")
    );
    for (const anchor of anchors) {
      const row = anchor.closest(
        [
          ".dd-item",
          "tr",
          "li",
          '[class*="match-item"]',
          '[class*="event-item"]',
          '[class*="list-item"]'
        ].join(",")
      );
      if (row) rows.add(row);
    }
    return [...rows];
  }

  function candidateRows(mode = null) {
    if (selectionMode) return allMatchRows();
    if (mode === "live" || mode === "prematch") return sectionRows(mode);
    const sectionCandidates = [...sectionRows("live"), ...sectionRows("prematch")];
    if (sectionCandidates.length) return [...new Set(sectionCandidates)];
    const rows = new Set(document.querySelectorAll(".dd-item.data"));
    const anchors = document.querySelectorAll(
      [
        'a[href*="/detail-"]',
        'a[href*="/data/zuqiu/team-"]',
        'a[href*="/team-"]'
      ].join(",")
    );
    for (const anchor of anchors) {
      const row = anchor.closest(
        [
          ".dd-item",
          "tr",
          "li",
          '[class*="match-item"]',
          '[class*="event-item"]',
          '[class*="list-item"]'
        ].join(",")
      );
      if (row) rows.add(row);
    }
    return [...rows];
  }

  function exportLimit() {
    const value = Number(document.getElementById(LIMIT_ID)?.value || 10);
    return Math.max(1, Math.min(100, Number.isFinite(value) ? Math.floor(value) : 10));
  }

  function detailConcurrency() {
    const value = Number(document.getElementById(CONCURRENCY_ID)?.value || 2);
    return Math.max(1, Math.min(10, Number.isFinite(value) ? Math.floor(value) : 2));
  }

  function markSelectedRows() {
    for (const row of allMatchRows()) {
      const event = parseRow(row);
      if (!event) continue;
      const eventId = String(event.id);
      const selected = selectedEventIds.has(eventId);
      row.dataset.codexLeisuEventId = eventId;
      let checkbox = row.querySelector(":scope > .codex-leisu-match-checkbox");
      if (!checkbox) {
        checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "codex-leisu-match-checkbox";
        checkbox.title = "勾选后只导出所选比赛";
        checkbox.style.cssText = [
          "position:absolute",
          "left:4px",
          "top:50%",
          "transform:translateY(-50%)",
          "z-index:2147483646",
          "width:18px",
          "height:18px",
          "cursor:pointer",
          "accent-color:#ff9800"
        ].join(";");
        checkbox.addEventListener("click", (clickEvent) => clickEvent.stopPropagation());
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selectedEventIds.add(eventId);
          else selectedEventIds.delete(eventId);
          selectButton.textContent = `完成选择（已选${selectedEventIds.size}场）`;
          showStatus(`已勾选${selectedEventIds.size}场；有勾选时只导出这些比赛。`);
          markSelectedRows();
        });
        if (getComputedStyle(row).position === "static") row.style.position = "relative";
        row.appendChild(checkbox);
      }
      checkbox.style.display = selectionMode ? "block" : "none";
      checkbox.checked = selected;
      row.style.outline = selected ? "3px solid #ff9800" : "";
      row.style.outlineOffset = selected ? "-3px" : "";
    }
  }

  function toggleSelectionMode() {
    selectionMode = !selectionMode;
    selectButton.textContent = selectionMode
      ? `完成选择（已选${selectedEventIds.size}场）`
      : `手动选择比赛（已选${selectedEventIds.size}场）`;
    selectButton.style.background = selectionMode ? "#d97706" : "#455a64";
    showStatus(
      selectionMode
        ? "选择模式：每场左侧已显示复选框，勾选需要导出的比赛；橙色边框表示已选择。"
        : selectedEventIds.size
          ? `已保留${selectedEventIds.size}场手动选择；导出时只处理这些比赛。`
          : `未手动选择；导出时最多处理${exportLimit()}场。`
    );
    markSelectedRows();
  }

  document.addEventListener(
    "click",
    (event) => {
      if (!selectionMode || event.target.closest?.(`.codex-leisu-match-checkbox,#${SELECT_ID},#${BUTTON_ID},#${PREMATCH_BUTTON_ID},#${LIMIT_ID}`)) {
        return;
      }
      const row = event.target.closest?.(
        ".dd-item.data,.dd-item,tr,li,[class*='match-item'],[class*='event-item'],[class*='list-item']"
      );
      if (!row) return;
      const parsed = parseRow(row);
      if (!parsed) return;
      event.preventDefault();
      event.stopPropagation();
      const id = String(parsed.id);
      if (selectedEventIds.has(id)) selectedEventIds.delete(id);
      else selectedEventIds.add(id);
      selectButton.textContent = `完成选择（已选${selectedEventIds.size}场）`;
      showStatus(`选择模式：已选${selectedEventIds.size}场；再次点击比赛可取消。`);
      markSelectedRows();
    },
    true
  );

  async function collect(mode, shouldDownload, includeOddsDetails = false) {
    if (collecting) return;
    collecting = true;
    const collectionStartedAt = Date.now();
    try {
      const rows = candidateRows(mode);
      if (!rows.length) {
        throw new Error(
          mode === "live"
            ? "未找到“正在进行中的比赛”标题后的div.mod滚球列表。"
            : "未找到“未开始的比赛”标题后的div.mod赛前列表。"
        );
      }
      const byId = new Map();
      const rowById = new Map();
      const unparsedRows = [];
      for (const row of rows) {
        const event = parseRow(row, mode);
        if (event) {
          byId.set(event.id, event);
          rowById.set(event.id, row);
        } else {
          unparsedRows.push({
            text: clean(row.innerText || row.textContent),
            html: row.outerHTML.slice(0, 16000)
          });
        }
      }
      const parsedEvents = [...byId.values()];
      const events = parsedEvents.filter((event) => {
        const value = [
          event.tournament?.name,
          event.homeTeam?.name,
          event.awayTeam?.name
        ]
          .filter(Boolean)
          .join(" ");
        return !value.includes("梦幻对垒")
          && !value.includes("瓦尔哈拉杯")
          && !value.includes("开云")
          && !/(?:^|\s)VS\s*[-－]/i.test(value)
          && !/(?:^|\D)(?:8|10|12)分钟(?:\D|$)/.test(value);
      });
      const eligibleEvents = events;
      const limit = exportLimit();
      const manuallyMatchedEvents = selectedEventIds.size
        ? eligibleEvents.filter((event) => selectedEventIds.has(String(event.id)))
        : [];
      // `limit` is a hard request/page budget. Manual selection chooses which
      // matches have priority, but may never bypass the configured maximum.
      const selectedEvents = selectedEventIds.size
        ? manuallyMatchedEvents.slice(0, limit)
        : eligibleEvents.slice(0, limit);
      if (!selectedEvents.length) {
        throw new Error(
          selectedEventIds.size
            ? "当前滚球/赛前页面没有找到已手动选择的比赛，请检查比赛状态。"
            : "未检测到有效比赛，请确认页面加载完成。"
        );
      }
      showStatus(`本次只读取${selectedEvents.length}场详情（可选${eligibleEvents.length}场）…`);
      for (const event of selectedEvents) {
        event.odds = await captureOdds(rowById.get(event.id));
      }
      const liveEvents = mode === "live" ? selectedEvents : [];
      const detailEvents = mode === "prematch" ? selectedEvents : liveEvents;
      if (shouldDownload && mode === "live") {
        // Current handicap and total snapshots are already available on the
        // live list. Do not open a second odds page for every selected match.
        for (const event of liveEvents) {
          event.odds ||= {};
          event.odds.detail = {
            available: false,
            reason: "skipped_to_respect_detail_page_limit",
            source: "leisu_live_list_snapshot"
          };
        }
        await Promise.all([
          enrichAllStatistics(liveEvents),
          enrichAllLegacyDetailDom(liveEvents)
        ]);
      } else if (mode === "prematch" && shouldDownload) {
        await Promise.all([
          enrichAllStatistics(detailEvents),
          enrichAllLegacyDetailDom(detailEvents)
        ]);
      }
      const now = Date.now();
      const history = loadHistory();
      attachTrends(liveEvents, history, now);
      saveHistory(liveEvents, history, now);
      if (shouldDownload) {
        const exportEvents = selectedEvents;
        for (const event of selectedEvents) {
          normalizeCardStatistics(event);
          sanitizeLineups(event);
          const statisticsAvailable = Boolean(
            event._statistics && Object.keys(event._statistics).length
          );
          const eventEntries = event._live_text?.entries || [];
          if (event._live_text) {
            event._live_text.timed_entries = buildTimedLiveEvents(eventEntries);
          }
          const eventsAvailable = eventEntries.length > 0;
          const lineupAvailable = Boolean(event._lineups?.available);
          const weatherAvailable = Boolean(event._weather?.available);
          const oddsDetailAvailable = Boolean(
            event._detail_odds_panel?.available || event.odds?.detail?.available
          );
          const historicalAnalysisAvailable = Boolean(event._historical_analysis?.available);
          event.detail_available = mode === "live"
            ? statisticsAvailable && eventsAvailable
            : false;
          event.detail_components = {
            statistics: statisticsAvailable,
            events: eventsAvailable,
            lineups: lineupAvailable,
            weather: weatherAvailable,
            odds_detail: oddsDetailAvailable,
            historical_analysis: historicalAnalysisAvailable
          };
          event.trend = event.trend || event._recent_trends || {
            last_5_minutes: { available: false, reason: "not_available" },
            last_15_minutes: { available: false, reason: "not_available" }
          };
          const injuryEntries = eventEntries.filter((entry) =>
            /受伤|伤停(?!补时)|伤退|身体不适|队医|injur/i.test(String(entry))
          );
          event.analysis_data = {
            availability: {
              score: event.score_verified === true,
              weather: weatherAvailable,
              formal_lineup: lineupAvailable,
              technical_statistics: statisticsAvailable,
              match_events: eventsAvailable,
              historical_analysis: historicalAnalysisAvailable,
              detail_odds: oddsDetailAvailable
            },
            realtime_score: {
              home: event.homeScore?.current ?? null,
              away: event.awayScore?.current ?? null,
              minute: event._minute ?? null,
              status: event.status?.type || null,
              source: event.score_source || event._score_source || null,
              verified: event.score_verified === true
            },
            weather: {
              available: weatherAvailable,
              text: event._weather?.text || []
            },
            lineups: {
              formal_available: lineupAvailable,
              status: event._lineups?.status || null,
              home_starters: (event._lineups?.home?.starters || []).map((player) => player.name || player),
              away_starters: (event._lineups?.away?.starters || []).map((player) => player.name || player),
              home_starter_details: event._lineups?.home?.starters || [],
              away_starter_details: event._lineups?.away?.starters || [],
              home_substitutes: event._lineups?.home?.substitutes || [],
              away_substitutes: event._lineups?.away?.substitutes || [],
              formation_coordinates_available: Boolean(
                event._lineups?.home?.starters?.some((player) => player.formation_coordinate) ||
                event._lineups?.away?.starters?.some((player) => player.formation_coordinate)
              ),
              formation_name: null,
              home_squad_count: (event._lineups?.home?.players || []).length,
              away_squad_count: (event._lineups?.away?.players || []).length,
              raw_path: "_lineups"
            },
            injuries: {
              available: injuryEntries.length > 0,
              entries: injuryEntries,
              note: injuryEntries.length ? null : "雷速本场文字直播未提供明确伤停事件"
            },
            technical_statistics: {
              available: statisticsAvailable,
              source: event._statistics_source || null,
              data: event._statistics || {},
              possession: event._statistics?.possession || null,
              attacks: event._statistics?.attacks || null,
              dangerous_attacks: event._statistics?.dangerous_attacks || null,
              shots: event._statistics?.shots || null,
              shots_on_target: event._statistics?.shots_on_target || null,
              corners: event._statistics?.corners || null,
              penalties: event._statistics?.penalties || null,
              yellow_cards: event._statistics?.yellow_cards || null,
              red_cards: event._statistics?.red_cards || null
            },
            match_events: {
              available: eventsAvailable,
              count: eventEntries.length,
              entries: eventEntries,
              timed_entries: buildTimedLiveEvents(eventEntries),
              source_type: event._live_text?.source_type || "unclassified_text_source",
              source_selector: event._live_text?.source_selector || null,
              chat_content_excluded: event._live_text?.chat_content_excluded === true,
              note: "牌数和角球总数以technical_statistics为准；文字事件用于事件时间与过程分析"
            },
            trend: event.trend,
            historical_analysis: {
              available: historicalAnalysisAvailable,
              recent_form_status: event._historical_analysis?.recent_form_status || null,
              recent_form: event._historical_analysis?.recent_form || [],
              goal_distribution: event._historical_analysis?.goal_distribution || null,
              historical_trend: event._historical_analysis?.historical_trend || null,
              league_standings: event._historical_analysis?.league_standings || null,
              raw_path: "_historical_analysis"
            },
            odds: {
              source: event.odds?.source || null,
              current_available: Boolean(event.odds?.detail_page?.available),
              detail_available: oddsDetailAvailable,
              detail_page_panels: event._detail_odds_panel?.panels || [],
              opening_current_comparison_available: Boolean(
                event.odds?.detail?.normalized?.companies?.length ||
                event._detail_odds_panel?.panels?.some((panel) =>
                  panel.phases?.includes("初始") && panel.phases?.includes("即时")
                )
              ),
              movement_timeline_available: false,
              note: "可读取初盘与即时盘快照；没有带时间戳的连续赔率变化轨迹",
              raw_path: "odds"
            }
          };
        }
        const detailFailures = selectedEvents.filter((event) => !event.detail_available).length;
        const duration = Number(((now - collectionStartedAt) / 1000).toFixed(1));
        const summary = {
          scanned_count: rows.length,
          parsed_count: parsedEvents.length,
          success_count: selectedEvents.length - detailFailures,
          failure_count: unparsedRows.length + detailFailures,
          valid_count: eligibleEvents.length,
          selected_count: selectedEvents.length,
          manually_selected_count: selectedEventIds.size,
          requested_limit: limit,
          detail_concurrency: detailConcurrency(),
          selection_strategy: selectedEventIds.size ? "manual" : "first_n",
          filtered_count: parsedEvents.length - eligibleEvents.length,
          unparsed_count: unparsedRows.length,
          detail_success_count: selectedEvents.length - detailFailures,
          detail_failure_count: detailFailures,
          exported_count: exportEvents.length,
          duration_seconds: duration
        };
        download({
          schema_version: SCHEMA_VERSION,
          export_version: EXPORT_VERSION,
          source: "leisu",
          source_url: location.href,
          page_title: clean(document.title),
          provider: "leisu",
          export_mode: mode,
          export_profile: mode === "live" ? "full" : "prematch",
          collection_started_at: new Date(collectionStartedAt).toISOString(),
          captured_at: new Date(now).toISOString(),
          collection_duration_seconds: duration,
          count: exportEvents.length,
          prematch_count: mode === "prematch" ? selectedEvents.length : 0,
          live_count: liveEvents.length,
          candidate_row_count: rows.length,
          unparsed_count: unparsedRows.length,
          unparsed_rows: unparsedRows,
          summary,
          events: exportEvents
        }, mode);
        const detailMessage = detailFailures
          ? `；基础数据成功，详细数据未完整获取${detailFailures}场`
          : "；详情完整";
        showStatus(`导出完成：扫描${summary.scanned_count}｜成功${summary.success_count}｜失败${summary.failure_count}｜过滤${summary.filtered_count}｜导出${summary.exported_count}｜${duration}秒${detailMessage}`);
      }
    } catch (error) {
      showStatus(`导出失败：${error.message}`, true);
    } finally {
      collecting = false;
      setTimeout(() => {
        button.textContent = "导出滚球分析数据";
        prematchButton.textContent = "导出赛前分析数据";
      }, 3000);
    }
  }

  const collectLive = (shouldDownload, includeOddsDetails = false) =>
    collect("live", shouldDownload, includeOddsDetails);
  const exportLive = () => collectLive(true, true);
  const exportPrematch = () => collect("prematch", true);
  function collectScriptCandidates() {
    const seen = new Map();
    for (const mode of ["live", "prematch"]) {
      for (const row of candidateRows(mode)) {
        const event = parseRow(row, mode);
        if (event?.id) seen.set(String(event.id), event);
      }
    }
    return [...seen.values()];
  }
  function initialDetailPayload(detail) {
    const body = detail?.responses?.["payload:initial-detail"]?.data?.body;
    return body?.decoded && typeof body.decoded === "object" ? body.decoded : null;
  }
  function normalizeInitialPayloadTextLive(detail) {
    const source = initialDetailPayload(detail)?.match_detail?.tlive;
    if (!Array.isArray(source)) return [];
    return source.map((item) => ({
      main: item?.main ?? null,
      type: item?.type ?? null,
      position: item?.position ?? null,
      time: item?.time ?? null,
      data: item?.data ?? null
    })).filter((item) => item.data != null || item.time != null);
  }
  function normalizeInitialPayloadOdds(detail) {
    const root = initialDetailPayload(detail);
    const odds = root?.top_data?.match_odds || root?.match_odds;
    if (!odds) return null;
    // 解码后的当前结构使用 cid=2；兼容部分前端包暴露为 type=2 的同一公司标识。
    const select = (name) => (odds[name] || []).find((item) => Number(item?.cid ?? item?.type) === 2) || null;
    const values = (item, phase) => {
      if (!item) return null;
      if (phase === "initial") return Array.isArray(item.f) ? item.f : null;
      const nested = phase === "pregame" ? item.n : item.r;
      return Array.isArray(nested?.[0]) ? nested[0] : null;
    };
    const market = (item, names) => {
      const out = {};
      for (const phase of ["initial", "pregame", "live"]) {
        const row = values(item, phase);
        out[phase] = row ? Object.fromEntries(names.map((name, index) => [name, row[index] ?? null])) : null;
      }
      return out;
    };
    const asia = select("asia");
    const eu = select("eu");
    const bs = select("bs");
    const corner = select("corner");
    if (![asia, eu, bs, corner].some(Boolean)) return null;
    return {
      source: "initial_detail_payload.match_odds",
      company_id: 2,
      company_name: odds.coop?.["2"]?.name ?? null,
      phase_mapping: { initial: "f", pregame: "n[0]", live: "r[0]" },
      markets: {
        asian_handicap: { label: "让球", ...market(asia, ["home", "line", "away"]) },
        match_winner: { label: "胜负", ...market(eu, ["home", "draw", "away"]) },
        total_goals: { label: "总进球", ...market(bs, ["over", "line", "under"]) },
        corners: { label: "角球", ...market(corner, ["over", "line", "under"]) }
      }
    };
  }
  function parseDirectJsonResponse(detail, endpointPattern) {
    for (const [url, response] of Object.entries(detail?.responses || {})) {
      if (!endpointPattern.test(url)) continue;
      const plain = response?.data?.decrypted?.body;
      if (typeof plain !== "string") continue;
      try { return JSON.parse(plain); } catch { }
    }
    return null;
  }
  function normalizeDirectLineup(detail) {
    const source = parseDirectJsonResponse(detail, /match_lineup/i);
    if (!source) return null;
    const playerMap = new Map((source.players || []).map((item) => [String(item.id), item]));
    const normalizePlayer = (item) => {
      const profile = playerMap.get(String(item?.player_id ?? item?.id)) || {};
      return {
        player_id: item?.player_id ?? item?.id ?? profile.id ?? null,
        team_id: item?.team_id ?? profile.team_id ?? null,
        name: profile.name ?? item?.name ?? item?.player_name ?? null,
        status: item?.status ?? null,
        starter: item?.status === 1,
        captain: item?.captain ?? 0,
        shirt_number: item?.shirt_number ?? profile.shirt_number ?? null,
        position: profile.position ?? item?.position_name ?? null,
        position_name: item?.position_name ?? profile.position ?? null,
        position_code: profile.position_en ?? null,
        position_number: item?.position_num ?? null,
        x: item?.x ?? null,
        y: item?.y ?? null,
        rating: item?.rating ?? null,
        best_player: item?.is_best === 1,
        age: profile.age ?? null,
        height: profile.height ?? null,
        market_value: profile.market_value ?? null,
        market_value_text: profile.market_value_unit ?? null,
        incidents: Array.isArray(item?.incidents) ? item.incidents : []
      };
    };
    const normalizeManager = (item) => item ? {
      id: item.id ?? null,
      team_id: item.team_id ?? null,
      name: item.name ?? null,
      role: item.type_name ?? null
    } : null;
    return {
      source: "match_lineup",
      confirmed: source.confirmed ?? null,
      venue: source.venue ? {
        id: source.venue.id ?? null,
        name: source.venue.name ?? null,
        capacity: source.venue.capacity ?? null,
        city: source.venue.city ?? null,
        country: source.venue.country ?? null
      } : null,
      referee: source.referee ? {
        id: source.referee.id ?? null,
        name: source.referee.name ?? null,
        age: source.referee.age ?? null,
        country_name: source.referee.country_name ?? null
      } : null,
      home_formation: source.home_formation ?? null,
      away_formation: source.away_formation ?? null,
      home_manager: normalizeManager(source.home_manager),
      away_manager: normalizeManager(source.away_manager),
      home: (source.home || []).map(normalizePlayer),
      away: (source.away || []).map(normalizePlayer),
      home_injuries: (source.home_injury || []).map(normalizePlayer),
      away_injuries: (source.away_injury || []).map(normalizePlayer),
      home_market_value: source.home_market_value ?? null,
      away_market_value: source.away_market_value ?? null,
      home_average_age: source.home_avg_age ?? null,
      away_average_age: source.away_avg_age ?? null,
      has_coordinates: source.has_coordinates ?? null,
      has_stats: source.has_stats ?? null
    };
  }
  async function exportInterfaceData(includeEvidence = false) {
    if (collecting) return;
    const events = collectScriptCandidates().filter((event) => event.id);
    const ids = [...(selectedEventIds.size ? events.filter((e) => selectedEventIds.has(String(e.id))) : events.slice(0, exportLimit()))].map((e) => String(e.id));
    if (!ids.length) return showStatus("没有找到可导出的比赛ID", true);
    showStatus(`正在获取${ids.length}场比赛的详情页接口...`);
    collecting = true;
    const results = [];
    (async () => {
      try {
        for (const event of events.filter((item) => ids.includes(String(item.id)))) {
          const statistics = await collectStatisticsApi(event);
          const detail = await collectDetailApi(event, true);
          const decoded = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "CODEX_DECODE_INTERFACE_PAYLOADS", responses: statistics?.endpoints || {} }, (value) => {
              resolve(chrome.runtime.lastError ? {} : (value?.decoded_interface || {}));
            });
          });
          const analysisFields = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "CODEX_BUILD_MATCH_ANALYSIS_FIELDS", responses: detail?.responses || {} }, (value) => {
              resolve(chrome.runtime.lastError ? {} : (value || {}));
            });
          });
          const staticDetail = decoded?.d?.data || null;
          const liveDetail = decoded?.vd?.data || null;
          const rawStats = liveDetail?.stats?.itemsList || [];
          const statByCode = Object.fromEntries(rawStats.map((item) => [String(item.code ?? item.type), { home: item.home, away: item.away }]));
          const capturedTextLive = normalizeInitialPayloadTextLive(detail);
          const lineup = normalizeDirectLineup(detail);
          const formalOdds = normalizeInitialPayloadOdds(detail);
          const capturedOpeningOdds = formalOdds ? {
            source: formalOdds.source,
            asian_handicap: formalOdds.markets?.asian_handicap?.initial || null,
            match_winner: formalOdds.markets?.match_winner?.initial || null,
            total_goals: formalOdds.markets?.total_goals?.initial || null,
            corners: formalOdds.markets?.corners?.initial || null
          } : {
            source: null,
            asian_handicap: null,
            match_winner: null,
            total_goals: null,
            corners: null
          };
          const liveMatch = liveDetail ? {
            source: "/api/v3/f/vd",
            statistics_source: "/api/v3/f/vd",
            match_id: liveDetail.id ?? null,
            status_id: liveDetail.statusId ?? null,
            home_scores: liveDetail.homeScores || null,
            away_scores: liveDetail.awayScores || null,
            confirmed_statistics: {
              corners: statByCode["2"] || null,
              yellow_cards: statByCode["3"] || null,
              red_cards: statByCode["4"] || null,
              attacks: statByCode["23"] || null,
              dangerous_attacks: statByCode["24"] || null,
              possession: statByCode["25"] || null,
              shots_on_target: statByCode["21"] || null,
              shots_off_target: statByCode["22"] || null
            },
            text_live: capturedTextLive
          } : null;
          const completeness = {
            static_match: Boolean(staticDetail),
            live_match: Boolean(liveDetail),
            match_analysis: Boolean(analysisFields.parsed_match_analysis),
            text_live: capturedTextLive.length > 0,
            odds: Boolean(formalOdds),
            recent_matches: Boolean(analysisFields.recent_matches),
            league_standings: Boolean(analysisFields.league_standings),
            goal_distribution: Boolean(analysisFields.goal_distribution),
            trend_summary: Boolean(analysisFields.trend_summary),
            lineup: Boolean(lineup)
          };
          results.push({
            match_id: String(event.id),
            available: completeness.static_match && completeness.live_match && completeness.match_analysis,
            complete: Object.values(completeness).every(Boolean),
            completeness,
            formal: {
              static_match: staticDetail,
              live_match: liveMatch,
              opening_odds: capturedOpeningOdds,
              odds: formalOdds,
              analysis_match_context: analysisFields.analysis_match_context || null,
              head_to_head: analysisFields.head_to_head || [],
              future_schedule: analysisFields.future_schedule || null,
              recent_matches: analysisFields.recent_matches || { home: [], away: [] },
              league_standings: analysisFields.league_standings || null,
              goal_distribution: analysisFields.goal_distribution || null,
              trend_summary: analysisFields.trend_summary || null,
              lineup
            }
          });
          if (includeEvidence) {
            results[results.length - 1].evidence = {
              statistics_api: statistics,
              detail_api: detail,
              decoded_interface: decoded,
              parsed_match_analysis: analysisFields.parsed_match_analysis || null
            };
          }
        }
        const exportType = includeEvidence ? "leisu_interface_diagnostic" : "leisu_interface_data";
        download({ export_version: EXPORT_VERSION, export_type: exportType, captured_at: new Date().toISOString(), results }, includeEvidence ? "interface_diagnostic" : "interface_data");
        showStatus(`接口导出完成：成功${results.filter((item) => item.available).length}/${ids.length}场`);
      } catch (error) {
        showStatus(`接口导出失败：${error?.message || error}`, true);
      } finally {
        collecting = false;
      }
    })();
  }
  /*
   * 雷速详情页诊断工具：仅用于雷速改版后的解密与采集回归排查。
   * 会刷新当前详情页，并导出前端脚本、网络原始响应、运行时快照、
   * CryptoJS 与 soring 调用记录。它不参与“滚球接口获取导出”、
   * 不生成正式预测字段，也不用于列表页批量采集。
   */
  async function exportFullCurrentDetail() {
    const matchId = String(location.pathname.match(/detail-(\d+)/i)?.[1] || "");
    if (!matchId) return showStatus("请在雷速详情页使用此按钮", true);
    showStatus("正在采集当前详情页运行时数据...");
    const snapshot = await new Promise((resolve) => {
      const onMessage = (event) => {
        if (event.origin !== location.origin || event.source !== window || event.data?.source !== "codex-runtime-snapshot") return;
        clearTimeout(timer); window.removeEventListener("message", onMessage); resolve(event.data);
      };
      const timer = setTimeout(() => { window.removeEventListener("message", onMessage); resolve(null); }, 5000);
      window.addEventListener("message", onMessage);
      window.postMessage({ source: "codex-runtime-snapshot-request" }, location.origin);
    });
    if (!snapshot) return showStatus("未获取到详情页运行时数据", true);
    const scriptUrls = performance.getEntriesByType("resource").map((entry) => String(entry.name || ""));
    chrome.runtime.sendMessage({ type: "CODEX_EXPORT_FULL_CURRENT_DETAIL", match_id: matchId, script_urls: scriptUrls, snapshot }, (result) => {
      if (chrome.runtime.lastError) return showStatus(`完整采集失败：${chrome.runtime.lastError.message}`, true);
      download(result?.package || { match_id: matchId, snapshot }, "full_detail_capture");
      showStatus("当前详情页完整采集完成");
    });
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "CODEX_FULL_CAPTURE_RESULT" && message.package) {
      download(message.package, "full_detail_capture");
      showStatus("当前详情页完整采集完成");
    }
  });

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "导出滚球分析数据";
  button.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:66px",
    "z-index:2147483647",
    "padding:10px 14px",
    "border:0",
    "border-radius:8px",
    "background:#1677ff",
    "color:#fff",
    "font-weight:700",
    "cursor:pointer",
    "box-shadow:0 4px 16px rgba(0,0,0,.28)"
  ].join(";");
  button.style.setProperty("display", "block", "important");
  button.style.setProperty("visibility", "visible", "important");
  button.style.setProperty("opacity", "1", "important");
  button.addEventListener("click", exportLive);

  const prematchButton = document.createElement("button");
  prematchButton.id = PREMATCH_BUTTON_ID;
  prematchButton.type = "button";
  prematchButton.textContent = "导出赛前分析数据";
  prematchButton.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:114px",
    "z-index:2147483647",
    "padding:10px 14px",
    "border:0",
    "border-radius:8px",
    "background:#0f9d58",
    "color:#fff",
    "font-weight:700",
    "cursor:pointer",
    "box-shadow:0 4px 16px rgba(0,0,0,.28)"
  ].join(";");
  prematchButton.addEventListener("click", exportPrematch);
  const scriptButton = document.createElement("button");
  scriptButton.id = SCRIPT_BUTTON_ID;
  scriptButton.type = "button";
  scriptButton.textContent = "滚球接口获取导出";
  scriptButton.style.cssText = button.style.cssText.replace("bottom:66px", "bottom:162px").replace("#1677ff", "#8e44ad");
  scriptButton.addEventListener("click", () => exportInterfaceData(false));
  const interfaceDiagnosticButton = document.createElement("button");
  interfaceDiagnosticButton.id = INTERFACE_DIAGNOSTIC_BUTTON_ID;
  interfaceDiagnosticButton.type = "button";
  interfaceDiagnosticButton.textContent = "滚球接口诊断导出（正式+证据）";
  interfaceDiagnosticButton.style.cssText = button.style.cssText.replace("bottom:66px", "bottom:186px").replace("#1677ff", "#6d4c41");
  interfaceDiagnosticButton.addEventListener("click", () => exportInterfaceData(true));
  const fullCaptureButton = document.createElement("button");
  fullCaptureButton.id = FULL_CAPTURE_BUTTON_ID;
  fullCaptureButton.type = "button";
  fullCaptureButton.textContent = "诊断：完整采集当前详情页";
  fullCaptureButton.addEventListener("click", exportFullCurrentDetail);

  const limitBox = document.createElement("div");
  limitBox.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:162px",
    "z-index:2147483647",
    "padding:7px 10px",
    "border-radius:8px",
    "background:#263238",
    "color:#fff",
    "font:12px/1.4 Arial,sans-serif",
    "box-shadow:0 4px 16px rgba(0,0,0,.28)"
  ].join(";");
  limitBox.textContent = "最多导出 ";
  const limitInput = document.createElement("input");
  limitInput.id = LIMIT_ID;
  limitInput.type = "number";
  limitInput.min = "1";
  limitInput.max = "100";
  limitInput.value = "10";
  limitInput.style.cssText = "width:35px;padding:3px;margin:0 3px;border:0;border-radius:4px;box-sizing:border-box";
  limitInput.addEventListener("change", () => {
    limitInput.value = String(exportLimit());
    if (!selectedEventIds.size) showStatus(`未手动选择；本次最多导出${limitInput.value}场。`);
  });
  limitBox.append(limitInput, document.createTextNode(" 场"));

  const concurrencyInput = document.createElement("input");
  concurrencyInput.id = CONCURRENCY_ID;
  concurrencyInput.type = "number";
  concurrencyInput.min = "1";
  concurrencyInput.max = "10";
  concurrencyInput.value = "2";
  concurrencyInput.title = "同时打开的详情页数量（1-10）";
  concurrencyInput.style.cssText =
    "width:35px;padding:3px;margin:0 3px 0 8px;border:0;border-radius:4px;box-sizing:border-box";
  concurrencyInput.addEventListener("change", () => {
    concurrencyInput.value = String(detailConcurrency());
    showStatus(`详情页并发数已设为${concurrencyInput.value}；总详情页不超过导出场数。`);
  });
  limitBox.append(
    document.createTextNode(" 同时打开 "),
    concurrencyInput,
    document.createTextNode(" 页")
  );

  const selectButton = document.createElement("button");
  selectButton.id = SELECT_ID;
  selectButton.type = "button";
  selectButton.textContent = "手动选择比赛（已选0场）";
  selectButton.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:204px",
    "z-index:2147483647",
    "padding:8px 12px",
    "border:0",
    "border-radius:8px",
    "background:#455a64",
    "color:#fff",
    "font-weight:700",
    "cursor:pointer",
    "box-shadow:0 4px 16px rgba(0,0,0,.28)"
  ].join(";");
  selectButton.addEventListener("click", toggleSelectionMode);

  const controls = document.createElement("div");
  controls.id = "codex-leisu-export-controls";
  controls.style.cssText = "position:fixed;right:18px;bottom:55px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;width:260px;padding:10px;border-radius:10px;background:rgba(20,30,40,.94);box-shadow:0 4px 18px rgba(0,0,0,.35)";
  for (const node of [button, prematchButton, scriptButton, interfaceDiagnosticButton, fullCaptureButton, limitBox, selectButton]) {
    node.style.setProperty("position", "static", "important");
    node.style.setProperty("right", "auto", "important");
    node.style.setProperty("bottom", "auto", "important");
    node.style.setProperty("width", "100%", "important");
    controls.appendChild(node);
  }
  if (!document.getElementById("codex-leisu-export-controls")) document.documentElement.appendChild(controls);
  /*
  if (!document.getElementById(PREMATCH_BUTTON_ID)) {
    document.documentElement.appendChild(prematchButton);
  }
  */
  /* legacy individual mounting disabled: all controls live in the fixed container */
  // 页面局部刷新可能移除控件；滚球按钮必须始终存在。
  if (!document.getElementById(BUTTON_ID)) {
    document.body?.appendChild(button);
  }
  const selectionObserver = new MutationObserver(() => {
    if (selectionMode || selectedEventIds.size) markSelectedRows();
  });
  selectionObserver.observe(document.documentElement, { childList: true, subtree: true });
  showStatus("等待导出：默认最多10场，也可手动选择指定比赛。");

  // background.js 末尾添加
  /* chrome.tabs.onRemoved.addListener((tabId) => {
    // 清理 pendingLiveApi 中关联的 Tab
    for (const [matchId, pending] of pendingLiveApi.entries()) {
      if (pending.tabId === tabId) {
        finishLiveApi(matchId, "tab_closed_by_user");
      }
    }
    // 清理 pendingDetails 中关联的 Tab
    for (const [matchId, pending] of pendingDetails.entries()) {
      if (pending.tabId === tabId) {
        clearTimeout(pending.timer);
        pendingDetails.delete(matchId);
        pending.resolve({
          available: false,
          reason: "tab_closed_by_user"
        });
      }
    }
  }); */
})();
