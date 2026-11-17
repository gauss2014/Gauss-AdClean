const fs = require('node:fs');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = __dirname;
const sourcePath = path.join(root, 'upstream-response.js');
const source = fs.readFileSync(sourcePath, 'utf8');
assert.equal(crypto.createHash('sha256').update(source).digest('hex'),
  'f98483d5f5017514f82502253c0db5ce2d4ffb7839887aa2cadc22666f5a7f12');
const start = source.indexOf('(()=>{') + 6;
const end = source.indexOf('function Ni(');
assert(start > 5 && end > start);
const originalAdapter = fs.readFileSync(path.join(root, 'ad-only-source.js'), 'utf8');
const cleanSource = originalAdapter.slice(0, originalAdapter.indexOf('function report('));
fs.writeFileSync(path.join(root, 'schema.generated.js'),
  '// Maasea/sgmodule 65075cdb, Apache-2.0. Generated schema and ad-only adapter.\n' +
  'const exported = (() => {' + source.slice(start, end) + '\n' + cleanSource +
  '\nreturn {schema:{routes,player:oe,part:Z,config:kr},clean,cleanPlayer,cleanFeed};})();\n' +
  'export const {schema,clean,cleanPlayer,cleanFeed} = exported;\n');
const config = {entryPoints: [path.join(root, 'ump-runtime.js')], bundle: true,
  platform: 'browser', target: 'es2020', format: 'iife', globalName: 'GaussUMP',
  minify: true, write: false, legalComments: 'inline'};
(async () => {
  const result = await esbuild.build(config);
  const code = result.outputFiles[0].text;
  for (const token of ['workers.dev', '$task', '$httpClient', 'XMLHttpRequest', 'WebSocket', 'fetch('])
    assert(!code.includes(token), token);
  fs.writeFileSync(path.join(root, 'runtime.test-bundle.js'), code);
  const runtime = '// Gauss QX local UMP beta1. Runtime network calls: zero. See accompanying LICENSES.\n' + code + '\nGaussUMP.run();\n';
  fs.writeFileSync(path.join(root, 'youtube-ump-local-qx.js'), runtime);
  console.log(JSON.stringify({bytes: Buffer.byteLength(runtime), runtime_network_calls: 0}));
})().catch(e => {console.error(e);process.exitCode=1;});
