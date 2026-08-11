(() => {
  "use strict";

  const matchId = String(location.pathname.match(/detail-(\d+)/)?.[1] || "");
  if (!matchId) return;
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const sendDom = (name, body) => chrome.runtime.sendMessage({
    type: "CODEX_LEISU_DETAIL_API_RESPONSE",
    match_id: matchId,
    url: `dom:${name}`,
    status: 200,
    data: {
      encoding: "json",
      content_type: "application/json",
      body: { captured_at: Date.now(), ...body }
    }
  });
  const activateNav = async (index, expectedText) => {
    const items = [...document.querySelectorAll(
      "div.broadcast-match ul.nav_btn_area > li"
    )];
    const target = items[index];
    if (!target) return false;
    const label = clean(target.textContent);
    if (expectedText && !label.includes(expectedText)) return false;
    target.click();
    await wait(450);
    return true;
  };
  const candidates = () => [...document.querySelectorAll("button,a,li,div,span")].filter(visible);
  const clickText = async (label, root = document) => {
    const nodes = [...root.querySelectorAll("button,a,li,div,span")].filter(visible);
    const exactTextTarget = nodes
      .filter((node) => clean(node.textContent) === label)
      .sort((left, right) => clean(left.textContent).length - clean(right.textContent).length)[0];
    const target = exactTextTarget || nodes
      .filter((node) => flattenedCanvasValues(node).includes(label))
      .sort((left, right) => nodeText(left).length - nodeText(right).length)[0];
    if (!target) return false;
    target.click();
    await wait(350);
    return true;
  };
  const canvasValues = (root) => [...root.querySelectorAll("canvas")]
    .map((canvas) => {
      try {
        const commands = JSON.parse(canvas.dataset.codexCanvasText || "[]");
        return commands.map((item) => clean(item.text)).filter(Boolean);
      } catch {
        return [];
      }
    })
    .filter((items) => items.length);
  const flattenedCanvasValues = (root) => canvasValues(root).flat().map(clean).filter(Boolean);
  const nodeText = (node) => clean([
    node?.innerText || node?.textContent || "",
    ...flattenedCanvasValues(node)
  ].join(" "));
  const snapshot = (node, label = null) => ({
    label,
    class_name: clean(node?.className),
    text: clean(node?.innerText || node?.textContent).slice(0, 120000),
    canvas_values: canvasValues(node),
    tables: [...(node?.querySelectorAll("table") || [])].map((table) => ({
      rows: [...table.querySelectorAll("tr")].map((row) => ({
        cells: [...row.querySelectorAll("th,td")].map((cell) => nodeText(cell))
      }))
    }))
  });
  const sectionFor = (label) => {
    const heading = candidates().find((node) => {
      const text = nodeText(node);
      return text === label || flattenedCanvasValues(node).includes(label);
    });
    if (!heading) return null;
    let node = heading;
    while (node?.parentElement && node !== document.body) {
      const text = clean(node.innerText || node.textContent);
      if (text.length >= label.length + 12 && text.length <= 120000) return node;
      node = node.parentElement;
    }
    return heading.parentElement || heading;
  };

  function captureTextLive() {
    const eventPattern =
      /(?:^|\s)(?:\d{1,3}(?:\+\d{1,2})?['’]|\d{1,3}[:：]\d{2})|进球|射门|射正|角球|黄牌|红牌|换人|点球|受伤|伤停|中场|上半场|下半场|比赛结束|VAR/i;
    const isChatNode = (node) => {
      let current = node;
      for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
        const marker = `${current.id || ""} ${current.className || ""}`.toLowerCase();
        if (/(?:^|[\s_-])(chat|comment|talk|barrage|danmu|discuss|user-msg|user-message|chat-room)(?:[\s_-]|$)/i.test(marker)) {
          return true;
        }
      }
      const text = clean(node.innerText || node.textContent);
      return /^Lv\d+\s/i.test(text) || /^用户[a-z0-9_-]+\s/i.test(text);
    };
    const liveRoot = document.querySelector(
      "div.broadcast-match div.nav_content_area"
    );
    if (!liveRoot) {
      sendDom("text-live", {
        active_tab: "文字直播",
        source_type: "official_text_live_container_missing",
        chat_content_excluded: false,
        available: false,
        reason: "broadcast_match_nav_content_area_not_found",
        entries: []
      });
      return;
    }
    const entries = [...liveRoot.querySelectorAll("li,p,tr,article,section,div")]
      .filter(visible)
      .filter((node) => !isChatNode(node))
      .map((node) => clean(node.innerText || node.textContent))
      .filter((text) => text.length >= 3 && text.length <= 280 && eventPattern.test(text))
      .filter((text) => !text.includes("图例说明"))
      .filter((text) => !/^(?:越位|进攻|换人|任意球|半场比分|球门球|伤停补时|危险进攻)(?:\s+(?:越位|进攻|换人|任意球|半场比分|球门球|伤停补时|危险进攻)){3,}$/.test(text))
      .filter((text) => !/^角球\s+进球\s+点球\s+控球率/.test(text))
      .filter((text) => !/角球.*进球.*点球.*控球率.*换人.*危险进攻/.test(text))
      .filter((text) => !/^\d+\(\d+\)\s*射门\(射正\)/.test(text))
      .filter((text) => !/^(?:\d{1,3}'\s*)+(?:HT\s*)?(?:\d{1,3}'\s*)*$/.test(text))
      .filter((text) => !/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(text))
      .filter((text) => !/^Lv\d+\s/i.test(text))
      .filter((text) => !/^\S+\s+\S+\s+90'\s+75'\s+60'\s+HT/.test(text))
      .filter((text) => !/^\S+\s+(?:一月|二月|三月|四月|五月|六月|七月|八月|九月|十月|十一月|十二月)\s+\d{4}\//.test(text))
      .filter((text) => !/^\d{4}\/\d{2}\/\d{2}.*开赛.*天气/.test(text));
    const uniqueEntries = [...new Set(entries)].filter(
      (text, index, all) => !all.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.length >= 8 &&
          other.length < text.length &&
          text.includes(other)
      )
    );
    sendDom("text-live", {
      active_tab: "文字直播",
      source_selector: "div.broadcast-match div.nav_content_area",
      source_type: "official_text_live_filtered",
      chat_content_excluded: true,
      available: true,
      entries: uniqueEntries.slice(0, 240)
    });
  }

  function captureOddPanels() {
    const marketValues = (row, selectors) => {
      const node = selectors.map((selector) => row.querySelector(selector)).find(Boolean);
      return node ? flattenedCanvasValues(node) : [];
    };
    const panels = [...document.querySelectorAll("div.odd-panel")].map((node, index) => {
      const allValues = flattenedCanvasValues(node);
      const rows = [...node.querySelectorAll(":scope > .content > .ball, :scope > .content > .instant, :scope > .content > .primary, :scope > .ball, :scope > .instant, :scope > .primary")].map((row) => {
        const values = flattenedCanvasValues(row);
        const phase = ["即时", "赛前", "初始"].find((label) =>
          clean(row.innerText).includes(label) || values.includes(label)
        ) || (row.classList.contains("ball")
          ? "即时"
          : row.classList.contains("instant")
            ? "赛前"
            : row.classList.contains("primary")
              ? "初始"
              : null);
        return {
          phase,
          asian_handicap: marketValues(row, [".asian"]),
          match_winner: marketValues(row, [".euro"]),
          total_goals: marketValues(row, [".size", ".daxiao", ".total"]),
          corners: marketValues(row, [".corner", ".jiaoqiu"]),
          raw_values: values
        };
      });
      return {
        index,
        ...snapshot(node),
        phases: ["即时", "赛前", "初始"].filter((label) =>
          clean(node.innerText).includes(label) || allValues.includes(label)
        ),
        markets: ["让球", "胜负", "总进球", "角球"].filter((label) => allValues.includes(label)),
        normalized_rows: rows
      };
    });
    sendDom("odd-panel", {
      available: panels.length > 0,
      panel_count: panels.length,
      panels
    });
  }

  async function captureDataAnalysis() {
    const opened = await activateNav(2, "数据分析");
    if (opened) await wait(500);
    const output = {
      available: opened || ["近期战绩", "进球分布", "走势", "联赛积分"].some((label) => sectionFor(label)),
      recent_form: [],
      recent_form_status: "not_captured",
      goal_distribution: null,
      historical_trend: null,
      league_standings: null,
      diagnostic: null
    };
    const recent = document.querySelector(".recent-rank .box");
    if (recent) {
      const vertical = [...recent.querySelectorAll(":scope > .vertical")].find(visible);
      const panels = vertical
        ? [...vertical.querySelectorAll(":scope > .box-panel")]
        : [];
      const selectVenue = async (panel, optionText) => {
        const venueSelect = [...panel.querySelectorAll(".screen-header .select-box")]
          .find((box) => {
            const options = [...box.querySelectorAll(".down .option")].map((node) => clean(node.textContent));
            return ["全部", "主", "客"].every((value) => options.includes(value));
          });
        if (!venueSelect) return false;
        venueSelect.querySelector(".current")?.click();
        await wait(120);
        const option = [...venueSelect.querySelectorAll(".down .option")]
          .find((node) => clean(node.textContent) === optionText);
        if (!option) return false;
        option.click();
        await wait(500);
        return clean(venueSelect.querySelector(".selected")?.textContent) === optionText;
      };
      for (const [index, panel] of panels.slice(0, 2).entries()) {
        const side = index === 0 ? "主队" : "客队";
        const team = clean(panel.querySelector(".screen-header .team .name")?.textContent);
        const options = index === 0
          ? [{ scope: "全部", option: "全部" }, { scope: "主场", option: "主" }]
          : [{ scope: "全部", option: "全部" }, { scope: "客场", option: "客" }];
        for (const item of options) {
          const selectionApplied = await selectVenue(panel, item.option);
          output.recent_form.push({
            side,
            team,
            scope: item.scope,
            selected_option: item.option,
            selection_applied: selectionApplied,
            ...snapshot(panel, `${side}-${item.scope}`)
          });
        }
      }
    }
    const recentComplete = output.recent_form.length === 4 &&
      output.recent_form.every((item) => item.selection_applied);
    output.recent_form_status = recentComplete ? "verified_four_views" : "capture_incomplete";
    if (!recentComplete) {
      output.diagnostic = {
        recent_html: String(recent?.outerHTML || "").slice(0, 800000),
        recent_text: nodeText(recent).slice(0, 150000)
      };
    }
    const goal = sectionFor("进球分布");
    const trend = sectionFor("走势");
    const standings = sectionFor("联赛积分");
    if (goal) output.goal_distribution = snapshot(goal, "进球分布");
    if (trend) output.historical_trend = snapshot(trend, "走势");
    if (standings) output.league_standings = snapshot(standings, "联赛积分");
    sendDom("data-analysis", output);
  }

  async function run() {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      if (document.body && clean(document.body.innerText).length > 30) break;
      await wait(250);
    }
    await activateNav(0, "文字直播");
    await wait(450);
    captureTextLive();
    captureOddPanels();
    await captureDataAnalysis();
    captureOddPanels();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  window.addEventListener("message", (event) => {
    // 增加 event.origin 安全校验
    if (
      event.origin !== window.location.origin ||
      event.source !== window ||
      event.data?.source !== "codex-leisu-detail-api"
    ) {
      return;
    }
    chrome.runtime.sendMessage({
      type: "CODEX_LEISU_DETAIL_API_RESPONSE",
      match_id: String(event.data.match_id || ""),
      url: event.data.url,
      status: event.data.status,
      data: event.data.data
    });
  });
})();
