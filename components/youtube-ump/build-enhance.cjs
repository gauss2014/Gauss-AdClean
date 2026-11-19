const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const upstream = read('upstream-response.js');
assert.equal(crypto.createHash('sha256').update(upstream).digest('hex'),
  'f98483d5f5017514f82502253c0db5ce2d4ffb7839887aa2cadc22666f5a7f12');
const core = upstream.slice(upstream.indexOf('(()=>{') + 6, upstream.indexOf('function ii('));
assert(core.includes('var Mi=['));
const local = read('ad-only-source.js').split('function report(')[0];
const script = '// Maasea/sgmodule 65075cdb (Apache-2.0), Gauss local QX adapter.\n' +
  '(()=>{' + core + '\n' + local + '\n' + read('enhance-adapter.js') + '\n})();\n';
for (const name of ['$task', '$httpClient', 'fetch(', 'XMLHttpRequest', 'WebSocket',
  'sendBeacon', 'import(', 'eval(', 'Function(']) assert(!script.includes(name), name);
module.exports = script;
if (require.main === module)
  fs.writeFileSync(path.join(__dirname, '../../scripts/youtube-enhance-qx.js'), script);
