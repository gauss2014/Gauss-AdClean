const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const js = fs.readFileSync(require.resolve('../scripts/meituan-mine-qx.js'),'utf8');
const mine='https://mt-personalcenter.meituan.com/usercenter/display';
const tab='https://apimobile.meituan.com/aggroup/indexTab';
function run(url, data) {
  let out; vm.runInNewContext(js, {$request:{url},$response:{body:typeof data==='string'?data:JSON.stringify(data)},
    $done:v=>out=v,console:{log(){}}}); return out.body && JSON.parse(out.body);
}
const cards = (...names)=>names.map(title=>({data:{title}}));
const wallet=cards('美团借钱','美团月付','我的账单','配送未超时');
const games=cards('天天领现金','游戏中心','三国：冰河时代','我的订单');
const order={title:'订单',items:cards('退款售后','全部订单')};
const page={children:[order,{items:wallet},{items:games}]};
assert.deepEqual(run(mine+'?v=1',page).children,[order,{items:wallet.slice(2)},{items:games.slice(3)}]);
wallet[1].notice='本期应还';
assert.deepEqual(run(mine,page).children[1].items,wallet.slice(1));
const names=['homepage','video','xiaotuan','cart','mine','future'];
const nav=a=>({data:{resource:{tabArea:a.map(tabName=>({tabName}))}}});
assert.deepEqual(run(tab,nav(names)),nav(names.filter(x=>!['video','xiaotuan'].includes(x))));
assert.deepEqual(run(mine,{children:[{name:'mine_cross_recommend'},order]}),{children:[order]});
assert.equal(run(tab,nav(['xiaotuan','cart'])),undefined);
assert.equal(run(mine,{children:cards('美团借钱','游戏中心')}),undefined);
assert.equal(run(mine+'/repayment',page),undefined);
assert.equal(run(mine,'invalid'),undefined);
assert.equal(run(mine,'{"id":999999999999999999,"children":'+JSON.stringify(page.children)+'}'),undefined);
console.log('Meituan UI: wallet/game rows, other cards, repayment notice, tab order, unknown input and exact URLs OK');
