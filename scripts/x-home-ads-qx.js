// Local response filter. Only standalone promoted entries in the two home feeds.
(() => {
  const route = /^https:\/\/(?:api\.(?:x|twitter)\.com|(?:x|twitter)\.com)\/(?:i\/api\/)?graphql\/[\w-]+\/(HomeTimeline|HomeLatestTimeline)\/?(?:\?|$)/.exec($request.url);
  if (!route) return $done({});
  const finish = (status, reply = {}) => {
    console.log('[Gauss-X] ' + route[1] + ' ' + status);
    return $done(reply);
  };
  const raw = $response.body;
  if (typeof raw !== 'string' || !raw.length || raw.length > 4 * 1024 * 1024)
    return finish('skip=size-or-body');
  try {
    // Preserve unquoted numeric IDs verbatim across JSON serialization on iOS.
    // Protect all numeric tokens, not digits inside JSON strings or cursors.
    const prefix = '__GaussXNum:';
    const strings = /"(?:\\.|[^"\\])*"/g;
    const tokens = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    const data = JSON.parse(raw.replace(tokens, t => {
      if (t[0] !== '"') return '"' + prefix + t + '"';
      if ((t.includes(prefix) || t.includes('\\u')) && JSON.parse(t).startsWith(prefix))
        throw Error('reserved');
      return t;
    }));
    const ops = data?.data?.home?.home_timeline_urt?.instructions;
    if (!Array.isArray(ops)) return finish('skip=layout');
    let removed = 0;
    for (const op of ops) {
      if (!Array.isArray(op?.entries)) continue;
      op.entries = op.entries.filter(e => {
        const item = e?.content?.itemContent;
        const id = e?.entryId;
        if (!item || typeof id !== 'string' || id.startsWith('cursor-')) return true;
        const meta = item.promotedMetadata ?? item.promoted_metadata;
        const ad = /^promoted-tweet-/.test(id) ||
          (item.itemType === 'TimelineTweet' && meta && typeof meta === 'object' &&
           !Array.isArray(meta) && Object.keys(meta).length > 0);
        if (ad) removed++;
        return !ad;
      });
    }
    if (!removed) return finish('removed=0');
    const body = JSON.stringify(data).replace(strings, t =>
      t.startsWith('"' + prefix) ? t.slice(1 + prefix.length, -1) : t);
    return finish('removed=' + removed, {body});
  } catch (_) { return finish('skip=parse'); }
})();
