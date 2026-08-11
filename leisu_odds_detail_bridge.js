(() => {
  "use strict";

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function canvasText(canvas) {
    try {
      const commands = JSON.parse(canvas.dataset.codexCanvasText || "[]");
      return {
        text: commands.map((item) => item.text).join(" ").trim(),
        commands
      };
    } catch {
      return { text: "", commands: [] };
    }
  }

  function canvasValues(cell) {
    return (cell?.canvases || []).map((item) => item.text || null);
  }

  function triplet(values, offset, labels) {
    const output = {};
    labels.forEach((label, index) => {
      output[label] = values[offset + index] ?? null;
    });
    return output;
  }

  function normalizeCompanies(rows) {
    const output = [];
    for (const row of rows.slice(1)) {
      if (!row.cells || row.cells.length < 5) continue;
      const companyValues = canvasValues(row.cells[1]);
      const handicap = canvasValues(row.cells[2]);
      const winner = canvasValues(row.cells[3]);
      const totals = canvasValues(row.cells[4]);
      const company = companyValues[0] || row.cells[1].text || null;
      if (!company) continue;
      output.push({
        company,
        asian_handicap: {
          opening: triplet(handicap, 0, ["home", "line", "away"]),
          current: triplet(handicap, 3, ["home", "line", "away"])
        },
        match_winner: {
          opening: triplet(winner, 0, ["home", "draw", "away"]),
          current: triplet(winner, 3, ["home", "draw", "away"])
        },
        total_goals: {
          opening: triplet(totals, 0, ["over", "line", "under"]),
          current: triplet(totals, 3, ["over", "line", "under"])
        }
      });
    }
    return output;
  }

  function collect() {
    const rows = [...document.querySelectorAll("tr")].map((row, rowIndex) => ({
      row_index: rowIndex,
      class_name: clean(row.className),
      text: clean(row.innerText || row.textContent),
      cells: [...row.querySelectorAll(":scope > th, :scope > td")].map(
        (cell, cellIndex) => ({
          cell_index: cellIndex,
          text: clean(cell.innerText || cell.textContent),
          class_name: clean(cell.className),
          canvases: [...cell.querySelectorAll("canvas")].map(canvasText)
        })
      )
    }));
    const headings = [
      ...document.querySelectorAll(
        "h1,h2,h3,h4,.title,.tab,.tabs,.nav,.market-name,[class*='title']"
      )
    ]
      .map((node) => clean(node.innerText || node.textContent))
      .filter(Boolean)
      .slice(0, 120);
    const canvas_count = document.querySelectorAll("canvas").length;
    const captured_canvas_count = document.querySelectorAll(
      "canvas[data-codex-canvas-text]"
    ).length;
    return {
      source: location.href,
      captured_at: new Date().toISOString(),
      title: document.title,
      headings,
      canvas_count,
      captured_canvas_count,
      rows,
      normalized: {
        companies: normalizeCompanies(rows),
        phases: {
          opening: "页面每个市场的前三项",
          current: "页面每个市场的后三项"
        },
        unavailable_markets: ["corners", "pre_match_closing"]
      }
    };
  }

  let attempts = 0;
  let previousCaptured = -1;
  let stableRounds = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const payload = collect();
    if (payload.captured_canvas_count === previousCaptured) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      previousCaptured = payload.captured_canvas_count;
    }
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    );
    if (window.scrollY < maxScroll) {
      window.scrollTo(
        0,
        Math.min(maxScroll, window.scrollY + Math.max(500, window.innerHeight * 0.8))
      );
    }
    if (
      (attempts >= 5 &&
        payload.captured_canvas_count > 0 &&
        stableRounds >= 2 &&
        window.scrollY >= maxScroll) ||
      attempts >= 24
    ) {
      clearInterval(timer);
      window.scrollTo(0, 0);
      const matchId = location.pathname.match(/3in1-(\d+)/)?.[1] || "";
      chrome.runtime.sendMessage({
        type: "CODEX_LEISU_ODDS_DETAIL",
        match_id: matchId,
        payload
      });
    }
  }, 250);
})();
