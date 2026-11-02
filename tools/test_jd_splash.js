const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const script = fs.readFileSync(path.join(__dirname, "../scripts/jd-response-cleanup.js"), "utf8");
const base = "https://api.m.jd.com/client.action";
const b64 = text => Buffer.from(text, "utf8").toString("base64");

function run(body, url = base + "?", requestBody = undefined) {
  let result;
  let calls = 0;
  const logs = [];
  vm.runInNewContext(script, {
    $request: { url, body: requestBody }, $response: { body },
    $done: value => { result = JSON.parse(JSON.stringify(value)); calls++; },
    console: { log: value => logs.push(value) },
  }, { timeout: 1000 });
  assert.equal(calls, 1);
  return { result, logs };
}

// Synthetic fixtures exercise published field names, not private phone captures.
function fixture() {
  return { code: 0, data: { images: [{ url: "https://example.invalid/promo" }],
    showTimesDaily: 3, deviceLevel: "L1", logo: "keep-logo", title: "双十一测试中文😀",
    keep: { duration: 7, settings: [1, true, null] } }, trace: "keep-envelope" };
}

test("plain startup keeps logo, metadata and envelope", () => {
  for (const functionId of ["start", "startup"]) {
    const input = fixture();
    const { result, logs } = run(JSON.stringify(input), base + "?client=apple&functionId=" + functionId);
    input.data.images = [];
    input.data.showTimesDaily = 0;
    assert.deepEqual(JSON.parse(result.body), input);
    assert.equal(logs[0], "[GAUSS-JD-SPLASH] changed=2 base64=false");
    assert.ok(!logs.join("").includes("promo"));
  }
});

test("hidden functionId base64 roundtrip and Unicode, without runtime codecs", () => {
  const input = fixture();
  const { result, logs } = run(b64(JSON.stringify(input)));
  assert.ok(!result.body.startsWith("{"));
  input.data.images = [];
  input.data.showTimesDaily = 0;
  assert.deepEqual(JSON.parse(Buffer.from(result.body, "base64").toString("utf8")), input);
  assert.match(logs[0], /base64=true$/);
  assert.deepEqual(run(result.body).result, {});
});

test("unwrapped old start response, encoded functionId and string count", () => {
  const payload = { images: [1], showTimesDaily: "4", logo: "keep" };
  assert.deepEqual(JSON.parse(run(JSON.stringify(payload), base + "?functionId=%73tart").result.body),
    { images: [], showTimesDaily: "0", logo: "keep" });
  assert.deepEqual(JSON.parse(run('{"images":[1]}', base + "?functionId=start").result.body), { images: [] });
  assert.deepEqual(run('{"images":[]}', base + "?functionId=start").result, {});
});

test("generic images, logo and countdown do not identify a splash", () => {
  for (const payload of [
    { images: [1], logo: "keep" }, { deviceLevel: "L1" },
    { logo: "keep", countdown: 5, skip: true },
    { images: [1], showTimesDaily: null },
    { images: [1], showTimesDaily: -1 },
    { images: [1], showTimesDaily: {} },
    { images: {}, showTimesDaily: 5 },
    { code: 1, data: fixture().data }, { success: false, data: fixture().data },
  ]) {
    for (const encode of [text => text, b64]) {
      assert.deepEqual(run(encode(JSON.stringify(payload))).result, {});
    }
  }
});

test("explicit other API, duplicate IDs and query text cannot select startup", () => {
  for (const query of [
    "functionId=login", "functionId=submitOrder", "functionId=wareBusiness",
    "functionId=startExtra", "functionId=start&functionId=login",
    "functionId=&other=start", "functionId=%XX",
  ]) assert.deepEqual(run(JSON.stringify(fixture()), base + "?" + query).result, {});
  assert.deepEqual(run('{"images":[1]}', base + "?redirect=functionId=start").result, {});
});

test("host and path boundaries", () => {
  for (const url of [
    "https://api.m.jd.com.evil.invalid/client.action?functionId=start",
    "https://example.invalid/client.action?functionId=start",
    "https://api.m.jd.com/client.action.other?functionId=start",
    "https://api.m.jd.com/api/other?functionId=start",
    "https://ipay.jd.com/pay?functionId=start",
  ]) assert.deepEqual(run(JSON.stringify(fixture()), url).result, {});
});

test("malformed, non-JSON, excessive and binary inputs pass through", () => {
  for (const value of ["", "null", "1", "[]", "{", "<html>error</html>",
    "!!!!", "eyJ===", b64("not-json"), "/w==", "A".repeat(1048577)]) {
    assert.deepEqual(run(value).result, {});
  }
});

test("legacy game and home cleanup is preserved, not expanded to other APIs", () => {
  const game = { gameLatelyList: [1], keep: "ok" };
  assert.deepEqual(JSON.parse(run(JSON.stringify(game), base).result.body), { keep: "ok" });
  assert.deepEqual(run(JSON.stringify(game), base + "?functionId=login").result, {});
  const home = { floorList: [{ liveInfo1: {} }, { type: "normal" }], keep: "ok" };
  assert.deepEqual(JSON.parse(run(JSON.stringify(home), base + "?functionId=welcomeHome").result.body),
    { floorList: [{ type: "normal" }], keep: "ok" });
  assert.deepEqual(run(JSON.stringify(home), base + "?client=apple&functionId=welcomeHome").result, {});
});

test("already empty startup is unchanged; requests and business fields never logged", () => {
  const body = JSON.stringify({ code: "0", data: { images: [], showTimesDaily: 0, logo: "keep" } });
  const { result, logs } = run(body, base + "?functionId=start", "private-request-marker");
  assert.deepEqual(result, {});
  assert.equal(logs.length, 0);
});

test("base64 codec handles varied UTF-8 and padding lengths", () => {
  for (const title of ["", "a", "ab", "abc", "中文", "😀", "éñ", "a\u0000b", "x%+/?&"]) {
    const body = fixture();
    body.data.title = title;
    const { result } = run(b64(JSON.stringify(body)));
    body.data.images = [];
    body.data.showTimesDaily = 0;
    assert.equal(result.body, b64(JSON.stringify(body)));
  }
});
