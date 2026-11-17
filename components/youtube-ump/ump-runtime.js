import { ctr } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, equalBytes } from '@noble/ciphers/utils.js';
import { gunzipSync, gzipSync } from 'fflate';
import { decompress as brotliDecode } from 'brotli/decompress.js';
import { MessageType, base64decode, base64encode } from '@protobuf-ts/runtime';
import { CompositeBuffer, UmpReader, UmpWriter } from 'googlevideo/ump';
import { schema, clean, cleanPlayer, cleanFeed } from './schema.generated.js';
export { schema };

export const VERSION = 'qx-ump-v0.2.0-beta2';
const MAX_BODY = 4194304;
const MAX = 2097152;
const CACHE = 'Gauss-QX-UMP-keys-v1';
const scalar = (no, name, T, extra = {}) => ({no, name, kind: 'scalar', T, ...extra});
export const CryptoParams = new MessageType('local.CryptoParams', [
  scalar(4, 'hmac', 12), scalar(5, 'iv', 12), scalar(6, 'compression', 5),
]);
export const Header = new MessageType('local.OnesieHeader', [
  scalar(1, 'type', 5), {no: 4, name: 'crypto', kind: 'message', T: () => CryptoParams},
]);
export const Envelope = new MessageType('local.OnesieResponse', [
  scalar(1, 'status', 5), scalar(2, 'httpStatus', 5), scalar(4, 'body', 12, {repeat: 2}),
]);
export const EncryptedPart = new MessageType('local.EncryptedPart', [
  scalar(1, 'body', 12), scalar(2, 'hmac', 12), scalar(3, 'iv', 12), scalar(4, 'compression', 5),
]);

function join(chunks) { return concatBytes(...chunks); }
function hex(bytes) { return [...bytes].map(x => x.toString(16).padStart(2, '0')).join(''); }
function limited(bytes) {
  if (bytes.length > MAX) throw Error('DECOMPRESSED_SIZE_SKIP');
  return bytes;
}
function rawBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  throw Error('BODY_UNAVAILABLE');
}
function loadKeys() {
  try {
    const entries = JSON.parse($prefs.valueForKey(CACHE) || '[]');
    return entries.filter(x => x.expires > Date.now() && typeof x.key === 'string').slice(-8);
  } catch (_) { return []; }
}
function captureConfig(body) {
  const msg = schema.config.fromBinary(body);
  const hot = msg.responseContext?.globalConfigGroup?.hotConfigGroup?.mediaHotConfig?.onesieHotConfig;
  if (!hot || hot.clientKey.length !== 32 || !hot.encryptKey.length) return false;
  const key = base64encode(hot.clientKey);
  const ttl = Number(hot.keyExpiresInSeconds);
  const entries = loadKeys().filter(x => x.key !== key);
  entries.push({key, expires: Date.now() + Math.min(ttl > 0 ? ttl : 3600, 86400) * 1000});
  if (!$prefs.setValueForKey(JSON.stringify(entries.slice(-8)), CACHE)) throw Error('KEY_SAVE_FAILED');
  return true;
}

function authenticate(body, cp, keys) {
  if (cp.iv?.length !== 16 || cp.hmac?.length !== 32) throw Error('CRYPTO_FIELDS_MISSING');
  for (const key of keys) {
    if (key.length !== 32) continue;
    const mac = hmac(sha256, key.subarray(16), concatBytes(body, cp.iv));
    if (equalBytes(mac, cp.hmac)) return key;
  }
  throw Error(keys.length ? 'KEY_MISMATCH' : 'KEY_MISSING');
}
export function decrypt(body, cp, keys) {
  const key = authenticate(body, cp, keys);
  const data = ctr(key.subarray(0, 16), cp.iv).decrypt(body);
  let plain;
  if (cp.compression === 0) plain = data;
  else if (cp.compression === 1) {
    // Reject a gzip expansion beyond the existing 2 MiB processing budget.
    if (data.length < 4 || new DataView(data.buffer, data.byteOffset + data.length - 4, 4)
      .getUint32(0, true) > MAX) throw Error('DECOMPRESSED_SIZE_SKIP');
    plain = gunzipSync(data);
  } else if (cp.compression === 2) plain = brotliDecode(data, MAX);
  else throw Error('COMPRESSION_UNSUPPORTED');
  return {key, plain: limited(plain)};
}

export function encrypt(plain, cp, key) {
  // HMAC-derived synthetic IV: changed plaintext gets a different counter,
  // without depending on Math.random or an unavailable native RNG in QX.
  const data = cp.compression === 0 ? plain : gzipSync(plain);
  const domain = Uint8Array.from('Gauss-QX-UMP-IV-v1\0', c => c.charCodeAt(0));
  const iv = hmac(sha256, key.subarray(16), concatBytes(domain, cp.iv, sha256(data))).slice(0, 16);
  const body = ctr(key.subarray(0, 16), iv).encrypt(data);
  const mac = hmac(sha256, key.subarray(16), concatBytes(body, iv));
  // Brotli input is emitted as gzip; the protobuf compression enum is updated.
  return {body, iv, hmac: mac, compression: cp.compression === 0 ? 0 : 1};
}

function cleanPart(bytes, allowPlayer) {
  // GetWatch content is a nested Player/Next; some type-0 envelopes hold Player directly.
  for (const type of allowPlayer ? [schema.part, schema.player] : [schema.part]) {
    try {
      const msg = type.fromBinary(bytes);
      let removed = 0;
      if (type === schema.player) removed = cleanPlayer(msg);
      else {
        if (msg.player) removed += cleanPlayer(msg.player);
        if (msg.next) removed += cleanFeed(msg.next, true);
      }
      if (removed) return {bytes: type.toBinary(msg), removed};
    } catch (_) {}
  }
  return {bytes, removed: 0};
}

export async function transformUMP(body, keys) {
  const parts = [];
  const reader = new UmpReader({onPart(type, buffer) { parts.push({type, bytes: join(buffer.chunks)}); }});
  await reader.feed(body);
  // The bundled reader retains incomplete tails; never publish a truncated stream.
  if (reader.compositeBuffer.getLength() !== 0) throw Error('UMP_TRUNCATED');
  let removed = 0;
  const stats = {frames: parts.length, pairs: 0, decrypted: 0, envelopeSkipped: 0, types: {}};
  for (let i = 0; i + 1 < parts.length; i++) {
    const first = parts[i], next = parts[i + 1];
    if (first.type !== 10 || next.type !== 11) continue;
    const header = Header.fromBinary(first.bytes);
    stats.pairs++;
    stats.types[header.type] = (stats.types[header.type] || 0) + 1;
    if (header.type === 0) {
      if (!header.crypto) throw Error('CRYPTO_FIELDS_MISSING');
      const {key, plain} = decrypt(next.bytes, header.crypto, keys);
      stats.decrypted++;
      const envelope = Envelope.fromBinary(plain);
      if (envelope.status !== 1 || envelope.httpStatus !== 200) { stats.envelopeSkipped++; continue; }
      let delta = 0;
      envelope.body = envelope.body.map(bytes => {
        const result = cleanPart(bytes, true); delta += result.removed; return result.bytes;
      });
      if (!delta) continue;
      const encrypted = encrypt(Envelope.toBinary(envelope), header.crypto, key);
      Object.assign(header.crypto, {iv: encrypted.iv, hmac: encrypted.hmac, compression: encrypted.compression});
      first.bytes = Header.toBinary(header);
      next.bytes = encrypted.body;
      removed += delta;
    } else if (header.type === 25) {
      const part = EncryptedPart.fromBinary(next.bytes);
      const {key, plain} = decrypt(part.body, part, keys);
      stats.decrypted++;
      const result = cleanPart(plain, false);
      if (!result.removed) continue;
      Object.assign(part, encrypt(result.bytes, part, key));
      next.bytes = EncryptedPart.toBinary(part);
      removed += result.removed;
    }
  }
  if (!removed) return {bytes: body, removed, stats};
  const output = new CompositeBuffer(), writer = new UmpWriter(output);
  for (const part of parts) writer.write(part.type, part.bytes);
  const result = join(output.chunks);
  if (result.length > MAX_BODY) throw Error('SIZE_SKIP');
  return {bytes: result, removed, stats};
}

function report(outcome, detail = '') {
  console.log('[GAUSS-QX-UMP] ' + outcome + ' ' + detail);
  try {
    const key = VERSION + '-notice-' + outcome;
    if ($prefs.valueForKey(key)) return;
    $prefs.setValueForKey('1', key);
    $notify('Gauss YouTube UMP TEST', outcome, detail);
  } catch (_) {}
}

export async function run() {
  let routeLabel = 'unmatched';
  try {
    const url = $request.url || '';
    const api = /^https:\/\/(?:youtubei|youtubei-att)\.googleapis\.com\/youtubei\/v1\/([^?]+)(?:\?.*)?$/.exec(url);
    const cdn = /^https:\/\/(?!redirector)[\w-]+\.googlevideo\.com\/initplayback(?:\?|$)/.test(url);
    if (!api && !cdn) return $done({});
    routeLabel = cdn ? 'initplayback' : (Object.prototype.hasOwnProperty.call(schema.routes, api[1]) || /^(log_event|config)$/.test(api[1]) ? api[1] : 'other-api');
    if (typeof $response === 'undefined') {
      if (api && /^(log_event|config)$/.test(api[1]) && !loadKeys().length) {
        const headers = {...$request.headers};
        for (const key of Object.keys(headers)) {
          if (/^x-youtube-hot-hash-data$/i.test(key)) delete headers[key];
        }
        return $done({headers});
      }
      return $done({});
    }
    const status = /^(?:HTTP\/[\d.]+\s+)?(\d{3})(?:\s.*)?$/.exec(String($response.statusCode ?? $response.status ?? '').trim());
    if (!status || Number(status[1]) !== 200) return $done({});
    const body = rawBytes($response.bodyBytes);
    if (body.length > MAX_BODY) { report('SIZE_SKIP', 'route=' + routeLabel + ' bytes=' + body.length); return $done({}); }
    if (api && /^(config|log_event)$/.test(api[1])) {
      if (captureConfig(body)) report('KEY_READY', 'route=' + routeLabel);
      return $done({});
    }
    let result;
    if (cdn) result = await transformUMP(body, loadKeys().map(x => base64decode(x.key)));
    else {
      const route = api[1], type = schema.routes[route];
      if (!type) return $done({});
      const msg = type.fromBinary(body);
      const removed = clean(route, msg);
      result = {removed, bytes: removed ? type.toBinary(msg) : body};
    }
    report(result.removed ? (cdn ? 'UMP_FILTERED' : 'API_FILTERED') : 'NO_AD_FIELDS',
      'route=' + routeLabel + ' removed=' + result.removed + ' bytes=' + body.length +
      (result.stats ? ' ump=' + JSON.stringify(result.stats) : ''));
    if (!result.removed) return $done({});
    const bytes = result.bytes;
    return $done({bodyBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)});
  } catch (e) {
    // Never log URLs, protobuf bodies, keys or upstream exception text.
    const known = /^(KEY_MISSING|KEY_MISMATCH|KEY_SAVE_FAILED|UMP_TRUNCATED|CRYPTO_FIELDS_MISSING|COMPRESSION_UNSUPPORTED|DECOMPRESSED_SIZE_SKIP|BODY_UNAVAILABLE|SIZE_SKIP)$/;
    report(known.test(e.message) ? e.message : 'PARSE_BYPASS', 'route=' + routeLabel);
    return $done({});
  }
}
