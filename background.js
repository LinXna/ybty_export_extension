const pendingDetails = new Map();
const pendingLiveApi = new Map();
const recentDetailApi = new Map();

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

function collectLeisuDetailApi(matchId) {
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
          if (!domReady && Date.now() - startedAt < 18000) {
            setTimeout(finishWhenReady, 250);
            return;
          }
          chrome.tabs.remove(tab.id).catch(() => { });
          resolve({
            available: Boolean(value && Object.keys(responses).length),
            reason: domReady
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
  if (message?.type === "CODEX_LEISU_DETAIL_API_RESPONSE") {
    const matchId = String(message.match_id || "");
    if (!matchId) return;
    const current = recentDetailApi.get(matchId) || {
      captured_at: Date.now(),
      responses: {}
    };
    current.captured_at = Date.now();
    current.responses[String(message.url || "")] = {
      status: Number(message.status || 0),
      data: message.data
    };
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
    collectLeisuDetailApi(String(message.match_id || ""))
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