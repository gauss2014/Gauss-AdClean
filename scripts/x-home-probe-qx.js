// Count-only test: never return a replacement response.
(() => {
  let status = 'skip=body';
  try {
    const raw = $response.body;
    if (typeof raw === 'string' && raw.length && raw.length <= 4 * 1024 * 1024) {
      const ops = JSON.parse(raw)?.data?.home?.home_timeline_urt?.instructions;
      status = 'skip=layout';
      if (Array.isArray(ops)) {
        let entries = 0, candidates = 0;
        for (const op of ops) {
          if (!Array.isArray(op?.entries)) continue;
          for (const entry of op.entries) {
            entries++;
            const item = entry?.content?.itemContent, id = entry?.entryId;
            if (!item || typeof id !== 'string' || id.startsWith('cursor-')) continue;
            const meta = item.promotedMetadata ?? item.promoted_metadata;
            if (id.startsWith('promoted-tweet-') || (item.itemType === 'TimelineTweet' &&
                meta && typeof meta === 'object' && !Array.isArray(meta) && Object.keys(meta).length))
              candidates++;
          }
        }
        status = 'entries=' + entries + ' candidates=' + candidates;
      }
    }
  } catch (_) { status = 'skip=parse'; }
  console.log('[Gauss-X-Probe] ' + status);
  $done({});
})();
