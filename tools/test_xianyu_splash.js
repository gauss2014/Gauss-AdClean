const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../scripts/xianyu-splash-cleanup.js"), "utf8");
const splash = "https://acs.m.goofish.com/gw/mtop.taobao.idlecommerce.splash.ads/2.0/";

function run(body, url = splash) {
  let calls = 0;
  let result;
  const logs = [];
  vm.runInNewContext(source, {
    $request: { url },
    $response: { body, status: 200 },
    $done: (value) => { calls++; result = JSON.parse(JSON.stringify(value)); },
    console: { log: (value) => logs.push(value) },
  }, { timeout: 1000 });
  assert.equal(calls, 1);
  return { result, logs };
}

test("new cache references cleared, MTOP envelope and unrelated fields preserved", () => {
  const input = {
    api: "mtop.taobao.idlecommerce.splash.ads", v: "2.0",
    ret: ["SUCCESS::OK"], trace: "keep-envelope",
    data: {
      cacheAd: "private-cache-value", cacheAdInfo: { url: "private-url" },
      dspList: [{ id: "private-dsp" }], keep: { name: "keep-value" },
    },
  };
  const { result, logs } = run(JSON.stringify(input));
  assert.deepEqual(JSON.parse(result.body), {
    api: input.api, v: input.v, ret: input.ret, trace: input.trace,
    data: { cacheAd: "", dspList: [], keep: input.data.keep },
  });
  assert.deepEqual(logs, ["[GAUSS-XY-SPLASH] changed=3"]);
  assert.deepEqual(Object.keys(result), ["body"]);
});

test("old nested adMap and known containers, preserving all other data", () => {
  const data = {
    data: { adMap: { slot: ["ad"] }, keep: 7 },
    ads: ["ad"], splashAds: ["ad"], advertising: { url: "ad" },
    adList: ["ad"], splashList: ["ad"],
    children: [{ cacheAd: "cached", keep: "preserve" }],
  };
  const { result } = run(JSON.stringify({ data }),
    "https://g-acs.m.taobao.com/gw/mtop.taobao.idlecommerce.splash.async.ads/1.0/");
  assert.deepEqual(JSON.parse(result.body).data, {
    data: { adMap: {}, keep: 7 }, ads: [], splashAds: [], advertising: {},
    adList: [], splashList: [], children: [{ cacheAd: "", keep: "preserve" }],
  });
});

test("unchanged, malformed, non-JSON, and oversized bodies pass through", () => {
  for (const body of ["", "<html>error</html>", "{", "null", "42", "[]",
    '{"ret":["FAIL_SYS_TOKEN_EXOIRED"],"data":{}}',
    '{"data":{"itemList":[{"id":123}],"ads":"unknown-schema"}}',
    '{"data":{"adMap":{},"cacheAd":""}}', " ".repeat(262145)]) {
    assert.deepEqual(run(body).result, {});
  }
});

test("only exact splash paths on explicit hosts can modify data", () => {
  const body = '{"data":{"cacheAd":"keep","ads":[1]}}';
  for (const url of [
    "https://acs.m.goofish.com/gw/mtop.taobao.idle.trade.order/1.0/",
    splash.replace("goofish.com", "goofish.com.evil.invalid"),
    splash.replace("splash.ads/", "splash.adsOther/"),
    "https://acs.m.goofish.com/gw/mtop.user.login/1.0/?redirect=" + splash,
  ]) assert.deepEqual(run(body, url).result, {});
});

test("second pass is a no-op and error envelopes are not forged into success", () => {
  const input = { ret: ["FAIL::test"], data: { adMap: { slot: 1 } } };
  const first = run(JSON.stringify(input)).result.body;
  assert.deepEqual(JSON.parse(first).ret, input.ret);
  assert.deepEqual(run(first).result, {});
});

test("excessive traversal passes through rather than returning a partial rewrite", () => {
  const data = { cacheAd: "keep-if-aborted", nested: Array.from({ length: 10001 }, () => ({})) };
  assert.deepEqual(run(JSON.stringify({ data })).result, {});
});
