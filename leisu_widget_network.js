(() => {
  "use strict";

  if (window.__codexLeisuApiCaptureInstalled) return;
  window.__codexLeisuApiCaptureInstalled = true;

  // Capture every football-detail endpoint requested by the widget. Besides
  // d/s/vd, the provider may expose lineups, text commentary, weather and
  // player data through additional short endpoint names.
  const MATCH_API =
    /tracker-api\.namitiyu\.com\/api\/v3\/f\/([a-z0-9_-]+)\b/i;

  function publish(url, status, body) {
    const match = String(url || "").match(MATCH_API);
    if (!match) return;
    let data = body;
    if (typeof body === "string") {
      try {
        data = JSON.parse(body);
      } catch {
        // Keep the raw response for diagnostics if the provider changes format.
      }
    }
    window.postMessage(
      {
        source: "codex-leisu-api",
        endpoint: match[1].toLowerCase(),
        url: String(url),
        status: Number(status || 0),
        data
      },
      "*"
    );
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(index, index + chunkSize)
      );
    }
    return btoa(binary);
  }

  async function responseBody(xhr) {
    // The widget asks XHR to decode protobuf as text. Replay the same public
    // request with the original fetch implementation so the bytes remain
    // lossless for our protobuf decoder.
    try {
      const replay = await originalFetch(xhr.__codexLeisuUrl, {
        credentials: "include"
      });
      if (replay.ok) {
        const buffer = await replay.arrayBuffer();
        return {
          encoding: "base64",
          body: bytesToBase64(new Uint8Array(buffer))
        };
      }
    } catch {
      // Continue with the original XHR response.
    }
    try {
      if (typeof xhr.responseText === "string" && xhr.responseText) {
        return xhr.responseText;
      }
    } catch {
      // responseText is unavailable for json/blob/arraybuffer response types.
    }
    const value = xhr.response;
    if (typeof value === "string") return value;
    if (value instanceof ArrayBuffer) {
      return {
        encoding: "base64",
        body: bytesToBase64(new Uint8Array(value))
      };
    }
    if (value instanceof Blob) {
      const buffer = await value.arrayBuffer();
      return {
        encoding: "base64",
        body: bytesToBase64(new Uint8Array(buffer))
      };
    }
    if (value && typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return "";
      }
    }
    return "";
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__codexLeisuUrl = String(url || "");
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (MATCH_API.test(this.__codexLeisuUrl || "")) {
      this.addEventListener(
        "load",
        async () => {
          publish(
            this.__codexLeisuUrl,
            this.status,
            await responseBody(this)
          );
        },
        { once: true }
      );
    }
    return originalSend.apply(this, args);
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const url = String(args[0]?.url || args[0] || "");
      if (MATCH_API.test(url)) {
        response
          .clone()
          .text()
          .then((body) => publish(url, response.status, body))
          .catch(() => {});
      }
      return response;
    };
  }
})();
