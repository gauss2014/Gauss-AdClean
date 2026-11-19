const assert = require('node:assert/strict');
const vm = require('node:vm');
const script = require('./build-enhance.cjs');
const fixture = vm.runInNewContext(script.slice(0, script.indexOf('function enhanceResponse')) +
  'return Object.fromEntries(Mi.map(x=>[x.path,x.msgType]));})();', {TextEncoder,TextDecoder,Uint8Array});
function execute(route, value) {
  const type = fixture[route.split('/').pop()];
  const body = type.toBinary(type.create(value));
  let reply;
  vm.runInNewContext(script, {TextDecoder,TextEncoder,Uint8Array, console,
    $request:{url:'https://youtubei.googleapis.com/youtubei/v1/'+route},
    $response:{statusCode:200,bodyBytes:body},
    $prefs:{valueForKey:()=>null,setValueForKey:()=>{}}, $done:r=>{reply=r;}});
  return type.fromBinary(reply.bodyBytes ? new Uint8Array(reply.bodyBytes) : body);
}
const input = baseUrl => ({adPlacements:[{}], playabilityStatus:{}, captions:{
  playerCaptionsTrackListRenderer:{captionTracks:[{languageCode:'en',baseUrl}],audioTracks:[{}]}
}});
const base = 'https://www.youtube.com/api/timedtext?v=sample';
for (const p of [execute('player',input(base)),execute('get_watch',{contents:[{player:input(base)}]}).contents[0].player]) {
  assert.equal(p.adPlacements.length,0);
  assert(p.playabilityStatus.pictureInPictureRender.pictureInPictureAbility.active);
  assert(p.playabilityStatus.backgroundPlayerRender.backgroundAbility.active);
  assert.equal(p.captions.playerCaptionsTrackListRenderer.captionTracks[1].baseUrl,base+'&tlang=zh-Hans');
}
assert.equal(execute('player',input('https://other.example/subs')).captions.playerCaptionsTrackListRenderer.captionTracks.length,1);
assert(execute('account/get_setting',{settingItems:[{}]}).settingItems.some(x=>x.backgroundPlayBackSettingRenderer));
const guides = execute('guide',{labelItems:[{guideSectionRenderer:{rendererItems:[
  {labelRender:{browseId:'FEuploads'}},{labelRender:{browseId:'FEhistory'}}]}}]});
const items = guides.labelItems[0].guideSectionRenderer.rendererItems;
assert.equal(items.length,1);
assert.equal(items[0].labelRender.browseId,'FEhistory');
console.log('Offline protobuf fixtures passed: player, get_watch, captions, guide and account settings');
