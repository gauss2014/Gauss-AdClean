// Local display cleanup. Endpoint and tab schema: github.com/ZenmoFeiShi/Qx (MT.js).
(() => {
  const games = new Set(['向往的生活', '天天领现金', '我的花园世界', '四季物语',
    '鲜果消消', '游戏中心', '斗破苍穹']);
  const loans = new Set(['美团借钱','美团月付']);
  const fields = ['title','text','name','label','mainTitle','displayName','itemTitle'];
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  function label(card) {
    if (!object(card)) return '';
    for (const v of [card, card.data, card.props, card.content]) {
      if (!object(v)) continue;
      for (const k of fields) {
        const t = typeof v[k] === 'string' ? v[k] : v[k]?.text;
        if (typeof t === 'string' && (loans.has(t) || games.has(t) ||
            ['我的账单','配送未超时'].includes(t) || /^三国[：:]冰河/.test(t))) return t;
      }
    }
    return '';
  }
  let tabs = 0, wallet = 0, promos = 0;
  function filterLayout(a, depth) {
    if (depth > 24) return;
    if (Array.isArray(a)) {
      const labels = a.map(label);
      const walletRow = labels.includes('我的账单') || labels.includes('配送未超时');
      const gameRow = new Set(labels.filter(t => games.has(t))).size >= 2;
      for (let i = a.length - 1; i >= 0; i--) {
        const t = labels[i];
        if (walletRow && loans.has(t) && !/待还|应还|逾期|去还款|还款日|还款提醒/.test(JSON.stringify(a[i]))) {
          a.splice(i,1); wallet++;
        } else if (gameRow && (games.has(t) || /^三国[：:]冰河/.test(t))) {
          a.splice(i,1); promos++;
        } else filterLayout(a[i],depth+1);
      }
    } else if (object(a)) {
      for (const v of Object.values(a)) if (typeof v === 'object' && v) filterLayout(v,depth+1);
    }
  }
  let change = {};
  try {
    const url = $request.url.split('?')[0].replace(/\/$/, '');
    const raw = $response.body;
    if (typeof raw !== 'string' || raw.length > 2000000) return $done({});
    const obj = JSON.parse(raw);
    if (url === 'https://apimobile.meituan.com/aggroup/indexTab') {
      const res = obj?.data?.resource, arr = res?.tabArea;
      if (Array.isArray(arr) && ['homepage','mine'].every(n => arr.some(t => t?.tabName === n))) {
        const keep = arr.filter(t => t?.tabName !== 'xiaotuan');
        tabs = arr.length - keep.length;
        if (tabs) res.tabArea = keep;
      }
    } else if (url === 'https://mt-personalcenter.meituan.com/usercenter/display') {
      if (Array.isArray(obj?.children)) filterLayout(obj.children,0);
    } else return $done({});
    if (tabs || wallet || promos) {
      // Do not round long unquoted identifiers while serializing the display document.
      if (/[:,\[]\s*-?\d{16,}\s*[,}\]]/.test(raw)) {
        console.log('[Gauss-MT] precision-bypass'); return $done({});
      }
      change = {body: JSON.stringify(obj)};
    }
    console.log('[Gauss-MT] tabs=' + tabs + ' wallet=' + wallet + ' games=' + promos);
  } catch (_) { console.log('[Gauss-MT] parse-bypass'); }
  $done(change);
})();
