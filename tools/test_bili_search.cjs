const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), z = require('node:zlib');
const code = fs.readFileSync(require.resolve('../scripts/bili-search-qx.js'), 'utf8');
const buf = (...xs) => Buffer.concat(xs.map(x => Buffer.from(x)));
function vint(x) { const a=[]; while(x>=128){a.push(x%128+128);x=Math.floor(x/128);} return [...a,x]; }
function field(n,b) { return buf(vint(n*8+2),vint(b.length),b); }
function frame(msg,compressed) {
  const b=compressed ? z.gzipSync(msg) : msg, h=Buffer.alloc(5);
  h[0]=+compressed; h.writeUInt32BE(b.length,1); return buf(h,b);
}
const path='https://grpc.biliapi.net/bilibili.polymer.app.search.v1.Search/SearchAll';
function run(b,url=path) {
  let res;
  vm.runInNewContext(code,{$response:{bodyBytes:Uint8Array.from(b).buffer},
    $request:{url},console:{log(){}},$done:v=>res=v,Uint8Array,ArrayBuffer,DataView});
  return res.bodyBytes && Buffer.from(res.bodyBytes);
}
// SearchVideoCard with unknown nested field 25 and an innocent ad-related title.
const video=field(4,field(37,field(25,Buffer.from('广告设计教程'))));
const ad=field(4,field(25,field(1,Buffer.from('广告'))));
const page=field(11,buf([8,1])), future=field(400,buf([1,2,3]));
const expected=buf(video,page,video,future);
const base='https://grpc.biliapi.net/';
const wrap=(fields, value)=>fields.reduceRight((b,f)=>field(f,b), value);
for(const [method,bad,good] of [
  ['bilibili.app.view.v1.View/View',field(10,field(28,[])),field(10,field(27,[]))],
  ['bilibili.app.view.v1.View/TFInfo',field(2,[]),field(5,[])],
  ['bilibili.community.service.dm.v1.DM/DmView',field(18,[]),field(3,[])],
  ['bilibili.app.dynamic.v2.Dynamic/DynAll',field(3,[]),field(1,field(1,[8,14]))],
  ['bilibili.app.viewunite.v1.View/View',wrap([7,3],[]),field(4,[])],
]){
  for(const zip of [true,false]){
    const input=frame(buf(bad,good,future),zip), out=run(input,base+method);
    assert.ok(out,method); const payload=zip?z.gunzipSync(out.subarray(5)):out.subarray(5);
    assert.deepEqual(payload,buf(method.includes('viewunite')?field(7,[]):[],good,future));
    assert.equal(run(frame(good,zip),base+method),undefined);
  }
}
for(const gzip of [false,true]){
  const r=run(frame(buf(video,ad,page,ad,video,future),gzip));
  assert.equal(r[0],+gzip); assert.equal(r.readUInt32BE(1),r.length-5);
  assert.deepEqual(gzip?z.gunzipSync(r.subarray(5)):r.subarray(5),expected);
  assert.equal(run(frame(expected,gzip)),undefined);
}
assert.equal(run(frame(ad,false),path.replace('SearchAll','DefaultWords')),undefined);
assert.equal(run(frame(buf(ad,[34,60,1]),false)),undefined);
assert.equal(run(buf(frame(ad,false),[0])),undefined);
assert.equal(run(Buffer.alloc(0)),undefined);
assert.equal(run(frame(ad,false).fill(1,0,1)),undefined);
assert.equal(run(frame(ad,false),path.replace('grpc.biliapi.net','app.bilibili.com'))[0],0);
console.log('search response: gzip/plain filtering, unknown fields, ordinary videos, malformed frames and URL scope OK');
