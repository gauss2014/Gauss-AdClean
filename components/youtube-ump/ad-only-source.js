// Ad-only adaptation of Maasea/sgmodule. No request rewriting or network access.
const routes = {
    browse: qr,
    next: re,
    player: oe,
    search: Yr,
    'reel/reel_watch_sequence': zr,
    get_watch: ei
};

function cleanPlayer(message) {
    let removed = 0;
    for (const key of ['adPlacements', 'adSlots']) {
        if (Array.isArray(message[key])) {
            removed += message[key].length;
            message[key].length = 0;
        }
    }
    if (message.playbackTracking?.pageadViewthroughconversion !== undefined) {
        delete message.playbackTracking.pageadViewthroughconversion;
        removed++;
    }
    return removed;
}

function hasOpaqueAdSignal(node) {
    // Upstream's per-card protobuf fallback; never cache a field number as an ad.
    const marker = [112, 97, 103, 101, 97, 100];
    return d.list(node).some(field => {
        const bytes = field.data;
        if (field.wireType !== 2 || bytes.length < 1000) return false;
        outer: for (let i = 0; i <= bytes.length - marker.length; i++) {
            for (let j = 0; j < marker.length; j++) {
                if (bytes[i + j] !== marker[j]) continue outer;
            }
            return true;
        }
        return false;
    });
}

function isKnownAdItem(item, opaqueAds) {
    if (opaqueAds && hasOpaqueAdSignal(item)) return true;
    const stack = [item];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || node instanceof Uint8Array) continue;
        const eml = node.renderInfo?.layoutRender?.eml;
        if (typeof eml === 'string' && eml.split('|')[0] === 'inline_injection_entrypoint_layout.eml') {
            return true;
        }
        const content = node.videoInfo?.videoContext?.videoContent;
        if (opaqueAds && content && hasOpaqueAdSignal(content)) return true;
        for (const value of Object.values(node)) {
            if (value && typeof value === 'object') stack.push(value);
        }
    }
    return false;
}

function cleanFeed(message, opaqueAds = false) {
    let removed = 0;
    const stack = [message];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || node instanceof Uint8Array) continue;
        if (Array.isArray(node.richItemContents)) {
            node.richItemContents = node.richItemContents.filter(item => {
                if (!isKnownAdItem(item, opaqueAds)) return true;
                removed++;
                return false;
            });
        }
        for (const value of Object.values(node)) {
            if (value && typeof value === 'object') stack.push(value);
        }
    }
    return removed;
}

function clean(route, message) {
    if (route === 'player') return cleanPlayer(message);
    if (route === 'reel/reel_watch_sequence') {
        let removed = 0;
        message.entries = message.entries.filter(entry => {
            if (entry.command?.reelWatchEndpoint?.adClientParams?.isAd !== true) return true;
            removed++;
            return false;
        });
        return removed;
    }
    if (route === 'get_watch') {
        let removed = 0;
        for (const entry of message.contents) {
            if (entry.player) removed += cleanPlayer(entry.player);
            if (entry.next) removed += cleanFeed(entry.next, true);
        }
        return removed;
    }
    return cleanFeed(message, ['browse', 'next', 'search'].includes(route));
}

function report(route, outcome, detail) {
    const message = route + ' ' + outcome + ' ' + detail;
    console.log('[GAUSS-YT-LOCAL] ' + message);
    // At most one local notification per route/outcome for this release.
    try {
        if (typeof $notification === 'undefined' || typeof $persistentStore === 'undefined') return;
        const key = 'Gauss-YT-v0.4.9-' + route + '-' + outcome;
        if ($persistentStore.read(key)) return;
        $persistentStore.write('1', key);
        $notification.post('Gauss YouTube 0.4.9', outcome, message);
    } catch (_) {}
}

function execute() {
    const match = /^https:\/\/(?:youtubei|youtubei-att)\.googleapis\.com\/youtubei\/v1\/(browse|next|player|search|reel\/reel_watch_sequence|get_watch)(?:\?.*)?$/.exec($request.url || '');
    if (!match) return {};
    const route = match[1];
    const rawStatus = $response.statusCode ?? $response.status ?? 200;
    const statusMatch = /^(?:HTTP\/[\d.]+\s+)?(\d{3})(?:\s.*)?$/.exec(String(rawStatus).trim());
    const status = statusMatch ? Number(statusMatch[1]) : NaN;
    if (status !== 200) {
        report(route, 'HTTP_SKIP', Number.isFinite(status) ? String(status) : 'unrecognized-status');
        return {};
    }
    let body = $response.bodyBytes ?? $response.body;
    if (body instanceof ArrayBuffer) body = new Uint8Array(body);
    else if (Array.isArray(body)) body = Uint8Array.from(body);
    if (!(body instanceof Uint8Array)) {
        report(route, 'BODY_SKIP', typeof body);
        return {};
    }
    if (!body.length || body.length > 2097152) {
        report(route, 'SIZE_SKIP', 'bytes=' + body.length);
        return {};
    }
    const type = routes[route];
    let message;
    try { message = type.fromBinary(body); }
    catch (_) {
        report(route, 'PROTOBUF_ERROR', 'bytes=' + body.length);
        return {};
    }
    const removed = clean(route, message);
    report(route, removed ? 'FILTERED' : 'NO_MATCH', 'removed=' + removed + ' bytes=' + body.length);
    if (!removed) return {};
    const headers = {...($response.headers || {})};
    for (const key of Object.keys(headers)) {
        if (/^(content-length|content-encoding)$/i.test(key)) delete headers[key];
    }
    return {body: type.toBinary(message), headers};
}

let result = {};
try {
    result = execute();
} catch (error) {
    console.log('[GAUSS-YT-LOCAL] bypass: unsupported response');
}
$done(result);
