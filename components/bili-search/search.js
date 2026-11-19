import { BinaryReader } from '@protobuf-ts/runtime';
import { gunzipSync, gzipSync } from 'fflate';

const limit = 2 * 1024 * 1024;
const reader = buf => new BinaryReader(buf, {}); // No string decoding needed.
function adItem(buf) {
  const r = reader(buf);
  let ad = false;
  while (r.pos < r.len) {
    const [field, wire] = r.tag();
    if (field === 25 && wire === 2) ad = true; // Item.card_item.cm
    r.skip(wire);
  }
  return ad;
}
function clean(body) {
  if (body.length < 5 || body.length > limit) return {};
  const size = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(1);
  if (size !== body.length - 5 || body[0] > 1) return {};
  let msg = body.subarray(5);
  if (body[0]) {
    if (msg.length < 18 || msg[0] !== 31 || msg[1] !== 139) return {};
    const n = new DataView(msg.buffer, msg.byteOffset, msg.byteLength).getUint32(msg.length - 4, true);
    if (n > limit) return {};
    msg = gunzipSync(msg, {out: new Uint8Array(n)});
    if (msg.length !== n) return {};
  }
  const r = reader(msg);
  const ranges = [];
  let start = 0, removed = 0, length = 0;
  while (r.pos < r.len) {
    const pos = r.pos, [field, wire] = r.tag();
    if (field === 4 && wire === 2) { // SearchAllResponse.item
      if (adItem(r.bytes())) {
        ranges.push(msg.subarray(start, pos));
        length += pos - start;
        start = r.pos;
        ++removed;
      }
    } else r.skip(wire);
  }
  if (!removed) return {removed};
  ranges.push(msg.subarray(start));
  let result = new Uint8Array(length + msg.length - start), off = 0;
  for (const slice of ranges) { result.set(slice, off); off += slice.length; }
  if (body[0]) result = gzipSync(result);
  const framed = new Uint8Array(5 + result.length);
  framed[0] = body[0];
  new DataView(framed.buffer).setUint32(1, result.length);
  framed.set(result, 5);
  return {removed, bodyBytes: framed.buffer};
}
let change = {};
let status = 'bypass';
try {
  if ($response.bodyBytes && /^https:\/\/(?:app\.bilibili\.com|grpc\.biliapi\.net)\/bilibili\.polymer\.app\.search\.v1\.Search\/SearchAll(?:\?|$)/.test($request.url)) {
    const result = clean(new Uint8Array($response.bodyBytes));
    if (result.removed !== undefined) status = 'removed=' + result.removed;
    if (result.bodyBytes) change = {bodyBytes: result.bodyBytes};
  }
} catch (_) { status = 'parse-bypass'; }
console.log('[Gauss-Bili-Search] SearchAll ' + status);
$done(change);
