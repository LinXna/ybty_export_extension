const pendingDetails = new Map();
const pendingLiveApi = new Map();
const LEISU_PROTO = {
  ApiResult: { 1: ["code", "varint"], 2: ["data", "bytes"] },
  Score: { 1: ["score", "varint"], 2: ["halfScore", "varint"], 3: ["redCard", "varint"], 4: ["yellowCard", "varint"], 5: ["corner", "varint"], 6: ["overTime", "varint"], 7: ["penalty", "varint"] },
  Environment: { 1: ["weather", "string"], 2: ["pressure", "string"], 3: ["temperature", "string"], 4: ["wind", "string"], 5: ["humidity", "string"], 6: ["weatherId", "varint"] },
  Team: { 1: ["id", "varint"], 2: ["name", "string"], 5: ["jersey", "string"], 6: ["shortName", "string"], 7: ["rank", "string"] },
  Competition: { 1: ["id", "varint"], 2: ["name", "string"], 3: ["type", "varint"], 5: ["shortName", "string"] },
  StatItem: { 1: ["code", "varint"], 2: ["home", "varint"], 3: ["away", "varint"], 4: ["homeCoords", "string", true], 5: ["awayCoords", "string", true] },
  Stats: { 1: ["itemsList", "StatItem", true] },
  OddsItem: { 1: ["odd1", "string"], 2: ["odd2", "string"] },
  Odds: { 1: ["type1", "OddsItem"], 2: ["type2", "OddsItem"], 3: ["type3", "OddsItem"], 4: ["type4", "OddsItem"] },
  LiveData: { 1: ["id", "varint"], 2: ["statusId", "varint"], 3: ["homeScores", "Score"], 4: ["awayScores", "Score"], 7: ["stats", "Stats"], 9: ["odds", "Odds"] },
  Detail: { 1: ["id", "varint"], 2: ["matchTime", "varint"], 4: ["homeTeam", "Team"], 5: ["awayTeam", "Team"], 6: ["competition", "Competition"], 8: ["environment", "Environment"] }
};
function readVarint(bytes, state) { let value = 0, shift = 0, byte; do { byte = bytes[state.i++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128); return value; }
function readBytes(bytes, state, length) { const out = bytes.slice(state.i, state.i + length); state.i += length; return out; }
function decodeProto(bytes, schema) {
  const out = {}, state = { i: 0 };
  while (state.i < bytes.length) {
    const tag = readVarint(bytes, state), field = tag >>> 3, wire = tag & 7, spec = schema[field];
    if (wire === 0) { const value = readVarint(bytes, state); if (spec) out[spec[0]] = spec[2] ? [...(out[spec[0]] || []), value] : value; continue; }
    if (wire !== 2) { if (wire === 5) state.i += 4; else if (wire === 1) state.i += 8; else break; continue; }
    const data = readBytes(bytes, state, readVarint(bytes, state)); if (!spec) continue;
    let value;
    if (spec[1] === "string") value = new TextDecoder().decode(data);
    else if (spec[1] === "bytes") value = data;
    else value = decodeProto(data, LEISU_PROTO[spec[1]]);
    out[spec[0]] = spec[2] ? [...(out[spec[0]] || []), value] : value;
  } return out;
}
function decodeLeisuBinaryResponse(response, kind) {
  response = response?.data || response;
  if (!response || response.encoding !== "base64" || typeof response.body !== "string") return null;
  try {
    const bytes = Uint8Array.from(atob(response.body), (char) => char.charCodeAt(0));
    const api = decodeProto(bytes, LEISU_PROTO.ApiResult);
    const code = api.code ?? 0;
    const result = { code, data_bytes: api.data?.length || 0 };
    if (code !== 0) return result;
    const typeName = kind === "d" ? "Detail" : kind === "vd" ? "LiveData" : null;
    if (!typeName) return { ...result, data: null, schema_status: "raw_payload_only", reason: "in_game_stats_schema_not_confirmed" };
    result.data = decodeProto(api.data, LEISU_PROTO[typeName]);
    for (const score of [result.data.homeScores, result.data.awayScores]) {
      if (!score) continue;
      for (const key of ["score", "halfScore", "redCard", "yellowCard", "corner"]) {
        if (score[key] === undefined) score[key] = 0;
      }
      if (score.overTime === undefined) score.overTime = null;
      if (score.penalty === undefined) score.penalty = null;
    }
    for (const item of result.data.stats?.itemsList || []) {
      if (item.home === undefined) item.home = 0;
      if (item.away === undefined) item.away = 0;
    }
    return result;
  } catch (error) {
    return { available: false, error: String(error?.message || error) };
  }
}
function removeInterfaceLogos(value) {
  if (Array.isArray(value)) return value.map(removeInterfaceLogos);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(logo|jersey)/i.test(key)).map(([key, item]) => [key, removeInterfaceLogos(item)]));
}

const recentDetailApi = new Map();

async function decodeMatchAnalysisRaw(rawBody) {
  const envelope = JSON.parse(String(rawBody || ""));
  const code = Number(envelope?.code);
  if (!Number.isInteger(code) || code < 100 || code >= 127 || typeof envelope.data !== "string") {
    return { available: false, reason: "unsupported_match_analysis_response", code: envelope?.code ?? null };
  }
  const shift = code - 100;
  const rotated = [...envelope.data].map((char) => {
    const value = char.charCodeAt(0);
    if (value >= 65 && value <= 90) return String.fromCharCode((value - 65 - shift + 26) % 26 + 65);
    if (value >= 97 && value <= 122) return String.fromCharCode((value - 97 - shift + 26) % 26 + 97);
    return char;
  }).join("");
  const binary = atob(rotated.replace(/\s+/g, ""));
  const compressed = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (typeof DecompressionStream !== "function") throw new Error("gzip_decompression_unavailable");
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
  const body = new TextDecoder("utf-8", { fatal: true }).decode(inflated);
  const parsed = JSON.parse(body);
  return {
    available: true,
    code,
    key_index: shift,
    key_source: "extension_rot2",
    cipher_length: envelope.data.length,
    compressed_byte_size: compressed.length,
    plain_length: body.length,
    json_parseable: true,
    json_keys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 200) : [],
    body,
    data: parsed
  };
}


// 定时清理过期缓存（超过10分钟的缓存自动释放）
const MAP_TTL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [matchId, value] of recentDetailApi.entries()) {
    if (now - (value.captured_at || 0) > MAP_TTL_MS) {
      recentDetailApi.delete(matchId);
    }
  }
}, 5 * 60 * 1000);

function collectLeisuDetailApi(matchId, requireInterfaceRuntime = false) {
  return new Promise((resolve) => {
    recentDetailApi.delete(matchId);
    chrome.tabs.create(
      {
        url: `https://live.leisu.com/detail-${matchId}`,
        active: false
      },
      (tab) => {
        if (chrome.runtime.lastError || !tab?.id) {
          resolve({
            available: false,
            reason: chrome.runtime.lastError?.message || "detail_tab_failed",
            responses: {}
          });
          return;
        }
        const startedAt = Date.now();
        const finishWhenReady = () => {
          const value = recentDetailApi.get(matchId);
          const responses = value?.responses || {};
          const domReady = Boolean(
            responses["dom:text-live"] &&
            responses["dom:odd-panel"] &&
            responses["dom:data-analysis"]
          );
          const interfaceRuntimeReady = Boolean(responses["runtime:frontend-interface-state"]);
          const initialPayloadReady = Boolean(responses["payload:initial-detail"]);
          const lineupResponseReady = Object.keys(responses).some((url) => /match_lineup/i.test(url));
          const interfaceEvidenceReady = interfaceRuntimeReady && initialPayloadReady && lineupResponseReady;
          if ((!domReady || (requireInterfaceRuntime && !interfaceEvidenceReady)) && Date.now() - startedAt < 18000) {
            setTimeout(finishWhenReady, 250);
            return;
          }
          chrome.tabs.remove(tab.id).catch(() => { });
          resolve({
            available: Boolean(value && Object.keys(responses).length),
            reason: domReady && (!requireInterfaceRuntime || interfaceEvidenceReady)
              ? null
              : value
                ? "detail_dom_capture_timeout"
                : "no_detail_requests_captured",
            captured_at: value?.captured_at || null,
            responses
          });
        };
        setTimeout(finishWhenReady, 1200);
      }
    );
  });
}

// 前端脚本导出复用滚球详情采集的页面监听和响应缓存。
// 先在空白标签上启用调试器，再只导航一次到详情页，避免错过首屏请求。

function deriveMatchAnalysisTrend(parsed) {
  const toNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const resultLabel = (value) => value > 0 ? "胜" : value < 0 ? "负" : "平";
  const parseLine = (record) => {
    const candidates = [record?.[6]?.[2], record?.[7]?.[2]];
    for (const value of candidates) {
      const parts = String(value || "").split(",");
      const line = toNumber(parts[1]);
      if (line != null) return line;
    }
    return null;
  };
  const summarize = (records, teamId, limit = 30) => {
    const rows = (Array.isArray(records) ? records : []).slice(0, limit);
    const output = { games: rows.length, wins: 0, draws: 0, losses: 0, win_rate: null, big: 0, big_rate: null, small: 0, small_rate: null, recent_6: { result: [], total_goals: [] } };
    for (const record of rows) {
      const homeId = record?.[4]?.[0];
      const awayId = record?.[5]?.[0];
      const homeScore = toNumber(record?.[4]?.[2]);
      const awayScore = toNumber(record?.[5]?.[2]);
      if (homeScore == null || awayScore == null) continue;
      const perspective = homeId === teamId ? homeScore - awayScore : awayId === teamId ? awayScore - homeScore : 0;
      const result = resultLabel(perspective);
      if (result === "胜") output.wins += 1;
      else if (result === "平") output.draws += 1;
      else output.losses += 1;
      const line = parseLine(record);
      if (line != null) {
        const total = homeScore + awayScore;
        if (total > line) output.big += 1;
        else if (total < line) output.small += 1;
      }
      if (output.recent_6.result.length < 6) output.recent_6.result.push(result);
      if (output.recent_6.total_goals.length < 6 && line != null) {
        output.recent_6.total_goals.push(homeScore + awayScore > line ? "大" : homeScore + awayScore < line ? "小" : "走");
      }
    }
    if (output.games) output.win_rate = Number((output.wins / output.games * 100).toFixed(1));
    const settled = output.big + output.small;
    if (settled) {
      output.big_rate = Number((output.big / settled * 100).toFixed(1));
      output.small_rate = Number((output.small / settled * 100).toFixed(1));
    }
    return output;
  };
  const side = (key, teamId) => {
    const history = parsed?.history?.[key] || {};
    return {
      all: summarize(history.all, teamId),
      home: summarize((history.all || []).filter((r) => r?.[4]?.[0] === teamId), teamId),
      away: summarize((history.all || []).filter((r) => r?.[5]?.[0] === teamId), teamId)
    };
  };
  const homeId = parsed?.cur_match?.[4]?.[0];
  const awayId = parsed?.cur_match?.[5]?.[0];
  return { home: side("home", homeId), away: side("away", awayId), rule: "recent_30_records_result_and_total_goals_line" };
}

// Exact replica of the frontend trend calculation. Kept in the interface-only path.
function deriveMatchAnalysisTrend(parsed) {
  const parseOddstr = (records) => (Array.isArray(records) ? records : []).map((record) => {
    const copy = Array.isArray(record) ? record.slice() : record;
    if (Array.isArray(copy?.[6])) copy[6] = copy[6].map((value) => {
      const parts = String(value ?? "").split(",");
      return parts.length > 1 ? parts : [];
    });
    return copy;
  });
  const trendClass = (record, teamId) => {
    const line = String(record?.[6]?.[0] || "").split(",")[1];
    if (!line) return { result: "-", class: "-" };
    const homeScore = normalizeLeisuTeamScore(record?.[4]);
    const awayScore = normalizeLeisuTeamScore(record?.[5]);
    const value = Number(homeScore[2]) - Number(line) - Number(awayScore[2]);
    const home = homeScore[0] == teamId;
    const result = home ? (value > 0 ? "赢" : value < 0 ? "输" : "和") : (value > 0 ? "输" : value < 0 ? "赢" : "和");
    return { result, class: result === "赢" ? "win" : result === "输" ? "loss" : "draw" };
  };
  const bigSmall = (record) => {
    const line = String(record?.[6]?.[2] || "").split(",")[1];
    if (!line) return { result: "-", class: "-" };
    const value = Number(normalizeLeisuTeamScore(record?.[4])[2]) + Number(normalizeLeisuTeamScore(record?.[5])[2]) - Number(line);
    const result = value > 0 ? "大" : value < 0 ? "小" : "走";
    return { result, class: result === "大" ? "big" : result === "小" ? "small" : "draw" };
  };
  const format = (lists, teamId) => {
    const recent = { asia: [], bs: [] };
    const table = lists.map((records, index) => {
      const row = { row_title: ["总", "主", "客"][index], total: 0, asia_total: 0, win: 0, draw: 0, loss: 0, win_ratio: "0%", bs_total: 0, big: 0, big_ratio: "0%", small: 0, small_ratio: "0%" };
      for (const record of records) {
        row.total++;
        if (record?.[6]) {
          const bs = bigSmall(record); row.bs_total++;
          if (bs.class === "big") row.big++; else if (bs.class === "small") row.small++; else if (bs.class !== "draw") row.bs_total--;
          const asia = trendClass(record, teamId); row.asia_total++;
          if (asia.class === "win") row.win++; else if (asia.class === "loss") row.loss++; else if (asia.class === "draw") row.draw++; else row.asia_total--;
          if (index === 0) { recent.asia.push(asia); recent.bs.push(bs); }
        }
      }
      row.win_ratio = row.total ? (100 * row.win / row.total).toFixed(1) + "%" : "-";
      row.big_ratio = row.bs_total ? (100 * row.big / row.total).toFixed(1) + "%" : "-";
      row.small_ratio = row.bs_total ? (100 * row.small / row.total).toFixed(1) + "%" : "-";
      return row;
    });
    return { table, recent6: { asia: recent.asia.slice(0, 6), bs: recent.bs.slice(0, 6) } };
  };
  const side = (key, teamId) => {
    const list = parseOddstr(parsed?.history?.[key]?.all?.slice(0, 30));
    return format([list, list.filter((r) => r?.[4]?.[0] == teamId), list.filter((r) => r?.[5]?.[0] == teamId)], teamId);
  };
  return { home: side("home", parsed?.cur_match?.[4]?.[0]), away: side("away", parsed?.cur_match?.[5]?.[0]), rule: "leisu_trend_bundle_exact_v1" };
}

function buildRecentMatchRecords(parsed) {
  const teams = parsed?.teams || {};
  const trendClass = (record, teamId) => {
    const line = record?.[6]?.[0]?.[1];
    if (!line) return { result: "-", class: "-" };
    const value = Number(record?.[4]?.[2]) - Number(line) - Number(record?.[5]?.[2]);
    const result = record?.[4]?.[0] == teamId
      ? (value > 0 ? "赢" : value < 0 ? "输" : "和")
      : (value > 0 ? "输" : value < 0 ? "赢" : "和");
    return { result, class: result === "赢" ? "win" : result === "输" ? "loss" : "draw" };
  };
  const bigSmall = (record) => {
    const line = record?.[6]?.[2]?.[1];
    if (!line) return { result: "-", class: "-" };
    const value = Number(record?.[4]?.[2]) + Number(record?.[5]?.[2]) - Number(line);
    const result = value > 0 ? "大" : value < 0 ? "小" : "走";
    return { result, class: result === "大" ? "big" : result === "小" ? "small" : "draw" };
  };
  const leagueMap = parsed?.match_events || parsed?.leagues || parsed?.competitions || parsed?.league_map || {};
  const nameOf = (id) => teams[String(id)]?.name_zh || teams[String(id)]?.name || null;
  const leagueNameOf = (id) => {
    const value = leagueMap[String(id)];
    return typeof value === "string" ? value : value?.name_zh || value?.name || null;
  };
  const resultOf = (home, away, homeId, teamId) => {
    if (home == null || away == null) return null;
    const diff = homeId == teamId ? home - away : away - home;
    return diff > 0 ? "赢" : diff < 0 ? "输" : "和";
  };
  const convert = (record, teamId) => {
    if (!Array.isArray(record)) return null;
    const normalized = record.slice();
    if (Array.isArray(normalized[6])) normalized[6] = normalized[6].map((value) => {
      const parts = String(value ?? "").split(",");
      return parts.length > 1 ? parts : [];
    });
    const home = normalizeLeisuTeamScore(normalized[4]), away = normalizeLeisuTeamScore(normalized[5]);
    const homeScore = Number.isFinite(Number(home[2])) ? Number(home[2]) : null;
    const awayScore = Number.isFinite(Number(away[2])) ? Number(away[2]) : null;
    const halfHome = Number.isFinite(Number(home[3])) ? Number(home[3]) : null;
    const halfAway = Number.isFinite(Number(away[3])) ? Number(away[3]) : null;
    const leagueId = record[1] ?? null;
    return {
      match_id: record[0] ?? null,
      league_id: leagueId,
      league_name: leagueNameOf(leagueId),
      match_time: record[3] ?? null,
      match_date: record[3] ? new Date(Number(record[3]) * 1000).toISOString() : null,
      home_team_id: home[0] ?? null,
      home_team_name: nameOf(home[0]) || home[1] || null,
      away_team_id: away[0] ?? null,
      away_team_name: nameOf(away[0]) || away[1] || null,
      halftime_score: { home: halfHome, away: halfAway },
      fulltime_score: { home: homeScore, away: awayScore },
      result: resultOf(homeScore, awayScore, home[0], teamId),
      goals: homeScore != null && awayScore != null ? homeScore + awayScore : null,
      handicap_trend: trendClass(normalized, teamId),
      goals_trend: bigSmall(normalized)
    };
  };
  const output = {};
  for (const side of ["home", "away"]) {
    const teamId = normalizeLeisuTeamScore(parsed?.cur_match?.[side === "home" ? 4 : 5])?.[0];
    const rows = parsed?.history?.[side]?.all || [];
    output[side] = rows.map((r) => convert(r, teamId)).filter(Boolean);
  }
  return output;
}

function normalizeLeisuTeamScore(value) {
  if (value && !Array.isArray(value) && Array.isArray(value.value)) value = value.value;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const parts = value.trim().split(/\s+/);
    return parts.length >= 2 ? [Number(parts[0]), "", ...parts.slice(1).map((item) => item === "" ? null : Number(item))] : [];
  }
  return [];
}

function normalizeLeisuMatchRecord(record) {
  if (!Array.isArray(record)) return null;
  const home = normalizeLeisuTeamScore(record[4]);
  const away = normalizeLeisuTeamScore(record[5]);
  const odds = (value) => {
    if (value && !Array.isArray(value) && Array.isArray(value.value)) value = value.value;
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];
    return value.trim() ? value.trim().split(/\s+/) : [];
  };
  return {
    match_id: record[0] ?? null,
    season_id: record.season_id ?? null,
    competition_id: record[1] ?? null,
    status_id: record[2] ?? null,
    match_time: record[3] ?? null,
    neutral: record.neutral ?? null,
    home_team_id: home[0] ?? null,
    away_team_id: away[0] ?? null,
    home_scores: home.slice(2, 9),
    away_scores: away.slice(2, 9),
    opening_odds: odds(record[6]),
    current_odds: odds(record[7]),
    home_stats: record[8] ?? null,
    away_stats: record[9] ?? null
  };
}

function buildLeagueStandings(parsed) {
  const current = parsed?.cur_match || [];
  const table = parsed?.table?.[0]?.tables?.[0];
  const rows = table?.rows || [];
  const teams = parsed?.teams || {};
  const competitions = parsed?.match_events || {};
  const competitionId = table?.comp_id ?? current[1] ?? null;
  const comp = competitions[String(competitionId)] || {};
  const pick = (teamId) => {
    const row = rows.find((item) => item?.team_id == teamId);
    if (!row) return null;
    const side = (prefix, title) => ({
      title,
      position: row[`${prefix}position`],
      total: row[`${prefix}total`],
      won: row[`${prefix}won`],
      loss: row[`${prefix}loss`],
      draw: row[`${prefix}draw`],
      goals: row[`${prefix}goals`],
      goals_against: row[`${prefix}goals_against`],
      net_goals: row[`${prefix}goals`] - row[`${prefix}goals_against`],
      points: row[`${prefix}points`],
      win_ratio: row[`${prefix}total`] ? `${Math.floor(100 * Number((row[`${prefix}won`] / row[`${prefix}total`]).toFixed(2)))}%` : ""
    });
    return {
      team_id: teamId,
      team_name: teams[String(teamId)]?.name_zh || teams[String(teamId)]?.name || null,
      competition_id: competitionId,
      competition_name: comp.name_zh || comp.name || null,
      season: parsed?.table?.[0]?.season || null,
      total: side("", "总"),
      home: side("home_", "主"),
      away: side("away_", "客")
    };
  };
  return { home_team: pick(current[4]?.[0]), away_team: pick(current[5]?.[0]) };
}

function buildGoalDistributionExport(parsed) {
  const source = parsed?.distribution_data || {};
  const keep = (side) => {
    const value = source[side] || {};
    const pick = (scope) => {
      const item = value[scope] || {};
      return {
        matches: item.matches ?? 0,
        scored: item.scored || [],
        first_scored: item.first_scored || []
      };
    };
    return { all: pick("all"), home: pick("home"), away: pick("away") };
  };
  return { home: keep("home"), away: keep("away") };
}

function finishLiveApi(matchId, reason = null) {
  const pending = pendingLiveApi.get(matchId);
  if (!pending) return;
  clearTimeout(pending.timer);
  clearTimeout(pending.finishTimer);
  pendingLiveApi.delete(matchId);
  if (pending.tabId) chrome.tabs.remove(pending.tabId).catch(() => { });
  const endpoints = pending.endpoints;
  pending.resolve({
    available: Object.keys(endpoints).length > 0,
    complete: ["d", "s", "vd"].every((key) => endpoints[key]),
    reason,
    source: `https://tracker-api.namitiyu.com/api/v3/f/{d|s|vd}?id=${matchId}`,
    endpoints
  });
}

function scheduleLiveApiFinish(matchId) {
  const pending = pendingLiveApi.get(matchId);
  if (!pending || pending.finishTimer) return;
  pending.finishTimer = setTimeout(() => finishLiveApi(matchId), 650);
}

function collectLiveApi(matchId) {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => finishLiveApi(matchId, "api_capture_timeout"),
      8000
    );
    pendingLiveApi.set(matchId, {
      resolve,
      timer,
      finishTimer: null,
      tabId: null,
      endpoints: {}
    });
  });
}

function collectOddsDetail(matchId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const pending = pendingDetails.get(matchId);
      if (pending?.tabId) chrome.tabs.remove(pending.tabId).catch(() => { });
      pendingDetails.delete(matchId);
      resolve({
        available: false,
        reason: "detail_timeout",
        source: `https://odds.leisu.com/3in1-${matchId}`
      });
    }, 15000);

    chrome.tabs.create(
      {
        url: `https://odds.leisu.com/3in1-${matchId}`,
        active: false
      },
      (tab) => {
        if (chrome.runtime.lastError || !tab?.id) {
          clearTimeout(timer);
          resolve({
            available: false,
            reason: chrome.runtime.lastError?.message || "tab_create_failed",
            source: `https://odds.leisu.com/3in1-${matchId}`
          });
          return;
        }
        pendingDetails.set(String(matchId), {
          tabId: tab.id,
          timer,
          resolve
        });
      }
    );
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CODEX_LEISU_RUNTIME_SNAPSHOT") {
    const matchId = String(message.match_id || "");
    if (matchId) {
      const current = recentDetailApi.get(matchId) || { captured_at: Date.now(), responses: {} };
      current.runtime_snapshot = message.snapshot || null;
      current.captured_at = Date.now();
      recentDetailApi.set(matchId, current);
    }
    return;
  }
  /*
   * 雷速详情页诊断工具后台：保留用于雷速前端改版后的解密回归。
   * 此链路会使用 chrome.debugger、刷新当前详情页并输出脚本、原始响应、
   * runtime_snapshot、crypto_trace、soring_trace 与 capture_diagnostic。
   * 不得被“滚球接口获取导出”或任何正式批量导出调用。
   */
  if (message?.type === "CODEX_EXPORT_FULL_CURRENT_DETAIL") {
    const matchId = String(message.match_id || "");
    const urls = [...new Set((message.script_urls || []).map(String))].filter((url) => /^https:\/\/static\.leisu\.com\/public\/js\//i.test(url));
    const tabId = sender?.tab?.id;
    if (!tabId) { sendResponse({ package: { export_type: "leisu_full_current_detail", match_id: matchId, error: "current_detail_tab_missing" } }); return; }
    const capture = new Promise((resolve) => {
      const responses = {};
      const pending = new Map();
      let finished = false;
      const traceExpression = `(() => { if (window.__codexCryptoTraceInstalled) return; window.__codexCryptoTraceInstalled = true; window.__codexCryptoTrace = []; const describe = (v) => { try { if (v && typeof v === 'object' && Array.isArray(v.words)) return { type: 'WordArray', words: v.words.slice(0, 32), sigBytes: v.sigBytes, hex: typeof v.toString === 'function' ? v.toString() : null }; if (typeof v === 'string') return { type: 'string', length: v.length, value: v }; return { type: typeof v, value: String(v) }; } catch (e) { return { error: String(e) }; } }; const wrap = () => { const C = window.CryptoJS; if (!C || !C.AES || !C.enc || C.AES.__codexWrapped) return false; const originalParse = C.enc.Utf8?.parse; const originalStringify = C.enc.Utf8?.stringify; const originalDecrypt = C.AES.decrypt; if (typeof originalParse !== 'function' || typeof originalStringify !== 'function' || typeof originalDecrypt !== 'function') return false; C.enc.Utf8.parse = function(v) { const out = originalParse.apply(this, arguments); window.__codexCryptoTrace.push({ op: 'Utf8.parse', input: describe(v), output: describe(out), stack: new Error().stack }); return out; }; C.enc.Utf8.stringify = function(v) { const out = originalStringify.apply(this, arguments); window.__codexCryptoTrace.push({ op: 'Utf8.stringify', input: describe(v), output: describe(out), stack: new Error().stack }); return out; }; C.AES.decrypt = function(cipher, key, options) { const item = { op: 'AES.decrypt', cipher: describe(cipher), key: describe(key), options: options ? { mode: String(options.mode), padding: String(options.padding) } : null, stack: new Error().stack }; try { const out = originalDecrypt.apply(this, arguments); item.output = describe(out); window.__codexCryptoTrace.push(item); return out; } catch (e) { item.error = String(e?.stack || e); window.__codexCryptoTrace.push(item); throw e; } }; C.AES.__codexWrapped = true; return true; }; const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 25); wrap(); })()`;
      const soringExpression = `(() => { if (window.__codexSoringTraceInstalled) return; window.__codexSoringTraceInstalled = true; window.__codexSoringTrace = []; const describe = (v) => typeof v === 'string' ? { type: 'string', length: v.length, value: v } : { type: typeof v, value: String(v) }; const install = () => { let installed = false; for (const name of Object.getOwnPropertyNames(window)) { let owner; try { owner = window[name]; } catch { continue; } if (!owner || (typeof owner !== 'function' && typeof owner !== 'object')) continue; if (typeof owner.soring === 'function' && !owner.soring.__codexWrapped) { const original = owner.soring; owner.soring = function (...args) { const item = { op: 'soring', owner: name, arg_count: args.length, args: args.map(describe), source: String(original), stack: new Error().stack }; try { const result = original.apply(this, args); item.result = describe(result); window.__codexSoringTrace.push(item); return result; } catch (error) { item.error = String(error?.stack || error); window.__codexSoringTrace.push(item); throw error; } }; owner.soring.__codexWrapped = true; installed = true; } if (owner.AES && typeof owner.AES.decrypt === 'function' && !owner.AES.decrypt.__codexWrapped) { const originalDecrypt = owner.AES.decrypt; owner.AES.decrypt = function (...args) { const item = { op: 'AES.decrypt', owner: name, args: args.map(describe), options: args[2] ? { mode: String(args[2].mode), padding: String(args[2].padding) } : null, stack: new Error().stack }; try { const result = originalDecrypt.apply(this, args); item.result = describe(result); window.__codexSoringTrace.push(item); return result; } catch (error) { item.error = String(error?.stack || error); window.__codexSoringTrace.push(item); throw error; } }; owner.AES.decrypt.__codexWrapped = true; installed = true; } } return installed; }; const timer = setInterval(install, 25); install(); })()`;
      const finish = () => {
        if (finished) return;
        finished = true;
        chrome.debugger.onEvent.removeListener(onEvent);
        chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", { expression: "JSON.stringify({crypto:window.__codexCryptoTrace || [],soring:window.__codexSoringTrace || []})", returnByValue: true }, (result) => {
          let traces = { crypto: [], soring: [] };
          try { traces = JSON.parse(result?.result?.value || "{}"); } catch { }
          chrome.debugger.detach({ tabId }, () => resolve({ responses, cryptoTrace: traces.crypto || [], soringTrace: traces.soring || [] }));
        });
      };
      const onEvent = (source, method, params) => {
        if (source.tabId !== tabId) return;
        if (method === "Network.responseReceived") {
          const response = params?.response || {};
          const url = String(response.url || "");
          const mime = String(response.mimeType || "").toLowerCase();
          const isApiHost = /(?:web-gateway|api-gateway|odds\.leisu|tracker(?:-api)?\.namitiyu|widget\.namitiyu)\.com/i.test(url);
          const isDataMime = /json|text|javascript|xml/.test(mime);
          const isDetailApi = /\/v1\/web\/match\//i.test(url) || /\/api\//i.test(url);
          if (isApiHost && (isDataMime || isDetailApi)) {
            pending.set(params.requestId, { url, status: response.status, mime_type: response.mimeType || null });
          }
        }
        if (method === "Network.loadingFinished" && pending.has(params.requestId)) {
          const item = pending.get(params.requestId); pending.delete(params.requestId);
          chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", { requestId: params.requestId }, (body) => {
            if (!chrome.runtime.lastError && body) responses[item.url] = { status: item.status, mime_type: item.mime_type, base64_encoded: Boolean(body.base64Encoded), body: String(body.body || "") };
          });
        }
      };
      chrome.debugger.onEvent.addListener(onEvent);
      chrome.debugger.attach({ tabId }, "1.3", () => {
        if (chrome.runtime.lastError) { finish(); return; }
        chrome.debugger.sendCommand({ tabId }, "Network.enable", {}, () => {
          chrome.debugger.sendCommand({ tabId }, "Network.setCacheDisabled", { cacheDisabled: true }, () => {
            chrome.debugger.sendCommand({ tabId }, "Page.addScriptToEvaluateOnNewDocument", { source: `${traceExpression};${soringExpression}` }, () => {
            chrome.debugger.sendCommand({ tabId }, "Page.reload", { ignoreCache: true }, () => {
              setTimeout(() => {
                chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", { expression: `(() => { const nodes=[...document.querySelectorAll('button,a,li,div,span')]; const n=nodes.find(x=>String(x.innerText||x.textContent||'').trim()==='数据分析'); if(n){n.click();return true} return false })()`, returnByValue: true });
              }, 2500);
              setTimeout(() => chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", { expression: soringExpression, returnByValue: true }), 2200);
            });
            });
          });
          setTimeout(finish, 12000);
        });
      });
    });
    capture.then(async ({ responses: interfaceResponses, cryptoTrace, soringTrace }) => {
      const scripts = await Promise.all(urls.map(async (url) => { try { const response = await fetch(url, { credentials: "include" }); return [url, { status: response.status, content_type: response.headers.get("content-type") || null, content: (await response.text()).slice(0, 2000000) }]; } catch (error) { return [url, { error: error.message || "script_fetch_failed" }]; } }));
      for (const [url, response] of Object.entries(interfaceResponses)) {
        if (!/match_analysis/i.test(url) || typeof response?.body !== "string") continue;
        try {
          response.data = { decrypted: await decodeMatchAnalysisRaw(response.body) };
        } catch (error) {
          response.data = { decrypted: { available: false, key_source: "extension_rot2", error: String(error?.message || error) } };
        }
      }
      const packageData = { export_type: "leisu_full_current_detail", match_id: matchId, captured_at: new Date().toISOString(), scripts: Object.fromEntries(scripts), interface_responses: interfaceResponses, runtime_snapshot: message.snapshot || null, crypto_trace: cryptoTrace, soring_trace: soringTrace, capture_diagnostic: { source: "current_tab_debugger_network", captured_response_count: Object.keys(interfaceResponses).length, match_analysis_count: Object.keys(interfaceResponses).filter((url) => /match_analysis/i.test(url)).length, crypto_trace_count: cryptoTrace.length, soring_trace_count: soringTrace.length, extension_decode: "rot2-base64-gzip-utf8-json" } };
      chrome.tabs.sendMessage(tabId, { type: "CODEX_FULL_CAPTURE_RESULT", package: packageData }, () => { void chrome.runtime.lastError; });
      sendResponse({ package: packageData });
    });
    return true;
  }
  if (message?.type === "CODEX_LEISU_DETAIL_API_RESPONSE") {
    const matchId = String(message.match_id || "");
    if (!matchId) return;
    const current = recentDetailApi.get(matchId) || {
      captured_at: Date.now(),
      responses: {}
    };
    current.captured_at = Date.now();
    const url = String(message.url || "");
    const incoming = {
      status: Number(message.status || 0),
      data: message.data
    };
    const existing = current.responses[url];
    const bodyLength = (entry) => {
      const body = entry?.data?.body;
      return typeof body === "string" ? body.length : body ? JSON.stringify(body).length : 0;
    };
    // 同一接口可能同时经过 XHR 和 fetch 回传；空响应不能覆盖完整响应。
    if (!existing || bodyLength(incoming) >= bodyLength(existing) || incoming.data?.decrypted?.json_parseable) {
      current.responses[url] = incoming;
    }
    recentDetailApi.set(matchId, current);
    return;
  }

  if (message?.type === "CODEX_DECODE_INTERFACE_PAYLOADS") {
    const decoded_interface = {};
    for (const [url, response] of Object.entries(message.responses || {})) {
      const key = String(url);
      const match = key.match(/\/api\/v3\/f\/(d|vd|s)(?:\?|$)/i);
      const kind = match ? match[1].toLowerCase() : (/^(d|vd|s)$/i.test(key) ? key.toLowerCase() : null);
      if (!kind) continue;
      const decoded = decodeLeisuBinaryResponse(response, kind);
      if (decoded) decoded_interface[url] = removeInterfaceLogos(decoded);
    }
    sendResponse({ decoded_interface });
    return;
  }

  if (message?.type === "CODEX_BUILD_MATCH_ANALYSIS_FIELDS") {
    let parsed = null;
    for (const response of Object.values(message.responses || {})) {
      const decrypted = response?.data?.decrypted;
      if (!decrypted?.json_parseable || typeof decrypted.body !== "string") continue;
      try { parsed = JSON.parse(decrypted.body); break; } catch (_) { }
    }
    if (!parsed) { sendResponse({ parsed_match_analysis: null, analysis_match_context: null, head_to_head: null, team_recent_home: null, team_recent_away: null, future_schedule: null, opening_odds: null, recent_matches: null, league_standings: null, goal_distribution: null, trend_summary: null }); return; }
    sendResponse({
      parsed_match_analysis: removeInterfaceLogos(parsed),
      parsed_match_analysis_keys: Object.keys(parsed),
      analysis_match_context: {
        source: "match_analysis.cur_match",
        realtime: false,
        record: normalizeLeisuMatchRecord(parsed.cur_match)
      },
      head_to_head: removeInterfaceLogos((parsed.history?.vs?.all || parsed.history?.vs || []).map(normalizeLeisuMatchRecord).filter(Boolean)),
      team_recent_home: removeInterfaceLogos((parsed.history?.home?.all || parsed.history?.home || []).map(normalizeLeisuMatchRecord).filter(Boolean)),
      team_recent_away: removeInterfaceLogos((parsed.history?.away?.all || parsed.history?.away || []).map(normalizeLeisuMatchRecord).filter(Boolean)),
      future_schedule: removeInterfaceLogos(parsed.future || null),
      opening_odds: normalizeLeisuMatchRecord(parsed.cur_match)?.opening_odds || [],
      recent_matches: buildRecentMatchRecords(parsed),
      league_standings: buildLeagueStandings(parsed),
      goal_distribution: buildGoalDistributionExport(parsed),
      trend_summary: deriveMatchAnalysisTrend(parsed)
    });
    return;
  }

  if (message?.type === "CODEX_LEISU_DETAIL_BRIDGE_STATUS") {
    const matchId = String(message.match_id || "");
    const current = recentDetailApi.get(matchId) || { captured_at: Date.now(), responses: {} };
    current.bridge_status = message.status || null;
    current.captured_at = Date.now();
    recentDetailApi.set(matchId, current);
    return;
  }

  if (message?.type === "CODEX_GET_LEISU_DETAIL_API") {
    const matchId = String(message.match_id || "");
    const value = recentDetailApi.get(matchId);
    sendResponse({
      available: Boolean(value && Object.keys(value.responses).length),
      captured_at: value?.captured_at || null,
      responses: value?.responses || {}
    });
    return;
  }

  if (message?.type === "CODEX_COLLECT_LEISU_DETAIL_API") {
    collectLeisuDetailApi(String(message.match_id || ""), Boolean(message.require_interface_runtime))
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          available: false,
          reason: error.message || "detail_discovery_failed",
          responses: {}
        })
      );
    return true;
  }

  if (message?.type === "CODEX_LEISU_API_RESPONSE") {
    const matchId = String(message.match_id || "");
    const pending = pendingLiveApi.get(matchId);
    if (!pending) return;
    pending.endpoints[String(message.endpoint || "")] = {
      status: Number(message.status || 0),
      data: message.data
    };
    if (["d", "s", "vd"].every((key) => pending.endpoints[key])) {
      scheduleLiveApiFinish(matchId);
    }
    return;
  }

  if (message?.type === "CODEX_COLLECT_LIVE_API") {
    collectLiveApi(String(message.match_id || ""))
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          available: false,
          reason: error.message || "api_capture_failed"
        })
      );
    return true;
  }

  if (message?.type === "CODEX_LEISU_ODDS_DETAIL") {
    const matchId = String(message.match_id || "");
    const pending = pendingDetails.get(matchId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingDetails.delete(matchId);
    chrome.tabs.remove(pending.tabId).catch(() => { });
    pending.resolve({ available: true, ...message.payload });
    return;
  }

  if (message?.type === "CODEX_COLLECT_ODDS_DETAIL") {
    collectOddsDetail(String(message.match_id))
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          available: false,
          reason: error.message || "detail_failed"
        })
      );
    return true;
  }
});
