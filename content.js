(() => {
  "use strict";

  const PANEL_ID = "codex-ybty-export-panel";
  const STATUS_ID = "codex-ybty-export-status";
  const MATCH_SELECTOR = ".c-match-item";
  const LEAGUE_SELECTOR = ".play-match-league";
  const COLUMN_SELECTOR = ".handicap-col";
  const BET_SELECTOR = ".c-bet-item";
  const SCHEMA_VERSION = 2;
  const EXPORT_VERSION = "2.8.0";
  const MARKET_LABELS = [
    { market: "half_h2h", patterns: [/半场.*(?:独赢|胜平负|1x2)/i] },
    { market: "half_spread", patterns: [/半场.*让球/i] },
    { market: "half_total", patterns: [/半场.*大小/i] },
    { market: "full_h2h", patterns: [/全场.*(?:独赢|胜平负|1x2)/i, /^独赢$/i, /^胜平负$/i] },
    { market: "full_spread", patterns: [/全场.*让球/i, /^让球$/i, /亚洲让球/i] },
    { market: "full_total", patterns: [/全场.*大小/i, /^大小球$/i, /总进球.*大小/i] },
    { market: "corner", patterns: [/^角球(?:盘口)?$/i, /角球.*(?:让球|大小)/i] },
    { market: "correct_score", patterns: [/波胆/i, /正确比分/i, /correct score/i] }
  ];

  let scanning = false;

  const sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  const clean = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();

  function text(root, selector) {
    return clean(root.querySelector(selector)?.textContent);
  }

  function findLeague(match) {
    let node = match;
    while (node) {
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.matches?.(LEAGUE_SELECTOR)) return leagueName(sibling);
        const nested = sibling.querySelector?.(LEAGUE_SELECTOR);
        if (nested) return leagueName(nested);
        sibling = sibling.previousElementSibling;
      }
      node = node.parentElement;
      if (!node || node === document.body) break;
    }
    return "";
  }

  function leagueName(element) {
    return clean(element.textContent).replace(/(?<=[\u3400-\u9fff])\d{1,3}$/, "");
  }

  function parseBet(item, index, market) {
    const selection = text(item, ".handicap-value-text");
    const odds = text(item, ".highlight-odds");
    const raw = clean(item.textContent);
    const explicitlySuspended =
      item.matches?.(".suspended,.disabled,.locked,[aria-disabled='true'],[data-suspended='true']") ||
      Boolean(item.querySelector?.(".suspended,.disabled,.locked,[aria-disabled='true'],[data-suspended='true']")) ||
      /暂停|封盘|停止投注|未开盘|暂无盘口/.test(raw);
    const sideHint = clean([
      item.getAttribute("data-side"),
      item.getAttribute("data-team"),
      item.getAttribute("aria-label"),
      item.className
    ].join(" "));
    let side = null;
    let sideVerified = false;
    let sideSource = null;
    if (/^大(?:\s|$)/.test(raw) || /\bover\b/i.test(sideHint)) {
      side = "over"; sideVerified = true; sideSource = "option_text";
    } else if (/^小(?:\s|$)/.test(raw) || /\bunder\b/i.test(sideHint)) {
      side = "under"; sideVerified = true; sideSource = "option_text";
    } else if (selection === "主" || /\bhome\b|主队/i.test(sideHint)) {
      side = "home"; sideVerified = true; sideSource = "option_text_or_dom";
    } else if (selection === "客" || /\baway\b|客队/i.test(sideHint)) {
      side = "away"; sideVerified = true; sideSource = "option_text_or_dom";
    } else if (selection === "平" || /\bdraw\b|平局/i.test(sideHint)) {
      side = "draw"; sideVerified = true; sideSource = "option_text_or_dom";
    } else if (/spread/.test(market || "") && index < 2) {
      side = index === 0 ? "home" : "away";
      sideVerified = true;
      sideSource = "paired_home_away_rows";
    }
    return {
      selection,
      line: /total/.test(market || "") ? selection : null,
      odds,
      side,
      side_verified: sideVerified,
      side_source: sideSource,
      suspended: Boolean(explicitlySuspended),
      market_data_available: Boolean(selection || odds),
      odds_temporarily_unavailable: !odds && !explicitlySuspended,
      text: raw
    };
  }

  function pageContext(mode) {
    const pageTitle = clean(document.title);
    const bodyHint = clean(
      [...document.querySelectorAll("h1,h2,h3,.page-title,.sport-title,.tab.active,[aria-selected='true']")]
        .slice(0, 20)
        .map((node) => node.textContent)
        .join(" ")
    );
    const combined = `${pageTitle} ${bodyHint}`;
    const detectedMode = /滚球|进行中|live|in[ -]?play/i.test(combined)
      ? "live"
      : /赛前|今日|未开赛|prematch|upcoming/i.test(combined)
        ? "prematch"
        : "unknown";
    return {
      page_title: pageTitle,
      page_hint: bodyHint,
      requested_mode: mode,
      detected_mode: detectedMode,
      mode_verified: detectedMode === mode,
      mode_conflict: detectedMode !== "unknown" && detectedMode !== mode
    };
  }

  function classifyMarketTitle(value) {
    const title = clean(value);
    for (const item of MARKET_LABELS) {
      if (item.patterns.some((pattern) => pattern.test(title))) return item.market;
    }
    return null;
  }

  function localMarketContext(column, columnIndex = 0, matchNode = null) {
    const values = [];
    const add = (value) => {
      const cleaned = clean(value);
      if (
        cleaned &&
        !values.includes(cleaned) &&
        !/^(handicap|match|col|row|wrap|item|bd-|bg-|no-wrap|\d+$)/i.test(cleaned)
      ) {
        values.push(cleaned);
      }
    };

    // 1. 局部 DOM 节点属性查找
    let node = column;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      for (const attribute of ["data-market-name", "data-market", "data-type", "aria-label", "title"]) {
        add(node.getAttribute?.(attribute));
      }
    }

    // 2. 向外匹配列表顶部的全局表头（提取列文本 + 父级区域“全场/上半场”标题）
    const card = matchNode || column.closest(MATCH_SELECTOR);
    const container = card?.parentElement || document;
    const headerContainer = container.querySelector(
      ".handicap-header, .play-header, .table-header, .grid-header, .col-header"
    );

    if (headerContainer) {
      const globalHeaderCols = [...headerContainer.querySelectorAll(
        ".col, .play-title-item, .handicap-title, [class*='header-col']"
      )];
      const targetCol = globalHeaderCols[columnIndex];
      if (targetCol) {
        add(targetCol.textContent);
        // 向上查找包含“全场/上半场”大区域标题的父级节点
        let parentSection = targetCol.parentElement;
        for (let d = 0; parentSection && d < 4; d += 1, parentSection = parentSection.parentElement) {
          const sectionTitle = parentSection.querySelector(
            ".section-title, .group-title, .header-title, .title, .stage-name"
          );
          if (sectionTitle && !sectionTitle.contains(targetCol)) {
            add(sectionTitle.textContent);
          }
        }
      }
    }

    return values.join(" | ");
  }

  function semanticFamily(options) {
    const active = options.filter((option) => option.market_data_available);
    const selections = active.map((option) => option.selection);
    const raw = active.map((option) => option.text).join(" ");
    if (selections.includes("主") && selections.includes("客")) return "h2h";
    if (/(?:^|\s)大\s*[-+\d]/.test(raw) && /(?:^|\s)小\s*[-+\d]/.test(raw)) return "total";
    if (selections.length >= 3 && selections.every((value) => /^\d+\s*[-:]\s*\d+$/.test(value))) return "correct_score";
    if (selections.length >= 2 && selections.every((value) => /^[-+]?\d/.test(value))) return "spread";
    return null;
  }

  function verifiedMarketType(context, options, columnIndex = 0) {
    const explicit = classifyMarketTitle(context);
    const family = semanticFamily(options);

    if (explicit === "corner" || explicit === "correct_score") {
      return { market: explicit, verified: true, source: "local_dom_title" };
    }

    // 优先通过文本关键字判定
    let isHalf = /半场|上半场|first[ _-]?half|1st[ _-]?half|half/i.test(context);

    // 兜底逻辑：若文本未明确包含“全场”或“半场”，根据 YBTY 列网格位置判断
    // YBTY 主盘口前 6 列中，0-2 列为全场(独赢/让球/大小)，3-5 列为半场(独赢/让球/大小)
    if (!isHalf && !/全场|full/i.test(context)) {
      const colInGroup = columnIndex % 6;
      if (colInGroup >= 3 && colInGroup <= 5) {
        isHalf = true;
      }
    }

    const period = isHalf ? "half" : "full";

    const explicitFamily = explicit?.replace(/^(?:full|half)_/, "") || null;
    if (family && (!explicitFamily || explicitFamily === family)) {
      return { market: `${period}_${family}`, verified: true, source: "dom_title_and_option_semantics" };
    }

    return {
      market: family ? `unclassified_${family}` : "unclassified",
      verified: false,
      source: family ? "option_semantics_period_unknown" : "unverified"
    };
  }

  function canonicalMarketTitle(market) {
    return {
      full_h2h: "全场独赢",
      full_spread: "全场让球",
      full_total: "全场大小球",
      half_h2h: "半场独赢",
      half_spread: "半场让球",
      half_total: "半场大小球",
      corner: "角球",
      correct_score: "波胆"
    }[market] || null;
  }

  function scheduledTime(match) {
    const liveClock = text(match, ".timer-layout2");
    const validKickoff = (value) => {
      const cleaned = clean(value);
      if (!cleaned || /^\d{1,3}:\d{2}(?:\s*\+\d+\s*['′])?$/.test(cleaned)) return false;
      return /20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(cleaned);
    };
    const attributes = [
      "data-start-time",
      "data-match-time",
      "data-commence-time",
      "data-start"
    ];
    for (const name of attributes) {
      const value = clean(match.getAttribute(name));
      if (validKickoff(value)) return value;
    }
    const node = match.querySelector(
      "time[datetime], .match-time, .start-time, [class*='start-time']"
    );
    const direct = clean(node?.getAttribute?.("datetime") || node?.textContent);
    if (direct !== liveClock && validKickoff(direct)) return direct;
    const canvasText = [...match.querySelectorAll("canvas")]
      .map((canvas) => {
        try {
          return JSON.parse(canvas.dataset.codexCanvasText || "[]")
            .map((command) => command.text)
            .join(" ");
        } catch {
          return "";
        }
      })
      .join(" ");
    const candidates =
      canvasText.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) || [];
    return candidates.find(
      (value) => value !== liveClock && !clean(match.textContent).includes(`${value}+`)
    ) || "";
  }

  function parseMatch(match) {
    const teams = [...match.querySelectorAll(".team-name")].map((node) =>
      clean(node.textContent)
    );
    if (teams.length < 2) return null;

    const scores = [...match.querySelectorAll(".score")].map((node) =>
      clean(node.textContent)
    );

    // 1. 扩充时间与阶段文本选择器（兼容 .timer-layout1、.match-status 等节点）
    let rawClock = text(
      match,
      ".timer-layout2, .timer-layout1, .timer-layout, .match-time, .match-status, .period-name, .countdown, .time-box, [class*='timer'], [class*='status']"
    );

    // 2. 兜底逻辑：若选择器未抓到，直接从卡片文本中匹配中场/半场关键字或状态节点
    const fullText = clean(match.textContent);
    if (!rawClock) {
      const stageMatch = fullText.match(/(中场休息|中场|半场|HT|加时)/i);
      if (stageMatch) {
        rawClock = stageMatch[0];
      } else {
        const timeNode = match.querySelector("[class*='time'], [class*='clock'], [class*='status']");
        if (timeNode) rawClock = clean(timeNode.textContent);
      }
    }

    const liveClock = (rawClock ? rawClock.match(/\d{1,3}:\d{2}/) : null)?.[0] || null;
    const addedMatch = fullText.match(/\+(\d{1,2})\s*['′]/);
    const columns = [...match.querySelectorAll(COLUMN_SELECTOR)];
    const marketCounters = {};
    const markets = columns.map((column, index) => {
      const localTitle = localMarketContext(column, index, match);
      // parseMatch 函数内部修改：
      const preliminaryOptions = [...column.querySelectorAll(BET_SELECTOR)].map(
        (item, optionIndex) => parseBet(item, optionIndex, "")
      );
      // 传入 index 作为第三个参数
      const identified = verifiedMarketType(localTitle, preliminaryOptions, index);
      const options = [...column.querySelectorAll(BET_SELECTOR)].map(
        (item, optionIndex) => parseBet(item, optionIndex, identified.market)
      );
      const bySide = Object.fromEntries(options.filter((option) => option.side).map((option) => [option.side, option]));
      const lineIndex = marketCounters[identified.market] || 0;
      marketCounters[identified.market] = lineIndex + 1;
      return {
        line_index: lineIndex,
        market: identified.market,
        market_title: identified.verified ? canonicalMarketTitle(identified.market) : null,
        market_title_raw: localTitle || null,
        market_type_source: identified.source,
        market_type_verified: identified.verified,
        market_type_conflict: false,
        home_selection: bySide.home?.selection || null,
        home_odds: bySide.home?.odds || null,
        away_selection: bySide.away?.selection || null,
        away_odds: bySide.away?.odds || null,
        draw_odds: bySide.draw?.odds || null,
        direction_verified: options.filter((option) => option.market_data_available).every((option) => option.side_verified),
        options
      };
    });

    // === 【修改点 1】：清理占位空盘口 & 剔除让球/大小盘口的第三个多余 null 选项 ===
    let validMarkets = markets
      .filter((m) => {
        if (m.market === "unclassified" || !m.market_type_verified) {
          const hasValidData = m.options.some(
            (opt) => opt.market_data_available && opt.odds !== ""
          );
          if (!hasValidData) return false;
        }
        return true;
      })
      .map((m) => {
        const isTwoWay = /spread|total/i.test(m.market);
        if (isTwoWay) {
          m.options = m.options.filter(
            (opt) => opt.side !== null && opt.text !== "-"
          );
        }
        return m;
      });

    // === 【修改点 2】：规范排序 (按 line_index 升序 -> 按 独赢/让球/大小 优先级排序) ===
    const marketPriority = {
      full_h2h: 1, full_spread: 2, full_total: 3,
      half_h2h: 4, half_spread: 5, half_total: 6
    };

    validMarkets.sort((a, b) => {
      if (a.line_index !== b.line_index) {
        return a.line_index - b.line_index;
      }
      const priorityA = marketPriority[a.market] || 99;
      const priorityB = marketPriority[b.market] || 99;
      return priorityA - priorityB;
    });

    return {
      source_match_id:
        match.getAttribute("data-match-id") ||
        match.getAttribute("data-id") ||
        match.id ||
        match.querySelector("[data-match-id]")?.getAttribute("data-match-id") ||
        null,
      league: findLeague(match),
      home: teams[0],
      away: teams[1],
      home_score: scores[0] || null,
      away_score: scores[1] || null,
      clock: liveClock,
      clock_status: rawClock || null,
      added_time: addedMatch ? `+${addedMatch[1]}` : null,
      countdown: /后开赛/.test(rawClock) ? rawClock : null,
      play_count: text(match, ".play-count"),
      commence_time: scheduledTime(match) || null,
      captured_at: new Date().toISOString(),
      markets: validMarkets // 使用处理后的 validMarkets
    };
  }

  function matchKey(match) {
    if (match.source_match_id) return `id:${match.source_match_id}`;
    return `teams:${match.league}|${match.home}|${match.away}`;
  }

  function isExcludedElectronicMatch(match) {
    const value = [match.league, match.home, match.away]
      .filter(Boolean)
      .join(" ");
    return value.includes("梦幻对垒")
      || value.includes("瓦尔哈拉杯")
      || value.includes("开云")
      || /(?:^|\s)VS\s*[-－]/i.test(value)
      || /(?:^|\D)(?:8|10|12)分钟(?:\D|$)/.test(value);
  }

  function findScrollContainer(firstMatch) {
    let node = firstMatch?.parentElement;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const scrollable =
        /(auto|scroll)/.test(style.overflowY) &&
        node.scrollHeight > node.clientHeight + 30;
      if (scrollable) return node;
      node = node.parentElement;
    }

    const candidates = [...document.querySelectorAll("div")].filter((element) => {
      const style = getComputedStyle(element);
      return (
        /(auto|scroll)/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 100 &&
        element.querySelector(MATCH_SELECTOR)
      );
    });
    candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
    return candidates[0] || document.scrollingElement;
  }

  function setStatus(message, error = false) {
    const node = document.getElementById(STATUS_ID);
    if (!node) return;
    node.textContent = message;
    node.style.background = error ? "#a61b1b" : "#162238";
  }

  function isLiveMatch(match) {
    const clock = clean(match.clock || match.clock_status || "");
    // 扩充对中场休息、半场、HT、休息等状态文本的正则匹配
    return /(?:^\d{1,3}:\d{2}$|\d{1,3}\s*['′]|中场|半场|HT|休息|加时|完场)/i.test(clock);
  }

  function downloadJson(matches, mode, context, summary) {
    const payload = {
      schema_version: SCHEMA_VERSION,
      export_version: EXPORT_VERSION,
      source: "ybty",
      source_url: location.href,
      page_title: context.page_title,
      page_context: context,
      export_mode: mode,
      captured_at: new Date().toISOString(),
      count: matches.length,
      summary,
      matches
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = URL.createObjectURL(blob);
    link.download = `ybty_v${EXPORT_VERSION}_${mode}_${stamp}.json`;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function scanAll(mode) {
    if (scanning) return;
    scanning = true;
    const found = new Map();
    const scannedNodes = new Set();
    const startedAt = performance.now();

    try {
      const firstMatch = document.querySelector(MATCH_SELECTOR);
      if (!firstMatch) {
        throw new Error("当前框架没有发现比赛列表，请打开滚球或今日赛事页");
      }
      const context = pageContext(mode);
      if (context.mode_conflict) {
        throw new Error(`页面类型校验失败：当前识别为${context.detected_mode}，请求导出${mode}`);
      }
      setStatus("正在采集已手动展开的比赛…");
      const scroller = findScrollContainer(firstMatch);
      const originalTop = scroller.scrollTop;
      scroller.scrollTop = 0;
      await sleep(700);

      let unchangedRounds = 0;
      let previousTop = -1;
      for (let round = 0; round < 240; round += 1) {
        const visible = [...document.querySelectorAll(MATCH_SELECTOR)];
        const before = found.size;
        for (const node of visible) {
          scannedNodes.add(node);
          const match = parseMatch(node);
          if (match) found.set(matchKey(match), match);
        }
        unchangedRounds = found.size === before ? unchangedRounds + 1 : 0;
        setStatus(`正在采集：${found.size}场（第${round + 1}屏）`);

        const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const nextTop = Math.min(
          maxTop,
          scroller.scrollTop + Math.max(350, Math.floor(scroller.clientHeight * 0.72))
        );
        if (
          (nextTop >= maxTop && unchangedRounds >= 2) ||
          (nextTop === previousTop && unchangedRounds >= 2)
        ) {
          break;
        }
        previousTop = scroller.scrollTop;
        scroller.scrollTop = nextTop;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
        await sleep(550);
      }

      scroller.scrollTop = originalTop;
      const allMatches = [...found.values()];
      const marketConflicts = allMatches.flatMap((match) =>
        match.markets.filter((market) => market.market_type_conflict)
      );
      if (marketConflicts.length) {
        throw new Error(`盘口标题校验发现${marketConflicts.length}列类型冲突，已停止导出以防止让球/大小球/独赢混淆。`);
      }
      const electronicFiltered = allMatches.filter(isExcludedElectronicMatch).length;
      const modeFiltered = allMatches.filter(
        (match) => !isExcludedElectronicMatch(match) &&
          (mode === "live" ? !isLiveMatch(match) : isLiveMatch(match))
      ).length;
      const matches = allMatches.filter(
        (match) =>
          !isExcludedElectronicMatch(match) &&
          (mode === "live" ? isLiveMatch(match) : !isLiveMatch(match))
      );
      if (!matches.length) throw new Error("未检测到有效比赛，请确认页面加载完成。");
      if (!context.mode_verified) {
        context.detected_mode = mode;
        context.mode_verified = true;
        context.mode_verification_source = "exported_match_clock_state";
      }
      const duration = Number(((performance.now() - startedAt) / 1000).toFixed(1));
      const summary = {
        scanned_count: scannedNodes.size,
        parsed_count: allMatches.length,
        parse_failure_count: Math.max(0, scannedNodes.size - allMatches.length),
        valid_count: matches.length,
        filtered_count: electronicFiltered + modeFiltered,
        electronic_filtered_count: electronicFiltered,
        mode_filtered_count: modeFiltered,
        exported_count: matches.length,
        market_title_verified_count: matches.reduce(
          (sum, match) => sum + match.markets.filter((market) => market.market_type_verified).length,
          0
        ),
        market_title_unverified_count: matches.reduce(
          (sum, match) => sum + match.markets.filter((market) => !market.market_type_verified).length,
          0
        ),
        duration_seconds: duration
      };
      downloadJson(matches, mode, context, summary);
      setStatus(`完成：扫描${summary.scanned_count}｜有效${summary.valid_count}｜过滤${summary.filtered_count}｜导出${summary.exported_count}｜${duration}秒`);
    } catch (error) {
      setStatus(`失败：${error.message}`, true);
    } finally {
      scanning = false;
    }
  }

  function mount() {
    if (
      document.getElementById(PANEL_ID) ||
      !document.querySelector(MATCH_SELECTOR)
    ) {
      return;
    }
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "font:13px/1.4 Arial,sans-serif",
      "color:#fff",
      "box-shadow:0 4px 16px rgba(0,0,0,.28)"
    ].join(";");

    const button = document.createElement("button");
    button.id = "codex-ybty-live-export-button";
    button.type = "button";
    button.textContent = "导出滚球分析数据";
    button.style.cssText = [
      "display:block",
      "width:190px",
      "padding:10px 12px",
      "border:0",
      "border-radius:8px 8px 0 0",
      "background:#1677ff",
      "color:#fff",
      "cursor:pointer",
      "font-weight:700"
    ].join(";");
    button.addEventListener("click", () => scanAll("live"));

    const prematchButton = document.createElement("button");
    prematchButton.id = "codex-ybty-prematch-export-button";
    prematchButton.type = "button";
    prematchButton.textContent = "导出赛前分析数据";
    prematchButton.style.cssText = [
      "display:block",
      "width:190px",
      "padding:10px 12px",
      "border:0",
      "background:#0f9d58",
      "color:#fff",
      "cursor:pointer",
      "font-weight:700"
    ].join(";");
    prematchButton.addEventListener("click", () => scanAll("prematch"));

    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "等待采集";
    status.style.cssText = [
      "width:190px",
      "box-sizing:border-box",
      "padding:7px 9px",
      "border-radius:0 0 8px 8px",
      "background:#162238",
      "text-align:center"
    ].join(";");

    panel.append(button, prematchButton, status);
    document.documentElement.appendChild(panel);
  }

  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mount();
})();
