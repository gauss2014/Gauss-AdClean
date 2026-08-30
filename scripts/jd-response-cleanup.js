// JD 15.10.50 response cleanup based on locally captured response structures.
// This script logs endpoint and change counts only. It never logs field values.
const raw = $response.body || "";
const url = $request.url || "";
const changes = {};

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
