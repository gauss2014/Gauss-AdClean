const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const out = require('node:path').resolve(__dirname, '..');
const moduleText = fs.readFileSync(out + '/modules/Gauss-AdClean.sgmodule', 'utf8');
const rule = moduleText.split('\n').find(line => line.startsWith('Gauss_YT_Local ='));
const scriptURL = rule.match(/script-path=([^,\s]+)/)?.[1];
assert.equal(scriptURL, 'https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/v0.4.9/scripts/youtube-response-cleanup.js');
const inline = fs.readFileSync(out + '/scripts/youtube-response-cleanup.js', 'utf8');
const fixtureCode = fs.readFileSync(__dirname + '/fixtures/youtube-local-schema.js', 'utf8');

function context(url, body, status = 200) {
    const calls = [];
    const logs = [];
    const c = {
        Uint8Array, ArrayBuffer, TextEncoder, TextDecoder,
        $request: {url, headers: {}},
        $response: {status, body, headers: {'Content-Length': '999', 'Content-Type': 'application/x-protobuf'}},
        console: {log: line => logs.push(line)}, $done: value => calls.push(value)
    };
    for (const name of ['$httpClient', '$task', '$prefs', 'fetch']) {
        Object.defineProperty(c, name, {get() {throw new Error('Forbidden global accessed: ' + name);}});
    }
    return {c: vm.createContext(c), calls, logs};
}
const fixture = context('', new Uint8Array());
vm.runInContext(fixtureCode, fixture.c, {timeout: 2000});
const {routes, unknown, clean} = fixture.c.fixtureTypes;

test('module loads pinned script file, retains body cap and has no inline source', () => {
    assert(!rule.includes('script-text='));
    assert(rule.includes('requires-body=1,binary-body-mode=1,max-size=2097152'));
    for (const api of ['$httpClient', '$task', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'workers.dev']) {
        assert(!inline.includes(api), api);
    }
});

function execute(route, bytes, status = 200, host = 'youtubei.googleapis.com') {
    const result = context('https://' + host + '/youtubei/v1/' + route, bytes, status);
    vm.runInContext(inline, result.c, {timeout: 2000});
    assert.equal(result.calls.length, 1);
    return {value: result.calls[0], logs: result.logs};
}

const playbackRules = moduleText.split('[URL Rewrite]')[1].split('\n[')[0]
    .split('\n').filter(line => line.startsWith('(^https?://(?!redirector)') ||
        line.startsWith('^https?://(?!redirector)'))
    .map(line => {
        const [pattern, replacement, action] = line.trim().split(/\s+/);
        return {pattern: new RegExp(pattern), replacement, action};
    });

test('playback URL rules are present with TCP fallback and redirector exclusion', () => {
    assert.equal(playbackRules.length, 1);
    assert(moduleText.includes('AND,((DOMAIN-SUFFIX,googlevideo.com),(PROTOCOL,UDP),(DST-PORT,443)),REJECT'));
    assert(moduleText.includes('-redirector*.googlevideo.com,*.googlevideo.com'));
    assert(!rule.includes('googlevideo'));
});
test('signed ctier playback URLs are not rewritten', () => {
    const url = 'https://rr4---sn-example.googlevideo.com/initplayback?id=123&ctier=L&foo=bar&sparams=id,ctier,foo&sig=abc';
    assert(playbackRules.every(r => !r.pattern.test(url)));
});
test('oad reject requires the exact initplayback query key', () => {
    const r = playbackRules[0];
    assert.equal(r.action, 'reject-200');
    for (const query of ['oad=1', 'id=123&oad=1&foo=2', 'id=123&oad']) {
        assert(r.pattern.test('https://rr4---sn-example.googlevideo.com/initplayback?' + query));
    }
    for (const query of ['id=123&oadx=1', 'id=123&download=1', 'id=123#x&oad=1']) {
        assert(!r.pattern.test('https://rr4---sn-example.googlevideo.com/initplayback?' + query));
    }
});
test('normal video streams, unrelated hosts and redirectors are not rewritten', () => {
    for (const host of ['rr4---sn-example.googlevideo.com', 'redirector.googlevideo.com',
        'redirector-1.googlevideo.com', 'example.com', 'rr4.googlevideo.com.evil.test']) {
        for (const path of ['videoplayback', 'dclk_video_ads', 'other']) {
            const url = `https://${host}/${path}?id=123&ctier=L&oad=1&sparams=id,ctier,oad`;
            assert(playbackRules.every(r => !r.pattern.test(url)), url);
        }
        if (host !== 'rr4---sn-example.googlevideo.com') {
            const url = `https://${host}/initplayback?id=123&ctier=L&oad=1&sparams=id,ctier,oad`;
            assert(playbackRules.every(r => !r.pattern.test(url)), url);
        }
    }
    assert(!playbackRules[0].pattern.test('https://rr4.googlevideo.com/initplayback?id=123&ctier=L&foo=bar'));
});

function player() {
    const message = routes.player.create({
        adPlacements: [{}, {}], adSlots: [{}],
        playabilityStatus: {
            pictureInPictureRender: {pictureInPictureAbility: {active: false, f8: 0}},
            backgroundPlayerRender: {backgroundAbility: {active: false}}
        }
    });
    unknown.onRead(routes.player.typeName, message, 1999, 2, Uint8Array.from([3, 97, 98, 99]));
    return message;
}

test('player strips ad fields, preserves unknown bytes and original playback flags', () => {
    const message = player();
    const result = execute('player?key=PRIVATE', routes.player.toBinary(message));
    const restored = routes.player.fromBinary(result.value.body);
    assert.equal(restored.adPlacements.length, 0);
    assert.equal(restored.adSlots.length, 0);
    assert.deepEqual(restored.playabilityStatus, message.playabilityStatus);
    assert.deepEqual(unknown.list(restored), unknown.list(message));
    assert(!('Content-Length' in result.value.headers));
    assert(result.logs.every(line => !line.includes('PRIVATE')));
});
test('HTTP status line and numeric status both filter; explicit error status passes through', () => {
    const body = routes.player.toBinary(player());
    for (const status of [200, '200', 'HTTP/1.1 200 OK', 'HTTP/2 200']) {
        assert(execute('player', body, status).value.body);
    }
    for (const status of ['HTTP/1.1 403 Forbidden', 'invalid']) {
        assert.equal(Object.keys(execute('player', body, status).value).length, 0);
    }
    const r = context('https://youtubei.googleapis.com/youtubei/v1/player', body, 'invalid');
    r.c.$response.statusCode = 200;
    vm.runInContext(inline, r.c);
    assert(r.calls[0].body);
});
test('local execution notice is deduplicated without URLs or payload data', () => {
    const storage = new Map(), notices = [];
    function run(body) {
        const r = context('https://youtubei.googleapis.com/youtubei/v1/player?key=SECRET', body);
        r.c.$persistentStore = {
            read: key => storage.get(key),
            write: (value, key) => {storage.set(key, value); return true;}
        };
        r.c.$notification = {post: (...args) => notices.push(args)};
        vm.runInContext(inline, r.c);
        return r;
    }
    run(routes.player.toBinary(player()));
    run(routes.player.toBinary(player()));
    assert.equal(notices.length, 1);
    assert(notices[0].join(' ').includes('FILTERED'));
    run(Uint8Array.of(255));
    run(Uint8Array.of(255));
    assert.equal(notices.length, 2);
    assert(notices[1].join(' ').includes('PROTOBUF_ERROR'));
    run('unsupported');
    assert(notices[2].join(' ').includes('BODY_SKIP'));
    assert(!JSON.stringify([...notices, ...storage.entries()]).includes('SECRET'));
    assert(notices.every(n => n.length === 3));
});
test('notification failure does not prevent response filtering', () => {
    const r = context('https://youtubei.googleapis.com/youtubei/v1/player', routes.player.toBinary(player()));
    r.c.$persistentStore = {read: () => null, write: () => true};
    r.c.$notification = {post: () => {throw new Error('Notifications disabled');}};
    vm.runInContext(inline, r.c);
    assert(r.calls[0].body);
});
test('no ads leaves original response untouched', () => {
    const body = routes.player.toBinary(routes.player.create({playabilityStatus: {}}));
    assert.equal(Object.keys(execute('player', body).value).length, 0);
});
test('unsupported ad_break, settings, config and non-YouTube hosts pass through', () => {
    const body = routes.player.toBinary(player());
    for (const route of ['player/ad_break', 'account/get_setting', 'config', 'log_event']) {
        assert.equal(Object.keys(execute(route, body).value).length, 0);
    }
    assert.equal(Object.keys(execute('player', body, 200, 'weather-data.apple.com').value).length, 0);
});
test('malformed protobuf, string and HTTP errors pass through without breaking completion', () => {
    for (const body of [Uint8Array.from([255]), 'not binary', new Uint8Array(2097153)]) {
        assert.equal(Object.keys(execute('player', body).value).length, 0);
    }
    assert.equal(Object.keys(execute('player', routes.player.toBinary(player()), 503).value).length, 0);
});
test('binary ArrayBuffer and byte arrays supported on alternate API host', () => {
    const bytes = routes.player.toBinary(player());
    for (const body of [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), [...bytes]]) {
        const result = execute('player', body, 200, 'youtubei-att.googleapis.com');
        assert.equal(routes.player.fromBinary(result.value.body).adSlots.length, 0);
    }
});
test('get_watch cleans nested player without changing unrelated content', () => {
    const body = routes.get_watch.toBinary(routes.get_watch.create({contents: [{player: player()}, {}]}));
    const result = routes.get_watch.fromBinary(execute('get_watch', body).value.body);
    assert.equal(result.contents.length, 2);
    assert.equal(result.contents[0].player.adSlots.length, 0);
});
test('reel removes only explicitly marked ad, preserves ordinary Shorts', () => {
    const type = routes['reel/reel_watch_sequence'];
    const body = type.toBinary(type.create({entries: [
        {command: {reelWatchEndpoint: {adClientParams: {isAd: true}}}},
        {command: {reelWatchEndpoint: {adClientParams: {isAd: false}}}}, {}
    ]}));
    const result = type.fromBinary(execute('reel/reel_watch_sequence', body).value.body);
    assert.equal(result.entries.length, 2);
});
test('feed only removes known injection layout, preserves Shorts and unknown items', () => {
    const message = {nested: {richItemContents: [
        {renderInfo: {layoutRender: {eml: 'inline_injection_entrypoint_layout.eml|variant'}}},
        {renderInfo: {layoutRender: {eml: 'shorts_video.eml'}}},
        {renderInfo: {layoutRender: {eml: 'new_unknown_layout.eml'}}}
    ]}};
    assert.equal(clean('browse', message), 1);
    assert.equal(message.nested.richItemContents.length, 2);
});
test('only own pinned script; no Worker or credentials', () => {
    assert(!/workers\.dev|ca-p12|ca-passphrase/.test(moduleText));
    const component = fs.readFileSync(out + '/components/Gauss-YouTube-Local.sgmodule', 'utf8');
    assert.deepEqual(component.match(/script-path=[^,\s]+/g), ['script-path=' + scriptURL]);
    assert(!moduleText.includes('Compass_Coordinates'));
    assert(!moduleText.includes('gspe*-ssl.ls.apple.com'));
    assert(!/\$httpClient|\$task|\$prefs|fetch\(/.test(inline));
    assert.equal(moduleText.split('\n').filter(line => line.startsWith('Gauss_YT_Local =')).length, 1);
});

function home(items) {
    const message = routes.browse.create({content: {sectionListRenderer: {
        sectionListSupportedRenderers: [{itemSectionRenderer: {richItemContents: items}}]
    }}});
    message.content.sectionListRenderer.sectionListSupportedRenderers[0]
        .itemSectionRenderer.richItemContents = items;
    return message;
}
function homeItems(message) {
    return message.content.sectionListRenderer.sectionListSupportedRenderers[0]
        .itemSectionRenderer.richItemContents;
}
function opaqueCard(marker, fieldNumber = 1999) {
    const card = homeItems(home([{}]))[0];
    const payload = new Uint8Array(1200);
    payload.set(new TextEncoder().encode(marker), 50);
    // Unknown length-delimited fields store the length prefix with their bytes.
    const bytes = Uint8Array.from([0xb0, 0x09, ...payload]);
    unknown.onRead('youtube.response.browse.RichItemContent', card, fieldNumber, 2, bytes);
    return card;
}
test('homepage opaque sponsored first card removed through final binary script', () => {
    const normal = opaqueCard('ordinary video');
    const message = home([opaqueCard('/pagead/interaction'), normal]);
    const result = execute('browse', routes.browse.toBinary(message));
    const cards = homeItems(routes.browse.fromBinary(result.value.body));
    assert.equal(cards.length, 1);
    assert.deepEqual(unknown.list(cards[0]), unknown.list(normal));
    assert(result.logs.some(s => s.startsWith('[GAUSS-YT-LOCAL] browse FILTERED removed=1 bytes=')));
});
test('homepage preserves ordinary first card and checks each opaque card independently', () => {
    const normal = opaqueCard('ordinary first video');
    const message = home([normal, opaqueCard('/pagead/interaction'), opaqueCard('same field, not ad')]);
    const cards = homeItems(routes.browse.fromBinary(execute('browse', routes.browse.toBinary(message)).value.body));
    assert.equal(cards.length, 2);
    assert.deepEqual(unknown.list(cards[0]), unknown.list(normal));
    const untouched = execute('browse', routes.browse.toBinary(home([normal])));
    assert.equal(Object.keys(untouched.value).length, 0);
    assert(untouched.logs.some(s => s.startsWith('[GAUSS-YT-LOCAL] browse NO_MATCH removed=0 bytes=')));
});
test('small unknown fields do not trigger opaque ad detection', () => {
    const small = {};
    unknown.onRead('youtube.response.browse.RichItemContent', small, 1999, 2,
        Uint8Array.from([6, ...new TextEncoder().encode('pagead')]));
    assert.equal(clean('browse', {richItemContents: [small]}), 0);
});

function feed(route, items) {
    const content = home([]).content;
    const message = routes[route].create(route === 'next' ? {content: {nextResult: {content}}} : {content});
    const parent = route === 'next' ? message.content.nextResult.content : message.content;
    parent.sectionListRenderer.sectionListSupportedRenderers[0].itemSectionRenderer.richItemContents = items;
    return message;
}
function feedItems(route, message) {
    const content = route === 'next' ? message.content.nextResult.content : message.content;
    return homeItems({content});
}
for (const route of ['next', 'search']) {
    test(route + ' filters each opaque ad and preserves same-field normal cards', () => {
        const normal = opaqueCard('ordinary video');
        const message = feed(route, [normal, opaqueCard('/pagead/interaction'), opaqueCard('another video')]);
        const type = routes[route];
        const result = execute(route, type.toBinary(message));
        const cards = feedItems(route, type.fromBinary(result.value.body));
        assert.equal(cards.length, 2);
        assert.deepEqual(unknown.list(cards[0]), unknown.list(normal));
        assert(result.logs.some(s => s.startsWith('[GAUSS-YT-LOCAL] ' + route + ' FILTERED removed=1 bytes=')));
        const noAds = type.toBinary(feed(route, [normal]));
        assert.equal(Object.keys(execute(route, noAds).value).length, 0);
    });
}
test('get_watch filters opaque ads in nested next response', () => {
    const type = routes.get_watch;
    const message = type.create({contents: [{}]});
    message.contents[0].next = feed('next', [opaqueCard('pagead'), opaqueCard('normal')]);
    const result = type.fromBinary(execute('get_watch', type.toBinary(message)).value.body);
    assert.equal(feedItems('next', result.contents[0].next).length, 1);
});
test('player removes only advertising tracking even without ad slots', () => {
    const message = routes.player.create({playbackTracking: {
        pageadViewthroughconversion: {}, videostatsPlaybackUrl: {},
        videostatsWatchtimeUrl: {}
    }});
    unknown.onRead('youtube.response.player.PlaybackTracking', message.playbackTracking,
        1999, 2, Uint8Array.from([3, 97, 98, 99]));
    const before = routes.player.fromBinary(routes.player.toBinary(message));
    const result = routes.player.fromBinary(execute('player', routes.player.toBinary(message)).value.body);
    delete before.playbackTracking.pageadViewthroughconversion;
    assert.deepEqual(result, before);
    assert.equal(Object.keys(execute('player', routes.player.toBinary(result)).value).length, 0);
});
