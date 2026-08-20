(() => {
  "use strict";
  if (window.__codexLeisuDetailCaptureInstalled) return;
  window.__codexLeisuDetailCaptureInstalled = true;
  const pageMatch = location.pathname.match(/detail-(\d+)/);
  if (!pageMatch) return;
  const matchId = pageMatch[1];
  const captureId = `${matchId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const relevant = (url) => {
    const value = String(url || "");
    if (
      /\/chat\/msg_history|\/video_link|\/url_auth/i.test(value)
    ) {
      return false;
    }
    return (
      (/\/api\//i.test(value) || /tracker|leisu|namitiyu/i.test(value)) &&
      !/\.(?:js|css|png|jpe?g|gif|svg|woff2?)(?:\?|$)/i.test(value)
    );
  };
  const relevantScript = (url) =>
    /static\.leisu\.com\/public\/js\/(?:mod_live\/football\/detail(?:\/[^?]+)?|base\/statistics-[^?]+\.js)/i.test(String(url || ""));
  const bytesToBase64 = (bytes) => {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  };
  async function serialize(response) {
    const clone = response.clone();
    const contentType = clone.headers.get("content-type") || "";
    if (/json|text|javascript/i.test(contentType)) {
      return {
        encoding: "text",
        content_type: contentType,
        body: await clone.text()
      };
    }
    const bytes = new Uint8Array(await clone.arrayBuffer());
    return {
      encoding: "base64",
      content_type: contentType,
      body: bytesToBase64(bytes)
    };
  }
  const publish = (url, status, data) => {
    if (!relevant(url) && !relevantScript(url)) return;
    if (/match_(?:analysis|lineup)/i.test(String(url || "")) && data?.encoding === "text" && typeof data.body === "string") {
      let outer = null;
      let decrypt = null;
      try {
        outer = JSON.parse(data.body);
        const code = Number(outer?.code);
        const keyIndex = code - 100;
        if (code >= 100 && code < 127 && outer?.data) {
          // 雷速真实的响应转换器使用 $.rot2(data, code - 100)。
          // soring 是其他页面数据的辅助函数，不能用于 match_analysis。
          decrypt = window.jQuery?.rot2 || window.$?.rot2;
          if (typeof decrypt !== "function") throw new Error("page_rot2_not_found");
          const callTrace = {
            arg_count: 2,
            arg_types: [typeof outer.data, typeof keyIndex],
            arg_lengths: [String(outer.data).length, null],
            key_index_argument: keyIndex,
            stack: new Error().stack
          };
          let aesTrace = null;
          const crypto = window.CryptoJS;
          const originalAesDecrypt = crypto?.AES?.decrypt;
          if (typeof originalAesDecrypt === "function") {
            crypto.AES.decrypt = function (...args) {
              aesTrace = {
                arg_count: args.length,
                ciphertext_type: typeof args[0],
                ciphertext_length: typeof args[0] === "string" ? args[0].length : null,
                key_type: typeof args[1],
                key: typeof args[1] === "string" ? args[1] : String(args[1]),
                options: args[2] || null,
                stack: new Error().stack
              };
              return originalAesDecrypt.apply(this, args);
            };
          }
          let plain;
          try {
            plain = String(decrypt.call(window.jQuery || window.$, outer.data, keyIndex) || "");
          } finally {
            if (typeof originalAesDecrypt === "function") crypto.AES.decrypt = originalAesDecrypt;
          }
          let parsed = null;
          try { parsed = JSON.parse(plain); } catch { }
          data.decrypted = {
            code,
            key_index: keyIndex,
            capture_id: captureId,
            captured_at: new Date().toISOString(),
            cipher: String(outer.data),
            cipher_length: String(outer.data).length,
            key_source: "page_rot2",
            runtime_white: String(window.LeisuJS?.white || ""),
            decrypt_source: String(decrypt).slice(0, 3000),
            call_trace: callTrace,
            aes_trace: aesTrace,
            plain_length: plain.length,
            json_parseable: Boolean(parsed),
            json_keys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 200) : [],
            body: plain
          };
        }
      } catch (error) {
        data.decrypted = {
          code: Number(outer?.code || 0),
          key_index: Number(outer?.code || 0) - 100,
          runtime_white: String(window.LeisuJS?.white || ""),
          rot2_available: typeof (window.jQuery?.rot2 || window.$?.rot2) === "function",
          decrypt_source: typeof decrypt === "function" ? String(decrypt).slice(0, 3000) : null,
          call_trace: typeof decrypt === "function" ? {
            arg_count: 2,
            arg_types: [typeof outer?.data, "number"],
            key_index_argument: Number(outer?.code || 0) - 100,
            stack: new Error().stack
          } : null,
          cipher_length: typeof outer?.data === "string" ? outer.data.length : 0,
          capture_id: captureId,
          captured_at: new Date().toISOString(),
          error: String(error?.message || error)
        };
      }
    }
    window.postMessage(
      {
        source: "codex-leisu-detail-api",
        match_id: matchId,
        url: String(url),
        status: Number(status || 0),
        data
      },
      window.location.origin // 替换 '*'，防止信息泄露
    );
  };
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__codexDetailUrl = String(url || "");
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (relevant(this.__codexDetailUrl) || relevantScript(this.__codexDetailUrl)) {
      this.addEventListener(
        "load",
        async () => {
          try {
            const contentType = this.getResponseHeader("content-type") || "";
            let body = "";
            if (typeof this.responseText === "string") body = this.responseText;
            else if (this.response instanceof ArrayBuffer) body = new TextDecoder().decode(this.response);
            publish(this.__codexDetailUrl, this.status, {
              encoding: "text", content_type: contentType, body
            });
          } catch {
            try {
              publish(this.__codexDetailUrl, this.status, {
                encoding: "text",
                content_type: "",
                body: String(this.responseText || "")
              });
            } catch {
              // Ignore unreadable responses.
            }
          }
        },
        { once: true }
      );
    }
    return originalSend.apply(this, args);
  };
  if (typeof originalFetch === "function") {
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const url = String(args[0]?.url || args[0] || "");
      if (relevant(url) || relevantScript(url)) {
        serialize(response)
          .then((data) => publish(url, response.status, data))
          .catch(() => { });
      }
      return response;
    };
  }

  const safeSnapshot = (value, depth = 0, seen = new WeakSet()) => {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (depth > 10 || seen.has(value)) return "[Circular]";
    if (typeof value !== "object") return String(value);
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 500).map((item) => safeSnapshot(item, depth + 1, seen));
    const output = {};
    for (const key of Object.keys(value).slice(0, 500)) {
      try { output[key] = safeSnapshot(value[key], depth + 1, seen); } catch { output[key] = "[Unreadable]"; }
    }
    return output;
  };
  // 雷速 detail 前端把首屏接口载荷解析到 LIVE_DETAIL_VUE：
  // tlive 来自 match_detail.tlive；lineup 来自 match_lineup 接口。
  // 这里读取 Vue 运行时对象，不读取页面文字或阵容 DOM。
  const publishFormalRuntime = () => {
    let runtime = null;
    try {
      runtime = typeof LIVE_DETAIL_VUE !== "undefined" ? LIVE_DETAIL_VUE : null;
    } catch { }
    if (!runtime) return false;
    window.postMessage({
      source: "codex-leisu-detail-api",
      match_id: matchId,
      url: "runtime:frontend-interface-state",
      status: 200,
      data: {
        encoding: "json",
        content_type: "application/json",
        body: {
          source: "leisu_frontend_runtime",
          text_live_source: "match_detail.tlive",
          lineup_source: "match_lineup",
          attack_momentum_source: "LIVE_DETAIL_VUE.trend.data",
          attack_momentum_trend: safeSnapshot(runtime.trend || {}),
          tlive: safeSnapshot(runtime.tlive || []),
          detail_live_list: safeSnapshot(runtime.detail_live_list || []),
          lineup: safeSnapshot(runtime.lineup || {}),
          lineup_state: Boolean(runtime.lineup_state),
          home_formation: runtime.home_formation || null,
          away_formation: runtime.away_formation || null,
          home_manager: safeSnapshot(runtime.home_manager || null),
          away_manager: safeSnapshot(runtime.away_manager || null),
          captured_at: new Date().toISOString()
        }
      }
    }, location.origin);
    return true;
  };
  // 保存详情页首屏业务载荷本身，而不是赔率/文字直播的可视 DOM。
  // 雷速 detail 源码的真实调用链是：
  // JSON.parse($.rot(splitimg(#weatherArea[src]), 1))。
  const publishInitialDetailPayload = () => {
    const raw = document.querySelector("#weatherArea")?.getAttribute("src");
    if (!raw) return false;
    let decoded = null;
    let error = null;
    try {
      const rot = window.jQuery?.rot || window.$?.rot;
      if (typeof window.splitimg !== "function" || typeof rot !== "function") {
        throw new Error("page_initial_payload_decoder_not_ready");
      }
      decoded = JSON.parse(rot.call(window.jQuery || window.$, window.splitimg(raw), 1));
    } catch (failure) {
      error = String(failure?.message || failure);
    }
    window.postMessage({
      source: "codex-leisu-detail-api",
      match_id: matchId,
      url: "payload:initial-detail",
      status: decoded ? 200 : 500,
      data: {
        encoding: "json",
        content_type: "application/json",
        body: {
          source: "weatherArea.src",
          decoder: "JSON.parse($.rot(splitimg(raw), 1))",
          raw,
          raw_length: raw.length,
          decoded: safeSnapshot(decoded),
          decoded_keys: decoded && typeof decoded === "object" ? Object.keys(decoded) : [],
          error,
          captured_at: new Date().toISOString()
        }
      }
    }, location.origin);
    return Boolean(decoded);
  };
  // 某些比赛页面不会主动展开阵容区域，因此显式请求雷速前端使用的同一接口。
  // 请求仍经过上方 XHR 捕获器，原始响应会以真实 URL 写入 evidence。
  const requestMatchLineup = () => {
    try {
      const base = String(window.APIWEB || "https://web-gateway.leisu.com").replace(/\/$/, "");
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `${base}/v1/web/match/football/match_lineup?match_id=${encodeURIComponent(matchId)}`, true);
      xhr.withCredentials = true;
      xhr.send();
      return true;
    } catch {
      return false;
    }
  };
  let runtimeAttempts = 0;
  let lineupRequested = false;
  let initialPayloadPublished = false;
  const runtimeTimer = setInterval(() => {
    runtimeAttempts += 1;
    if (!initialPayloadPublished) initialPayloadPublished = publishInitialDetailPayload();
    if (!lineupRequested && runtimeAttempts >= 4) lineupRequested = requestMatchLineup();
    const published = publishFormalRuntime();
    if ((published && runtimeAttempts >= 8) || runtimeAttempts >= 24) clearInterval(runtimeTimer);
  }, 250);
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "codex-runtime-snapshot-request") return;
    const soring = window.jQuery?.soring || window.$?.soring;
    window.postMessage({
      source: "codex-runtime-snapshot",
      match_id: matchId,
      capture_id: captureId,
      captured_at: new Date().toISOString(),
      runtime_leisu: safeSnapshot(window.LeisuJS || {}),
      leisu_keys: Object.keys(window.LeisuJS || {}),
      soring_source: typeof soring === "function" ? String(soring) : null,
      vue_match: safeSnapshot(window.vue_match || null),
      vue_match_data: safeSnapshot(window.vue_match?.$data || null),
      shujufenxiData: safeSnapshot(window.vue_match?.shujufenxiData || null),
      match_analysis: safeSnapshot(window.vue_match?.match_analysis || null)
    }, location.origin);
  });
})();
