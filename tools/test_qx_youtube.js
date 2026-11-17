const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'scripts/youtube-response-cleanup-qx.js'), 'utf8');
const snippet = fs.readFileSync(path.join(root, 'modules/Gauss-YouTube-QX.snippet'), 'utf8');
const fixture = {Uint8Array, ArrayBuffer, TextEncoder, TextDecoder,
    $request: {url: ''}, $response: {}, $done() {}, console: {log() {}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'fixtures/youtube-local-schema.js'), 'utf8'), fixture);
const {routes, unknown} = fixture.fixtureTypes;

function execute(route, body, options = {}) {
    const calls = [], logs = [], notices = [];
    const prefs = options.prefs || new Map();
    const c = {Uint8Array, ArrayBuffer, TextEncoder, TextDecoder,
        $request: {url: 'https://' + (options.host || 'youtubei.googleapis.com') + '/youtubei/v1/' + route},
        $response: {statusCode: options.status ?? 200, bodyBytes: body,
            headers: {'Content-Length': '999', 'Content-Encoding': 'gzip'}},
        $done: value => calls.push(value), console: {log: value => logs.push(value)},
        $notify: (...args) => {if (options.notifyThrows) throw new Error('disabled'); notices.push(args);},
        $prefs: {valueForKey: key => prefs.get(key), setValueForKey: (value, key) => prefs.set(key, value)}};
    for (const name of ['$task', '$httpClient', 'fetch', 'XMLHttpRequest', 'WebSocket']) {
        Object.defineProperty(c, name, {get() {throw new Error('Network access: ' + name);}});
    }
    vm.runInNewContext(script, c, {timeout: 2000});
    assert.equal(calls.length, 1);
    return {value: calls[0], notices, logs};
}
function bytes(type, message) {
    const b = routes[type].toBinary(message);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
function player() {
    const m = routes.player.create({adPlacements: [{}, {}], adSlots: [{}],
        playabilityStatus: {backgroundPlayerRender: {backgroundAbility: {active: false}}}});
    unknown.onRead(routes.player.typeName, m, 1999, 2, Uint8Array.from([3, 97, 98, 99]));
    return m;
}
test('QX ArrayBuffer roundtrip removes ads, preserves playback flags and unknown data', () => {
    const m = player();
    const r = execute('player?key=PRIVATE', bytes('player', m));
    assert(r.value.bodyBytes instanceof ArrayBuffer);
    assert.deepEqual(Object.keys(r.value), ['bodyBytes']);
    const decoded = routes.player.fromBinary(new Uint8Array(r.value.bodyBytes));
    assert.equal(decoded.adPlacements.length, 0);
    assert.equal(decoded.adSlots.length, 0);
    assert.deepEqual(decoded.playabilityStatus, m.playabilityStatus);
    assert.deepEqual(unknown.list(decoded), unknown.list(m));
    assert(!JSON.stringify([r.logs, r.notices]).includes('PRIVATE'));
});
test('alternate API, HTTP status lines and local notification dedup work', () => {
    const prefs = new Map();
    for (let i = 0; i < 2; i++) {
        const r = execute('player', bytes('player', player()), {prefs, host: 'youtubei-att.googleapis.com', status: 'HTTP/1.1 200 OK'});
        assert(r.value.bodyBytes instanceof ArrayBuffer);
        assert.equal(r.notices.length, i === 0 ? 1 : 0);
    }
});
test('get_watch nested player and ordinary entries preserved', () => {
    const m = routes.get_watch.create({contents: [{player: player()}, {}]});
    const r = execute('get_watch', bytes('get_watch', m));
    const decoded = routes.get_watch.fromBinary(new Uint8Array(r.value.bodyBytes));
    assert.equal(decoded.contents.length, 2);
    assert.equal(decoded.contents[0].player.adSlots.length, 0);
});
test('only explicitly marked Shorts ads removed', () => {
    const type = 'reel/reel_watch_sequence';
    const m = routes[type].create({entries: [
        {command: {reelWatchEndpoint: {adClientParams: {isAd: true}}}},
        {command: {reelWatchEndpoint: {adClientParams: {isAd: false}}}}, {}]});
    const r = execute(type, bytes(type, m));
    assert.equal(routes[type].fromBinary(new Uint8Array(r.value.bodyBytes)).entries.length, 2);
});
test('unsupported response, empty, malformed and over 2MiB bypass unchanged', () => {
    for (const b of [undefined, '', new ArrayBuffer(0), Uint8Array.from([255]).buffer, new ArrayBuffer(2097153)]) {
        assert.equal(Object.keys(execute('player', b).value).length, 0);
    }
    assert.equal(Object.keys(execute('player', bytes('player', player()), {status: 503}).value).length, 0);
});
test('unmatched routes and weather/OpenAI/Gemini hosts untouched', () => {
    const b = bytes('player', player());
    for (const host of ['weather-data.apple.com', 'chatgpt.com', 'gemini.google.com']) {
        assert.equal(Object.keys(execute('player', b, {host}).value).length, 0);
    }
    for (const route of ['player/ad_break', 'log_event', 'account/get_setting']) {
        assert.equal(Object.keys(execute(route, b).value).length, 0);
    }
});
test('no-ad response unmodified, notifications cannot break filtering', () => {
    assert.equal(Object.keys(execute('player', bytes('player', routes.player.create({}))).value).length, 0);
    assert(execute('player', bytes('player', player()), {notifyThrows: true}).value.bodyBytes instanceof ArrayBuffer);
});
test('resource uses native QX grammar, limited hosts and pinned script only', () => {
    const lines = snippet.split('\n').filter(l => l && !l.startsWith('#'));
    assert.equal(lines.length, 3);
    assert(lines[0].startsWith('hostname = '));
    assert(!/^\[|%APPEND%|ca-p12|ca-passphrase|script-path=|AND,/m.test(snippet));
    const hosts = lines[0].slice('hostname = '.length).split(', ');
    const hostMatch = host => hosts.some(glob => new RegExp('^' + glob.replaceAll('.', '\\.').replaceAll('*', '.*').replaceAll('?', '.') + '$').test(host));
    for (const host of ['rr4---sn-example.googlevideo.com', 'r1.googlevideo.com', 'r12.googlevideo.com']) assert(hostMatch(host));
    for (const host of ['redirector.googlevideo.com', 'redirector-1.googlevideo.com', 'weather-data.apple.com', 'chatgpt.com', 'gemini.google.com']) assert(!hostMatch(host));
    const [pattern, url, action, scriptURL] = lines[1].split(' ');
    assert.equal(url, 'url');
    assert.equal(action, 'script-response-body');
    assert.equal(scriptURL, 'https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/qx-v0.1.0/scripts/youtube-response-cleanup-qx.js');
    const regex = new RegExp(pattern);
    for (const endpoint of Object.keys(routes)) assert(regex.test('https://youtubei.googleapis.com/youtubei/v1/' + endpoint));
    assert(!regex.test('https://youtubei.googleapis.com.evil.test/youtubei/v1/player'));
    const cdn = new RegExp(lines[2].split(' ')[0]);
    assert(lines[2].endsWith(' url reject-200'));
    assert(cdn.test('https://rr4---sn-example.googlevideo.com/initplayback?id=x&oad=1'));
    for (const url of ['https://redirector.googlevideo.com/initplayback?oad=1',
        'https://rr4.googlevideo.com/videoplayback?oad=1',
        'https://rr4.googlevideo.com/initplayback?download=1']) assert(!cdn.test(url));
});
test('deployed runtime has no external request API or Worker', () => {
    for (const text of ['$task', '$httpClient', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'workers.dev']) assert(!script.includes(text), text);
});
for (const route of ['browse', 'next', 'search']) {
    test(route + ' binary feed removes sponsored card, keeps ordinary card', () => {
        const normal = {}, ad = {};
        for (const [card, label] of [[normal, 'ordinary video'], [ad, '/pagead/interaction']]) {
            const payload = new Uint8Array(1200);
            payload.set(new TextEncoder().encode(label), 50);
            unknown.onRead('youtube.response.browse.RichItemContent', card, 1999, 2,
                Uint8Array.from([0xb0, 0x09, ...payload]));
        }
        const content = {sectionListRenderer: {sectionListSupportedRenderers: [{itemSectionRenderer: {richItemContents: []}}]}};
        const m = routes[route].create(route === 'next' ? {content: {nextResult: {content}}} : {content});
        const getItems = msg => (route === 'next' ? msg.content.nextResult.content : msg.content)
            .sectionListRenderer.sectionListSupportedRenderers[0].itemSectionRenderer;
        getItems(m).richItemContents = [ad, normal];
        const r = execute(route, bytes(route, m));
        const restored = routes[route].fromBinary(new Uint8Array(r.value.bodyBytes));
        assert.equal(getItems(restored).richItemContents.length, 1);
        assert.deepEqual(unknown.list(getItems(restored).richItemContents[0]), unknown.list(normal));
    });
}
