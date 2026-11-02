// Endpoint/schema evidence: skernelx/SurgeScripts d98eba9 (2026-11-01).
// Only splash data is changed; no network calls, storage, or response-value logs.
(function () {
  const endpoint = /^https?:\/\/(?:(?:(?:g|guide)-)?acs|gw|h5api)\.m\.(?:goofish|taobao)\.com\/(?:gw|h5)\/mtop\.taobao\.(?:idlecommerce\.splash\.(?:async\.)?ads|idle\.splash\.ads)(?:\/|\?|$)/;
  let result = {};
  try {
    const raw = $response.body;
    if (!endpoint.test($request.url || "") || typeof raw !== "string" ||
        raw.length > 262144) {
      $done(result);
      return;
    }
    const body = JSON.parse(raw);
    if (!body || Array.isArray(body) || typeof body !== "object" ||
        !body.data || typeof body.data !== "object") {
      $done(result);
      return;
    }
    const containers = new Set([
      "adMap", "ads", "splashAds", "advertising", "adList", "splashList", "dspList",
    ]);
    let changed = 0;
    let visited = 0;
    function clean(node, depth) {
      if (!node || typeof node !== "object" || depth > 8) return;
      if (++visited > 10000) throw new Error("node limit");
      Object.keys(node).forEach(function (key) {
        const value = node[key];
        if (key === "cacheAd" && value !== "") {
          node[key] = "";
          changed++;
        } else if (key === "cacheAdInfo") {
          delete node[key];
          changed++;
        } else if (containers.has(key) && value &&
                   typeof value === "object" && Object.keys(value).length) {
          node[key] = Array.isArray(value) ? [] : {};
          changed++;
        } else {
          clean(value, depth + 1);
        }
      });
    }
    clean(body.data, 0);
    if (changed) result = { body: JSON.stringify(body) };
    console.log("[GAUSS-XY-SPLASH] changed=" + changed);
  } catch (_) {
    // Unknown/non-JSON/error responses pass through without changing status.
    result = {};
  }
  $done(result);
})();
