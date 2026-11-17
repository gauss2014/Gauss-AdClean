const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const code = fs.readFileSync(__dirname + '/runtime.test-bundle.js', 'utf8');
const key = crypto.randomBytes(32);
let count = 0;
const results = [];
const preferences = new Map();
const logs = [];
function context(request, response) {
  let resolve;
  const done = new Promise(r => resolve = r);
  const globals = {
    $request: request, console: {log: x => logs.push(String(x))},
    $prefs: {valueForKey: k => preferences.get(k), setValueForKey: (v, k) => {preferences.set(k, v); return true;}},
    $notify: (...x) => logs.push(x.join(' ')), $done: r => resolve(r),
  };
  if (response) globals.$response = response;
  const ctx = vm.createContext(globals);
  vm.runInContext(code, ctx, {timeout: 5000});
  const bytes = b => vm.runInContext(`new Uint8Array(${JSON.stringify([...b])})`, ctx);
  if (response) response.bodyBytes = bytes(response.bodyBytes).buffer;
  return {ctx, api: ctx.GaussUMP, bytes, done};
}
const base = context({url:'', headers:{}});
const a = base.api, bytes = base.bytes;
function pack(type, value) { return Buffer.from(type.toBinary(type.create(value))); }
function mac(cipher, iv) { return crypto.createHmac('sha256', key.subarray(16)).update(cipher).update(iv).digest(); }
function encrypted(data, compression, iv = crypto.randomBytes(16)) {
  const payload = compression === 1 ? zlib.gzipSync(data) : compression === 2 ? zlib.brotliCompressSync(data) : data;
  const c = crypto.createCipheriv('aes-128-ctr', key.subarray(0,16), iv);
  const body = Buffer.concat([c.update(payload), c.final()]);
  return {body: bytes(body), iv: bytes(iv), hmac: bytes(mac(body, iv)), compression};
}
function opened(p) {
  assert.deepEqual(Buffer.from(p.hmac), mac(p.body, p.iv));
  const d = crypto.createDecipheriv('aes-128-ctr', key.subarray(0,16), p.iv);
  const b = Buffer.concat([d.update(p.body), d.final()]);
  return p.compression === 1 ? zlib.gunzipSync(b) : p.compression === 2 ? zlib.brotliDecompressSync(b) : b;
}
function uv(n) {
  if(n < 128) return Buffer.from([n]);
  if(n < 16384) return Buffer.from([0x80 | (n & 63), n >>> 6]);
  if(n < 2097152) return Buffer.from([0xc0 | (n & 31), n >>> 5 & 255, n >>> 13]);
  return Buffer.from([0xe0 | (n & 15), n >>> 4 & 255, n >>> 12 & 255, n >>> 20]);
}
function frame(t, b) { return Buffer.concat([uv(t), uv(b.length), Buffer.from(b)]); }
function frames(raw) {
  let offset = 0;
  function read() {
    const first = raw[offset++];
    const size = first < 128 ? 1 : first < 192 ? 2 : first < 224 ? 3 : first < 240 ? 4 : 5;
    let value = size === 5 ? 0 : first & (255 >>> size), shift = size === 5 ? 0 : 8 - size;
    for(let j=1;j<size;j++,shift+=8) value += raw[offset++] * 2 ** shift;
    return value;
  }
  const out = [];
  while(offset < raw.length) { const type=read(), len=read(); out.push({type, body:raw.slice(offset,offset+len)}); offset+=len; }
  assert.equal(offset, raw.length);
  return out;
}
async function test(name, fn) {
  await fn(); count++; results.push(name); console.log('PASS ' + name);
}
const player = pack(a.schema.player, {adPlacements:[{}], adSlots:[{}]});
const cleanPlayer = pack(a.schema.player, {});
const part = pack(a.schema.part, {player:a.schema.player.fromBinary(bytes(player))});
const media = crypto.randomBytes(4096);
function stream(kind, compression, payload = kind === 0 ? player : part) {
  const plain = kind === 0 ? pack(a.Envelope,{status:1,httpStatus:200,body:[bytes(payload)]}) : payload;
  const packet = encrypted(plain, compression);
  const header = pack(a.Header, kind === 0 ? {type:0,crypto:packet} : {type:25});
  const data = kind === 0 ? packet.body : pack(a.EncryptedPart,packet);
  return {packet, raw:Buffer.concat([frame(10,header),frame(11,data),frame(21,media),frame(250,Buffer.from('unknown'))])};
}
function verifyChanged(raw, kind) {
  const f=frames(raw);
  const header=a.Header.fromBinary(bytes(f[0].body));
  const packet=kind===0 ? {...header.crypto,body:f[1].body} : a.EncryptedPart.fromBinary(bytes(f[1].body));
  const plain=opened(packet);
  let parsed;
  if(kind===0) {
    const e=a.Envelope.fromBinary(bytes(plain));
    parsed=a.schema.player.fromBinary(e.body[0]);
  } else parsed=a.schema.part.fromBinary(bytes(plain)).player;
  assert.equal(parsed.adPlacements.length,0); assert.equal(parsed.adSlots.length,0);
  assert.deepEqual(Buffer.from(f[2].body),media); assert.equal(Buffer.from(f[3].body).toString(),'unknown');
  return packet;
}
async function runQX(url, body, statusCode=200) {
  const c=context({url,headers:{'User-Agent':'com.google.ios.youtube'}},{statusCode,headers:{},bodyBytes:body});
  await c.api.run(); return c.done;
}
(async()=>{
  for(const kind of [0,25]) for(const compression of [0,1,2]) {
    await test(`UMP ${kind}, compression ${compression}, independent crypto + media preserved`,async()=>{
      const {raw,packet}=stream(kind,compression);
      const r=await a.transformUMP(bytes(raw),[bytes(key)]);
      assert.equal(r.removed,2);
      const changed=verifyChanged(r.bytes,kind);
      assert.notDeepEqual(Buffer.from(changed.iv),Buffer.from(packet.iv));
    });
  }
  await test('nested GetWatch in type 0',async()=>{
    const {raw}=stream(0,1,part);
    const r=await a.transformUMP(bytes(raw),[bytes(key)]);
    assert.equal(r.removed,2);
  });
  await test('unknown protobuf fields retained',async()=>{
    // field 100 (bytes) and its literal value are not declared by the Player schema.
    const unknown=Buffer.from([0xa2,6,4,0x74,0x65,0x73,0x74]);
    const {raw}=stream(0,0,Buffer.concat([player,unknown]));
    const r=await a.transformUMP(bytes(raw),[bytes(key)]);
    const f=frames(r.bytes), h=a.Header.fromBinary(bytes(f[0].body));
    const e=a.Envelope.fromBinary(bytes(opened({...h.crypto,body:f[1].body})));
    assert(Buffer.from(e.body[0]).includes(unknown));
  });
  await test('no ads leaves original stream byte exact',async()=>{
    const {raw}=stream(0,2,cleanPlayer);
    const r=await a.transformUMP(bytes(raw),[bytes(key)]);
    assert.equal(r.removed,0);assert.deepEqual(Buffer.from(r.bytes),raw);
  });
  await test('multiple metadata pairs',async()=>{
    const first=stream(0,0).raw, second=stream(25,1).raw;
    const r=await a.transformUMP(bytes(Buffer.concat([first,second])),[bytes(key)]);
    assert.equal(r.removed,4);
  });
  await test('key rotation tries retained keys',async()=>{
    const r=await a.transformUMP(bytes(stream(25,0).raw),[bytes(crypto.randomBytes(32)),bytes(key)]);
    assert.equal(r.removed,2);
  });
  await test('missing/wrong key and truncated UMP rejected',async()=>{
    const raw=stream(0,0).raw;
    await assert.rejects(a.transformUMP(bytes(raw),[]),/KEY_MISSING/);
    await assert.rejects(a.transformUMP(bytes(raw),[bytes(crypto.randomBytes(32))]),/KEY_MISMATCH/);
    await assert.rejects(a.transformUMP(bytes(raw.subarray(0,raw.length-1)),[bytes(key)]),/UMP_TRUNCATED/);
  });
  await test('synthetic IV separates differing changed plaintexts',()=>{
    const packet=encrypted(player,0);
    const p=a.encrypt(bytes([1,2]),packet,bytes(key));
    const q=a.encrypt(bytes([1,3]),packet,bytes(key));
    assert.notDeepEqual(Buffer.from(p.iv),Buffer.from(q.iv));
    assert.deepEqual(opened(p),Buffer.from([1,2]));
  });
  await test('QX missing key passthrough',async()=>{
    const r=await runQX('https://rr1---sn-test.googlevideo.com/initplayback?ack=1',stream(0,0).raw);
    assert.equal(Object.keys(r).length,0);
    assert(logs.some(x=>x.includes('KEY_MISSING')));
  });
  await test('QX config capture then real wrapper UMP rewrite',async()=>{
    const config=pack(a.schema.config,{responseContext:{globalConfigGroup:{hotConfigGroup:{mediaHotConfig:{onesieHotConfig:{
      clientKey:new Uint8Array(key),encryptKey:new Uint8Array([1,2,3]),keyExpiresInSeconds:'3600',
    }}}}}});
    const r=await runQX('https://youtubei.googleapis.com/youtubei/v1/config',config);
    assert.equal(Object.keys(r).length,0);
    const s=await runQX('https://rr1---sn-test.googlevideo.com/initplayback?ack=1',stream(0,2).raw);
    verifyChanged(new Uint8Array(s.bodyBytes),0);
  });
  await test('API player path still filtered without UI/PiP mutation',async()=>{
    const r=await runQX('https://youtubei-att.googleapis.com/youtubei/v1/player',player);
    assert.deepEqual(Buffer.from(r.bodyBytes),cleanPlayer);
  });
  await test('QX status-line compatibility',async()=>{
    const r=await runQX('https://youtubei.googleapis.com/youtubei/v1/player',player,'HTTP/1.1 200 OK');
    assert.deepEqual(Buffer.from(r.bodyBytes),cleanPlayer);
  });
  await test('API get_watch and Shorts retain ordinary contents',async()=>{
    const watch=pack(a.schema.routes.get_watch,{contents:[{player:a.schema.player.fromBinary(bytes(player))},{}]});
    const r=await runQX('https://youtubei.googleapis.com/youtubei/v1/get_watch',watch);
    const decoded=a.schema.routes.get_watch.fromBinary(bytes(Buffer.from(r.bodyBytes)));
    assert.equal(decoded.contents.length,2);assert.equal(decoded.contents[0].player.adSlots.length,0);
    const type=a.schema.routes['reel/reel_watch_sequence'];
    const reels=pack(type,{entries:[{command:{reelWatchEndpoint:{adClientParams:{isAd:true}}}},{}]});
    const s=await runQX('https://youtubei.googleapis.com/youtubei/v1/reel/reel_watch_sequence',reels);
    assert.equal(type.fromBinary(bytes(Buffer.from(s.bodyBytes))).entries.length,1);
  });
  await test('unsupported body/non200/oversize pass through',async()=>{
    for(const [body,status] of [[Buffer.from([255]),200],[player,500],[Buffer.alloc(2097153),200]]) {
      const r=await runQX('https://youtubei.googleapis.com/youtubei/v1/player',body,status);
      assert.equal(Object.keys(r).length,0);
    }
  });
  await test('request cache miss requests hot config without changing content encoding',async()=>{
    preferences.delete('Gauss-QX-UMP-keys-v1');
    const c=context({url:'https://youtubei.googleapis.com/youtubei/v1/log_event',headers:{
      'X-Youtube-Hot-Hash-Data':'test','Content-Encoding':'gzip','Authorization':'test-token',
    }});
    await c.api.run();const r=await c.done;
    assert.equal(r.headers['X-Youtube-Hot-Hash-Data'],undefined);
    assert.equal(r.headers['Content-Encoding'],'gzip');assert.equal(r.headers.Authorization,'test-token');
  });
  await test('expired cache excluded; no keys or sensitive URLs in diagnostics',async()=>{
    preferences.set('Gauss-QX-UMP-keys-v1',JSON.stringify([{key:key.toString('base64'),expires:Date.now()-1}]));
    const r=await runQX('https://rr1.googlevideo.com/initplayback?secret=test-private',stream(25,1).raw);
    assert.equal(Object.keys(r).length,0);
    assert(!logs.join('\n').includes(key.toString('base64')));
    assert(!logs.join('\n').includes('test-private'));
  });
  const report={passed:count, tests:results, fixture_type:'synthetic; independent Node crypto/zlib oracle',
    runtime_network_APIs:false, phone_verified:false};
  fs.writeFileSync(__dirname+'/runtime-test-result.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
