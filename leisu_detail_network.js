(() => {
  "use strict";
  if (window.__codexLeisuDetailCaptureInstalled) return;
  window.__codexLeisuDetailCaptureInstalled = true;
  const pageMatch = location.pathname.match(/detail-(\d+)/);
  if (!pageMatch) return;
  const matchId = pageMatch[1];
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const OriginalWebSocket = window.WebSocket;
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
        body: (await clone.text()).slice(0, 1500000)
      };
    }
    const bytes = new Uint8Array(await clone.arrayBuffer());
    return {
      encoding: "base64",
      content_type: contentType,
      body: bytesToBase64(bytes.subarray(0, 1500000))
    };
  }
  const publish = (url, status, data) => {
    if (!relevant(url)) return;
    window.postMessage(
      {
        source: "codex-leisu-detail-api",
        match_id: matchId,
        url: String(url),
        status: Number(status || 0),
        data
      },
      "*"
    );
  };
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__codexDetailUrl = String(url || "");
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (relevant(this.__codexDetailUrl)) {
      this.addEventListener(
        "load",
        async () => {
          try {
            const replay = await originalFetch(this.__codexDetailUrl, {
              credentials: "include"
            });
            publish(this.__codexDetailUrl, replay.status, await serialize(replay));
          } catch {
            try {
              publish(this.__codexDetailUrl, this.status, {
                encoding: "text",
                content_type: "",
                body: String(this.responseText || "").slice(0, 1500000)
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
      if (relevant(url)) {
        serialize(response)
          .then((data) => publish(url, response.status, data))
          .catch(() => {});
      }
      return response;
    };
  }

  if (typeof OriginalWebSocket === "function") {
    window.WebSocket = function (...args) {
      const socket = new OriginalWebSocket(...args);
      const url = String(args[0] || "");
      socket.addEventListener("message", async (event) => {
        try {
          let data = event.data;
          if (data instanceof ArrayBuffer) {
            data = {
              encoding: "base64",
              content_type: "application/octet-stream",
              body: bytesToBase64(new Uint8Array(data))
            };
          } else if (data instanceof Blob) {
            const bytes = new Uint8Array(await data.arrayBuffer());
            data = {
              encoding: "base64",
              content_type: data.type || "application/octet-stream",
              body: bytesToBase64(bytes)
            };
          } else {
            data = {
              encoding: "text",
              content_type: "text/plain",
              body: String(data || "").slice(0, 1500000)
            };
          }
          window.postMessage(
            {
              source: "codex-leisu-detail-api",
              match_id: matchId,
              url: `websocket:${url}`,
              status: 101,
              data
            },
            "*"
          );
        } catch {
          // Ignore unreadable websocket frames.
        }
      });
      return socket;
    };
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    Object.defineProperties(window.WebSocket, {
      CONNECTING: { value: OriginalWebSocket.CONNECTING },
      OPEN: { value: OriginalWebSocket.OPEN },
      CLOSING: { value: OriginalWebSocket.CLOSING },
      CLOSED: { value: OriginalWebSocket.CLOSED }
    });
  }
})();
