(() => {
  "use strict";

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "codex-leisu-api") {
      return;
    }
    const url = new URL(event.data.url, location.href);
    const matchId =
      url.searchParams.get("id") || new URL(location.href).searchParams.get("id");
    if (!matchId) return;
    chrome.runtime.sendMessage({
      type: "CODEX_LEISU_API_RESPONSE",
      match_id: String(matchId),
      endpoint: event.data.endpoint,
      status: event.data.status,
      data: event.data.data
    });
  });
})();
