// Reuse the locked esbuild, protobuf-ts and fflate dependencies in ../youtube-ump.
const path = require('node:path');
const deps = path.resolve(__dirname, '../youtube-ump/node_modules');
const esbuild = require(require.resolve('esbuild', {paths: [deps, __dirname]}));
esbuild.buildSync({ entryPoints: [path.join(__dirname, 'search.js')],
  nodePaths: [deps, ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)],
  outfile: path.join(__dirname, '../../scripts/bili-search-qx.js'),
  bundle: true, minify: true, platform: 'browser', target: 'es2020',
  banner: {js: '// Local search filter. Dependency licenses: components/youtube-ump/LICENSES/'}
});
