// Legacy UI cleanup plus bounded startup cleanup; no request bodies are logged.
(function () {
const raw = $response.body || "";
const url = $request.url || "";
const changes = {};
const apiMatch = /^https?:\/\/api\.m\.jd\.com\/(?:client\.action|api)(?:\?([^#]*))?$/.exec(url);
if (!apiMatch || typeof raw !== "string" || raw.length > 1048576) {
  $done({});
  return;
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(text) {
  if (!text || text.length % 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error("invalid-base64");
  }
  const bytes = [];
  let bits = 0;
  let buffer = 0;
  for (const char of text.replace(/=+$/, "")) {
    buffer = (buffer << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push("%" + ((buffer >> bits) & 255).toString(16).padStart(2, "0"));
    }
  }
  if (bits && (buffer & ((1 << bits) - 1))) throw new Error("noncanonical-base64");
  return decodeURIComponent(bytes.join(""));
}

function encodeBase64(text) {
  const bytes = encodeURIComponent(text).replace(/%([0-9A-F]{2})/g,
    (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes.charCodeAt(i);
    const b = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : 0;
    const c = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : 0;
    result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=") +
      (i + 2 < bytes.length ? alphabet[c & 63] : "=");
  }
  return result;
}

function parsePayload(text) {
  try {
    return { value: JSON.parse(text), base64: false };
  } catch (_) {
    return { value: JSON.parse(decodeBase64(text.trim())), base64: true };
  }
}

function cleanStartup(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  if (body.success === false ||
      (body.code !== undefined && body.code !== 0 && body.code !== "0")) return 0;
  const payload = body.data && typeof body.data === "object" ? body.data : body;
  if (Array.isArray(payload) || !Array.isArray(payload.images)) return 0;
  const functionIds = (apiMatch[1] || "").split("&")
    .filter(part => part.startsWith("functionId="))
    .map(part => decodeURIComponent(part.slice(11)));
  if (functionIds.length > 1) return 0;
  const functionId = functionIds[0];
  const knownStartup = functionId === "start" || functionId === "startup";
  const hasCount = Object.prototype.hasOwnProperty.call(payload, "showTimesDaily");
  const count = payload.showTimesDaily;
  const validCount = (Number.isSafeInteger(count) && count >= 0) ||
    (typeof count === "string" && /^\d{1,9}$/.test(count));
  // Hidden functionId: require both startup fields, never generic images alone.
  if ((!knownStartup && (functionId !== undefined || !hasCount || !validCount)) ||
      (hasCount && !validCount)) return 0;
  let total = 0;
  if (payload.images.length) { payload.images = []; total++; }
  if (hasCount && Number(count) !== 0) {
    payload.showTimesDaily = typeof count === "string" ? "0" : 0;
    total++;
  }
  return total;
}

try {
  const parsed = parsePayload(raw);
  const total = cleanStartup(parsed.value);
  if (total) {
    const body = JSON.stringify(parsed.value);
    console.log("[GAUSS-JD-SPLASH] changed=" + total + " base64=" + parsed.base64);
    $done({ body: parsed.base64 ? encodeBase64(body) : body });
    return;
  }
} catch (_) {
  // Unknown encodings and malformed responses pass through unchanged.
}

// Preserve the previous UI handler's scope; do not apply it to every API call.
const legacyGame = /^https?:\/\/api\.m\.jd\.com\/(client\.action|api)$/.test(url);
const legacyHome = /^https?:\/\/api\.m\.jd\.com\/client\.action\?functionId=(welcomeHome|personinfoBusiness|getTabHomeInfo)(?:&|$)/.test(url);
if (!legacyGame && !legacyHome) {
  $done({});
  return;
}

function changed(name, count = 1) {
  changes[name] = (changes[name] || 0) + count;
}

function removeKeysDeep(node, keys) {
  if (Array.isArray(node)) {
    node.forEach((item) => removeKeysDeep(item, keys));
    return;
  }
  if (!node || typeof node !== "object") return;

  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      delete node[key];
      changed(key);
    }
  });
  Object.keys(node).forEach((key) => removeKeysDeep(node[key], keys));
}

function containsAnyKey(node, keys, depth = 0) {
  if (!node || depth > 14) return false;
  if (Array.isArray(node)) {
    return node.some((item) => containsAnyKey(item, keys, depth + 1));
  }
  if (typeof node !== "object") return false;
  return Object.keys(node).some(
    (key) => keys.has(key) || containsAnyKey(node[key], keys, depth + 1),
  );
}

function removeLiveFloors(node) {
  if (Array.isArray(node)) {
    node.forEach(removeLiveFloors);
    return;
  }
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node.floorList)) {
    const before = node.floorList.length;
    const liveKeys = new Set([
      "liveInfo1",
      "liveInfo2",
      "leftLiveJson",
      "rightLiveJson",
    ]);
    node.floorList = node.floorList.filter(
      (floor) => !containsAnyKey(floor, liveKeys),
    );
    if (before !== node.floorList.length) {
      changed("liveFloor", before - node.floorList.length);
    }
  }
  Object.keys(node).forEach((key) => removeLiveFloors(node[key]));
}

const loanPattern = /借钱|借款|贷款|白条|金条|理财|loan|credit/i;

function hasDirectUnwantedString(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return Object.keys(item).some(
    (key) => typeof item[key] === "string" && loanPattern.test(item[key]),
  );
}

function filterArray(owner, key, label) {
  if (!owner || !Array.isArray(owner[key])) return;
  const before = owner[key].length;
  owner[key] = owner[key].filter((item) => !hasDirectUnwantedString(item));
  if (before !== owner[key].length) changed(label, before - owner[key].length);
}

try {
  const body = JSON.parse(raw);

  removeKeysDeep(body, new Set([
    "gameLatelyList",
    "playGamePointRecordsResponse",
    "newGameVoList",
  ]));

  if (/functionId=(welcomeHome|personinfoBusiness|getTabHomeInfo)(?:&|$)/i.test(url)) {
    removeLiveFloors(body);
  }

  if (/\/myWalletIndexAsyncData(?:\?|$)/i.test(url)) {
    const data = body.resultData && body.resultData.data;
    if (data && Object.prototype.hasOwnProperty.call(data, "jtDkInfo")) {
      delete data.jtDkInfo;
      changed("jtDkInfo");
    }
  } else if (/\/myWalletIndex(?:\?|$)/i.test(url)) {
    const data = body.resultData && body.resultData.data;
    const modules = data && data.moduleSortedMap;
    if (modules) {
      [
        "CASH_LOAN_V3",
        "ATMOSPHERE_BANNER_V3",
        "POPUP_DECISION_V3",
        "SUSPENSION_ICON_V3",
      ].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(modules, key)) {
          delete modules[key];
          changed(key);
        }
      });
      if (modules.ASSETS_V3) {
        filterArray(modules.ASSETS_V3, "secondLineResourceVoList", "walletAssetLoanEntry");
      }
      if (modules.HOME_SERVICE_FIRST_TWO_V3) {
        filterArray(modules.HOME_SERVICE_FIRST_TWO_V3, "iconVoList", "walletServiceLoanEntry");
      }
    }
  }

  if (/\/walletEntryQuery(?:\?|$)/i.test(url)) {
    const data = body.resultData && body.resultData.data;
    if (data) filterArray(data, "items", "walletMarketingEntry");
  }

  if (/\/queryDeliveryChannelInfo(?:\?|$)/i.test(url)) {
    const data = body.resultData && body.resultData.data;
    if (data) {
      if (data.isShowFeed !== false) changed("isShowFeed");
      if (data.isShowBanner !== false) changed("isShowBanner");
      if (data.bannerMaxNum !== 0) changed("bannerMaxNum");
      data.isShowFeed = false;
      data.isShowBanner = false;
      data.bannerMaxNum = 0;
    }
  }

  const total = Object.keys(changes).reduce((sum, key) => sum + changes[key], 0);
  console.log("[GAUSS-JD-CLEAN] " + JSON.stringify({
    endpoint: url.replace(/^https?:\/\//i, "").split("?")[0],
    total,
    changes,
  }));
  $done(total > 0 ? { body: JSON.stringify(body) } : {});
} catch (error) {
  console.log("[GAUSS-JD-CLEAN] " + JSON.stringify({
    endpoint: url.replace(/^https?:\/\//i, "").split("?")[0],
    error: "non-json-or-parse-failure",
  }));
  $done({});
}
})();
