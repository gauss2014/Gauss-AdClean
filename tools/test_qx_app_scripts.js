const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const root = path.resolve(__dirname, '..');
const snippet = fs.readFileSync(path.join(root, 'modules/Gauss-Apps-QX.snippet'), 'utf8');
function run(url, body) {
    const rule = snippet.split('\n').find(l => l.includes(' url script-response-body ') && new RegExp(l.split(' url ')[0]).test(url));
    assert(rule, url);
    const reference = rule.split('/Gauss-AdClean/')[1];
    const slash = reference.indexOf('/');
    const code = execFileSync('git', ['show', reference.slice(0, slash) + ':' + reference.slice(slash + 1)], {cwd: root, encoding: 'utf8'});
    const results = [];
    const context = {$request: {url}, $response: {statusCode: 200, body},
        $done: r => results.push(r), console: {log() {}}};
    for (const name of ['$task', '$httpClient', 'fetch']) Object.defineProperty(context, name, {get() {throw new Error('external request');}});
    vm.runInNewContext(code, context, {timeout: 1000});
    assert.equal(results.length, 1);
    return JSON.parse(JSON.stringify(results[0]));
}
test('QX exact pinned JD main script clears splash and preserves normal response', () => {
    const url = 'https://api.m.jd.com/api?functionId=start';
    assert.deepEqual(JSON.parse(run(url, '{"data":{"images":[1],"showTimesDaily":3,"logo":"keep"}}').body),
        {data: {images: [], showTimesDaily: 0, logo: 'keep'}});
    assert.deepEqual(run('https://api.m.jd.com/api?functionId=submitOrder', '{"data":{"order":1}}'), {});
});
test('QX wallet keeps the old wallet-capable version, not main-only script', () => {
    const url = 'https://ms.jr.jd.com/gw2/generic/MyWalletS/newh5/m/myWalletIndex?v=1';
    const result = run(url, '{"resultData":{"data":{"moduleSortedMap":{"CASH_LOAN_V3":{"x":1},"BALANCE":{"amount":42}}}}}');
    assert.deepEqual(JSON.parse(result.body), {resultData: {data: {moduleSortedMap: {BALANCE: {amount: 42}}}}});
});
test('QX Xianyu exact pinned script preserves envelope and clears splash', () => {
    const url = 'https://acs.m.goofish.com/gw/mtop.taobao.idlecommerce.splash.ads/1.0/';
    assert.deepEqual(JSON.parse(run(url, '{"data":{"ads":[1],"cacheAd":"x","normal":2},"ret":["SUCCESS"]}').body),
        {data: {ads: [], cacheAd: '', normal: 2}, ret: ['SUCCESS']});
    assert.deepEqual(run(url, '<html>error</html>'), {});
});
