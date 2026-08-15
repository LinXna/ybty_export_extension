/*
 * 雷速接口迁移实验层（历史参考工具，不参与扩展运行）
 *
 * 目的：不接管现有导出流程，只提供接口响应的解码和结构化提取工具。
 * 当前覆盖：tracker-api d/s/vd 响应、web-gateway match_lineup 响应。
 * 现有 leisu_content.js / DOM 流程暂不修改。
 *
 * 归档说明：正式接口导出已由 background.js 与 leisu_content.js 接管。
 * 本文件仅用于查阅早期解码、字段标准化和控制台验证思路，不应加入 manifest。
 */
(() => {
  "use strict";

  const text = (value) => String(value ?? "").trim();

  // 雷速 match_analysis 的真实 code=100..126 解码链：
  // code -> keyIndex -> 字母反向位移 -> Base64 -> GZIP -> UTF-8 -> JSON。
  function rotateMatchAnalysis(value, keyIndex) {
    const shift = Number(keyIndex);
    if (!Number.isInteger(shift)) throw new Error("invalid_match_analysis_key_index");
    return [...String(value ?? "")].map((char) => {
      const code = char.charCodeAt(0);
      if (code >= 65 && code <= 90) return String.fromCharCode((code - 65 - shift + 26) % 26 + 65);
      if (code >= 97 && code <= 122) return String.fromCharCode((code - 97 - shift + 26) % 26 + 97);
      return char;
    }).join("");
  }

  async function inflateGzip(bytes) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("gzip_decompression_unavailable");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function decodeMatchAnalysis(payload) {
    const envelope = typeof payload === "string" ? JSON.parse(payload) : payload;
    const code = Number(envelope?.code);
    if (!Number.isInteger(code) || code < 100 || code >= 127) {
      return { available: false, reason: "unsupported_match_analysis_code", code: envelope?.code ?? null };
    }
    const keyIndex = code - 100;
    const rotated = rotateMatchAnalysis(envelope.data, keyIndex);
    const binary = atob(rotated.replace(/\s+/g, ""));
    const compressed = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const inflated = await inflateGzip(compressed);
    const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(inflated);
    return {
      available: true,
      code,
      key_index: keyIndex,
      encoding: "rot2-base64-gzip-utf8-json",
      compressed_byte_size: compressed.length,
      decoded_byte_size: inflated.length,
      data: JSON.parse(jsonText)
    };
  }

  function decodeBase64(value) {
    const raw = text(value);
    if (!raw) return "";
    try {
      const binary = atob(raw.replace(/\s+/g, ""));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      return "";
    }
  }

  function decodeGatewayEnvelope(payload) {
    const raw = typeof payload === "string" ? payload : decodeBody(payload);
    if (!raw) return { available: false, reason: "empty_body" };
    try {
      const envelope = JSON.parse(raw);
      const body = decodeBase64(envelope.data || "");
      return {
        available: Boolean(body),
        code: envelope.code ?? null,
        message: envelope.msg ?? null,
        time: envelope.time ?? null,
        encoding: "base64",
        base64_size: String(envelope.data || "").length,
        decoded_byte_size: body.length,
        decoded_bytes: Array.from(body),
        decoded_utf8_preview: new TextDecoder("utf-8", { fatal: false })
          .decode(body)
          .replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, "")
          .slice(0, 2000)
      };
    } catch (error) {
      return { available: false, reason: error.message || "gateway_decode_failed" };
    }
  }

  function decodeBody(payload) {
    if (!payload) return "";
    if (payload.data && typeof payload.data === "object") return decodeBody(payload.data);
    if (typeof payload === "string") return payload;
    if (payload.encoding === "base64") return decodeBase64(payload.body);
    if (typeof payload.body === "string") return payload.body;
    return payload.body == null ? "" : JSON.stringify(payload.body);
  }

  function parseJsonBody(payload) {
    const body = decodeBody(payload);
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  function parseMatchAnalysis(payload) {
    const decrypted = payload?.data?.decrypted || payload?.decrypted;
    const raw = decrypted?.data && typeof decrypted.data === "object"
      ? decrypted.data
      : decrypted?.body
        ? (() => { try { return JSON.parse(decrypted.body); } catch { return null; } })()
        : null;
    const root = raw?.data && typeof raw.data === "object" ? raw.data : raw;
    const statistics = normalizeStatistics(root?.statistics || root?.stats || root || {});
    return {
      available: Boolean((decrypted?.json_parseable || decrypted?.available) && raw),
      code: decrypted?.code ?? null,
      key_index: decrypted?.key_index ?? null,
      capture_id: decrypted?.capture_id || null,
      runtime_white: decrypted?.runtime_white || null,
      decode_source: decrypted?.key_source || decrypted?.decrypt_source || null,
      statistics,
      raw,
      decrypted
    };
  }

  function pair(home, away) {
    return {
      home: Number.isFinite(Number(home)) ? Number(home) : null,
      away: Number.isFinite(Number(away)) ? Number(away) : null
    };
  }

  // 将接口统计结果映射为当前导出 schema 使用的字段。
  function normalizeStatistics(raw) {
    const output = {};
    const names = {
      corners: "corners",
      attacks: "attacks",
      dangerous_attacks: "dangerous_attacks",
      shots: "shots",
      shots_on_target: "shots_on_target",
      shots_off_target: "shots_off_target",
      possession: "possession",
      yellow_cards: "yellow_cards",
      red_cards: "red_cards",
      penalties: "penalties"
    };
    for (const [source, target] of Object.entries(names)) {
      const value = raw?.[source];
      if (value && typeof value === "object") {
        const result = pair(value.home ?? value[0], value.away ?? value[1]);
        if (result.home !== null || result.away !== null) output[target] = result;
      }
    }
    for (const key of ["yellow_cards", "red_cards"]) {
      output[key] ||= { home: 0, away: 0 };
    }
    return output;
  }

  // 接受已捕获的接口响应：{ d: payload, s: payload, vd: payload }。
  function extractStatistics(endpointResponses) {
    const decoded = {};
    for (const [name, payload] of Object.entries(endpointResponses || {})) {
      decoded[name] = parseJsonBody(payload);
    }
    // 第一阶段只处理已经是标准键值结构的响应；复杂包装结构交由后续适配器扩展。
    const merged = Object.assign({}, ...Object.values(decoded).filter(Boolean));
    return {
      available: Object.keys(decoded).some((key) => decoded[key] !== null),
      decoded_endpoints: decoded,
      statistics: normalizeStatistics(merged)
    };
  }

  // 只有明确存在双方本场首发时才输出阵容，普通球队名单不进入结果。
  function normalizeLineup(raw) {
    const home = Array.isArray(raw?.home?.starters) ? raw.home.starters : [];
    const away = Array.isArray(raw?.away?.starters) ? raw.away.starters : [];
    const formal = home.length > 0 && away.length > 0;
    return {
      available: formal,
      status: formal ? "formal_match_lineup" : "not_obtained",
      home: formal ? raw.home : { starters: [], substitutes: [], players: [] },
      away: formal ? raw.away : { starters: [], substitutes: [], players: [] }
    };
  }

  function normalizeLiveText(entries) {
    const list = Array.isArray(entries) ? entries : [];
    return list
      .map((value) => text(value).replace(/^[-–—]\s*/, "").trim())
      .filter(Boolean)
      .map((value) => {
        const match = value.match(/^(\d{1,3}(?:\+\d{1,2})?)\s*['′]\s*[-–—]?\s*(.*)$/);
        return {
          minute: match?.[1] || null,
          text: match?.[2] || value,
          display: match ? `${match[1]}'- ${match[2]}` : value
        };
      });
  }

  function extractLiveTextFromContext(context) {
    const direct = context?.live_text || context?.entries || [];
    const records = Array.isArray(context?.text_records)
      ? context.text_records.map((item) => item?.text).filter(Boolean)
      : [];
    const sourceValues = direct.length ? direct : records;
    const eventPattern = /进球|射门|射正|角球|黄牌|红牌|换人|点球|受伤|伤停|中场|上半场|下半场|比赛结束|比赛开始|VAR/i;
    const entries = sourceValues.filter((value) => eventPattern.test(text(value)));
    return {
      available: Array.isArray(entries) && entries.length > 0,
      entries: normalizeLiveText(entries),
      source: direct.length
        ? "match_analysis_interface_context"
        : "match_analysis_interface_text_records",
      text_record_count: records.length
    };
  }

  function inspectCapturedResponses(responses) {
    const statisticsEndpoints = {};
    let lineup = null;
    for (const [url, payload] of Object.entries(responses || {})) {
      if (/(?:^|\/)(?:d|s|vd)(?:\?|$)/.test(url)) {
        const name = url.match(/\/((?:d|s|vd))(?:\?|$)/)?.[1];
        if (name) statisticsEndpoints[name] = payload;
      }
      if (/match_lineup/i.test(url)) lineup = parseJsonBody(payload);
    }
    return {
      statistics: extractStatistics(statisticsEndpoints),
      lineup: normalizeLineup(lineup)
    };
  }

  globalThis.CodexLeisuInterfaceMigration = {
    rotateMatchAnalysis,
    decodeMatchAnalysis,
    decodeBody,
    decodeGatewayEnvelope,
    parseJsonBody,
    normalizeStatistics,
    parseMatchAnalysis,
    extractStatistics,
    normalizeLineup,
    extractLiveTextFromContext,
    inspectCapturedResponses
  };
})();
