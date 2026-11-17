const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const out = require('node:path').resolve(__dirname, '..');
const moduleText = fs.readFileSync(out + '/modules/Gauss-AdClean.sgmodule', 'utf8');
const rule = moduleText.split('\n').find(line => line.startsWith('Gauss_YT_Local ='));
const inline = rule.slice(rule.indexOf('script-text=') + 'script-text='.length);
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
    for (const name of ['$httpClient', '$task', '$persistentStore', '$prefs', 'fetch']) {
        Object.defineProperty(c, name, {get() {throw new Error('Forbidden global accessed: ' + name);}});
    }
    return {c: vm.createContext(c), calls, logs};
}
const fixture = context('', new Uint8Array());
vm.runInContext(fixtureCode, fixture.c, {timeout: 2000});
const {routes, unknown, clean} = fixture.c.fixtureTypes;

function execute(route, bytes, status = 200, host = 'youtubei.googleapis.com') {
    const result = context('https://' + host + '/youtubei/v1/' + route, bytes, status);
    vm.runInContext(inline, result.c, {timeout: 2000});
    assert.equal(result.calls.length, 1);
    return {value: result.calls[0], logs: result.logs};
}
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
test('no remote code, Worker, credentials, or Googlevideo MITM in module', () => {
    assert(!/workers\.dev|ca-p12|ca-passphrase|hostname.*googlevideo/.test(moduleText));
    const component = fs.readFileSync(out + '/components/Gauss-YouTube-Local.sgmodule', 'utf8');
    assert(!component.includes('script-path='));
    assert(!moduleText.includes('Compass_Coordinates'));
    assert(!moduleText.includes('gspe*-ssl.ls.apple.com'));
    assert(!/\$httpClient|\$task|\$prefs|\$persistentStore|fetch\(/.test(inline));
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
    assert(result.logs.includes('[GAUSS-YT-LOCAL] browse removed=1'));
});
test('homepage preserves ordinary first card and checks each opaque card independently', () => {
    const normal = opaqueCard('ordinary first video');
    const message = home([normal, opaqueCard('/pagead/interaction'), opaqueCard('same field, not ad')]);
    const cards = homeItems(routes.browse.fromBinary(execute('browse', routes.browse.toBinary(message)).value.body));
    assert.equal(cards.length, 2);
    assert.deepEqual(unknown.list(cards[0]), unknown.list(normal));
    const untouched = execute('browse', routes.browse.toBinary(home([normal])));
    assert.equal(Object.keys(untouched.value).length, 0);
    assert(untouched.logs.includes('[GAUSS-YT-LOCAL] browse removed=0'));
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
        assert(result.logs.includes('[GAUSS-YT-LOCAL] ' + route + ' removed=1'));
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
