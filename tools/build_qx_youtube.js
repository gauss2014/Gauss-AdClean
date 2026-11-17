const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'scripts/youtube-response-cleanup.js'), 'utf8');
const output = `// Quantumult X adapter qx-v0.1.0. Local response processing only.
// Core attribution and license retained below.
(function ($response, $done, $notification, $persistentStore) {
${core}
})($response, function (result) {
    if (!result || !(result.body instanceof Uint8Array)) {
        $done({});
        return;
    }
    const bytes = result.body;
    // QX owns content-length/content-encoding; return the exact binary view only.
    $done({bodyBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)});
}, {
    post: function (_title, outcome, message) {
        if (typeof $notify === 'function') $notify('Gauss YouTube QX 0.1.0', outcome, message);
    }
}, {
    read: function (key) {
        return typeof $prefs === 'undefined' ? null : $prefs.valueForKey('QX-0.1.0-' + key);
    },
    write: function (value, key) {
        return typeof $prefs === 'undefined' ? false : $prefs.setValueForKey(value, 'QX-0.1.0-' + key);
    }
});
`;
fs.writeFileSync(path.join(root, 'scripts/youtube-response-cleanup-qx.js'), output);

const moduleText = fs.readFileSync(path.join(root, 'modules/Gauss-AdClean.sgmodule'), 'utf8');
const apiLine = moduleText.split('\n').find(line => line.startsWith('Gauss_YT_Local ='));
const pattern = apiLine.match(/pattern=([^,]+)/)[1];
const cdnLine = moduleText.split('\n').find(line => line.startsWith('^https?://(?!redirector)'));
if (!cdnLine || !cdnLine.endsWith(' _ reject-200')) throw new Error('Missing exact CDN rule');
const snippet = `# Gauss YouTube QX 0.1.0
# Add as a rewrite resource, not a full configuration. No resource parser needed.
# Uses QX MitM QUIC handling; no global UDP block or routing changes.
# Only actual rr/r CDN endpoints, leaving redirectors outside MitM.
hostname = youtubei.googleapis.com, youtubei-att.googleapis.com, rr*.googlevideo.com, r?.googlevideo.com, r??.googlevideo.com
${pattern} url script-response-body https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/qx-v0.1.0/scripts/youtube-response-cleanup-qx.js
${cdnLine.replace(' _ reject-200', ' url reject-200')}
`;
fs.writeFileSync(path.join(root, 'modules/Gauss-YouTube-QX.snippet'), snippet);
console.log(JSON.stringify({script_bytes: Buffer.byteLength(output), snippet_bytes: Buffer.byteLength(snippet)}));
