// Temporary, read-only structure probe for JD responses.
// It logs matching JSON paths and field names only, never field values.
const raw = $response.body || "";
const url = $request.url || "";
const endpointMatch = url.match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?/i);
const functionMatch = url.match(/[?&]functionId=([^&#]+)/i);
const endpoint = endpointMatch ? endpointMatch[1] + (endpointMatch[2] || "/") : "unknown";
const functionId = functionMatch ? decodeURIComponent(functionMatch[1]) : "";
const keywords = /(游戏|电玩|借钱|借款|贷款|白条|金条|理财|视频|直播|短视频|钱包|game|loan|credit|finance|wallet|video|live)/i;
const hits = [];

function visit(node, path, depth) {
  if (hits.length >= 60 || depth > 14 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length && hits.length < 60; i += 1) {
      visit(node[i], path.concat("[" + i + "]"), depth + 1);
    }
    return;
  }
  if (typeof node !== "object") return;

  const keys = Object.keys(node);
  const matchedFields = [];
  for (const key of keys) {
    const value = node[key];
    if (keywords.test(key) || (typeof value === "string" && keywords.test(value))) {
      matchedFields.push(key);
    }
  }
  if (matchedFields.length) {
    hits.push({
      path: path.length ? path.join(".") : "$",
      matchedFields: matchedFields.slice(0, 12),
      keys: keys.slice(0, 24),
    });
  }
  for (const key of keys) visit(node[key], path.concat(key), depth + 1);
}

try {
  const parsed = JSON.parse(raw);
  visit(parsed, [], 0);
  console.log("[GAUSS-JD-DIAG] " + JSON.stringify({ endpoint, functionId, hits }));
} catch (error) {
  console.log("[GAUSS-JD-DIAG] " + JSON.stringify({ endpoint, functionId, format: "non-json" }));
}

$done({});
