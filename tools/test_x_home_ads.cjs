const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const script = fs.readFileSync(require.resolve('../scripts/x-home-ads-qx.js'), 'utf8');
function run(url, body) {
  let result; const logs=[];
  vm.runInNewContext(script, {$request:{url},$response:{body},$done:v=>result=v,
    console:{log:s=>logs.push(s)}});
  assert(!logs.join('').includes('private-cursor'));
  return result;
}
const tweet=(id, fields={})=>({entryId:id,content:{itemContent:{itemType:'TimelineTweet',...fields}}});
const normal=tweet('tweet-42',{text:'Ad 广告设计',quoted_status:{promotedMetadata:{a:1}}});
const emptyMeta=tweet('tweet-43',{promotedMetadata:{}});
const cursor={entryId:'cursor-bottom',content:{value:'private-cursor'}};
const feed=entries=>({data:{home:{home_timeline_urt:{instructions:[{type:'TimelineAddEntries',entries}]}}}});
const keep=[normal,emptyMeta,cursor];
const payload=JSON.stringify(feed([normal,tweet('promoted-tweet-1'),emptyMeta,tweet('tweet-2',{promotedMetadata:{a:1}}),cursor])).replace('"tweet-42"', '"tweet-42","big":9876543210987654321');
for(const route of ['HomeTimeline','HomeLatestTimeline']){
  const url='https://api.x.com/graphql/abc/'+route+'?cursor=private-cursor';
  const out=run(url,payload).body;
  assert.equal(out,JSON.stringify(feed(keep)).replace('"tweet-42"', '"tweet-42","big":9876543210987654321'));
  for(const s of ['{}','{',JSON.stringify(feed(keep))]) assert.equal(run(url,s).body,undefined);
  assert.equal(run(url.replace(route,'TweetDetail'),payload).body,undefined);
}
console.log('X home: both routes, ad ID/metadata, regular posts, cursor and 64-bit value passed');
