function enhanceResponse() {
  const match = /^https:\/\/(?:youtubei|youtubei-att)\.googleapis\.com\/youtubei\/v1\/(browse|next|player|search|reel\/reel_watch_sequence|guide|account\/get_setting|get_watch)(?:\?[^#]*)?$/.exec($request.url);
  if (!match || !/^(?:HTTP\/[\d.]+\s+)?200(?:\s|$)/.test(String($response.statusCode ?? $response.status))) return {};
  const raw = $response.bodyBytes;
  if (!raw || !raw.byteLength || raw.byteLength > 4194304) return {};
  const route = match[1];
  const entry = Mi.find(item => item.path === route.split('/').pop());
  const msg = entry.msgType.fromBinary(new Uint8Array(raw));
  // Keep the existing per-card filter when upstream sees a different layout.
  const removed = routes[route] ? clean(route, msg) : 0;
  let captionLang = 'zh-Hans';
  for (const player of route === 'player' ? [msg] : route === 'get_watch' ?
    (msg.contents || []).map(item => item.player).filter(Boolean) : []) {
    if (!player.playabilityStatus) player.playabilityStatus = {};
    const tracks = player.captions?.playerCaptionsTrackListRenderer?.captionTracks;
    if (tracks && (!tracks.length || !tracks.every(track =>
      /^https:\/\/(?:[\w-]+\.)*(?:youtube\.com|googlevideo\.com)\/[^\s\\]*$/i.test(track.baseUrl || ''))))
      captionLang = 'off';
  }
  const cacheKey = 'Gauss-QX-YT-enhance-layout-v1';
  let adCache = {whiteNo:[], blackNo:[], whiteEml:[], blackEml:['inline_injection_entrypoint_layout.eml'], dirty:false};
  try {
    const stored = JSON.parse($prefs.valueForKey(cacheKey));
    if (stored && ['whiteNo','blackNo','whiteEml','blackEml'].every(k => Array.isArray(stored[k])))
      adCache = {...stored, dirty:false};
  } catch (_) {}
  const result = entry.handler(msg, {state:{adCache}, params:{
    captionLang, blockUpload:true, blockImmersive:true, blockShorts:false
  }});
  if (adCache.dirty) $prefs.setValueForKey(JSON.stringify(adCache), cacheKey);
  if (!removed && !result.bodyChanged) return {};
  const bytes = entry.msgType.toBinary(msg);
  return {bodyBytes:bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)};
}
let reply = {};
try { reply = enhanceResponse(); } catch (_) { console.log('[GAUSS-YT] unsupported response'); }
$done(reply);
