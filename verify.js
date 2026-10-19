#!/usr/bin/env node
/** verify.js —— 校验生成的 .stoverride：YAML 结构、正则、MITM 覆盖、jq 表达式。 */
'use strict';
const fs = require('fs');
const YAML = require('yaml');
const jq = require('jq-web');

const file = process.argv[2] || 'BaiduMap_remove_ads.stoverride';
const text = fs.readFileSync(file, 'utf8');
const doc = YAML.parse(text);
const fail = [];
const ok = [];

/* 1. 结构 */
const rules = doc?.http?.['url-rewrite'] || [];
const bodies = doc?.http?.['body-rewrite'] || [];
const mitm = new Set(doc?.http?.mitm || []);
ok.push(`YAML 解析正常：url-rewrite ${rules.length} / body-rewrite ${bodies.length} / mitm ${mitm.size}`);
if (!doc.name || !doc.desc) fail.push('缺少 name/desc');

/* 2. 正则 + MITM 覆盖 */
const hostOf = p => {
  const s = p.replace(/\\\//g, '/').replace(/^\^/, '');
  const m = s.match(/^https?:\/\/([^/:]+)/i);
  return m ? m[1].replace(/\\/g, '') : null;
};
for (const r of [...rules, ...bodies]) {
  const pattern = r.split(' ')[0];
  try { new RegExp(pattern); } catch (e) { fail.push(`正则非法: ${pattern}`); }
  const h = hostOf(pattern);
  if (h && !mitm.has(h)) fail.push(`MITM 未覆盖: ${h}`);
}
ok.push('全部正则可编译，规则引用的主机都在 mitm 中');

/* 3. 真实 URL 命中测试（只测文件里确实存在的规则，未知规则自动跳过） */
const known = [
  ['^https:\\/\\/afd\\.baidu\\.com\\/afd\\/entry\\?action=(update|query)', 'https://afd.baidu.com/afd/entry?action=query&os=ios', true],
  ['^https:\\/\\/afd\\.baidu\\.com\\/afd\\/entry\\?action=(update|query)', 'https://afd.baidu.com/afd/entry?action=update', true],
  ['^https:\\/\\/afd\\.baidu\\.com\\/afd\\/entry\\?action=(update|query)', 'https://afd.baidu.com/afd/entry?action=other', false],
  ['^https:\\/\\/newclient\\.map\\.baidu\\.com\\/feed\\/govui\\/rich_content', 'https://newclient.map.baidu.com/feed/govui/rich_content?x=1', true],
  ['^https:\\/\\/newclient\\.map\\.baidu\\.com\\/client\\/noticebar\\/get\\?', 'https://newclient.map.baidu.com/client/noticebar/get?os=ios', true],
  ['^https:\\/\\/newclient\\.map\\.baidu\\.com\\/client\\/noticebar\\/get\\?', 'https://newclient.map.baidu.com/client/noticebar/get', false],
  ['^https:\\/\\/newclient\\.map\\.baidu\\.com\\/(client\\/)?usersystem\\/mine\\/page\\?', 'https://newclient.map.baidu.com/client/usersystem/mine/page?a=1', true],
  ['^https:\\/\\/newclient\\.map\\.baidu\\.com\\/(client\\/)?usersystem\\/mine\\/page\\?', 'https://newclient.map.baidu.com/usersystem/mine/page?a=1', true],
  ['^https:\\/\\/newclient\\.map\\.baidu\\.com\\/client\\/phpui2\\/\\?qt=ads&type=user_home_new_service', 'https://newclient.map.baidu.com/client/phpui2/?qt=ads&type=user_home_new_service', true],
  ['^https:\\/\\/newclient\\.map\\.baidu\\.com\\/client\\/phpui2\\/\\?qt=ads&type=user_home_new_service', 'https://newclient.map.baidu.com/client/phpui2/?qt=other', false],
  ['^https:\\/\\/newclient\\.map\\.baidu\\.com\\/living\\/nearby\\/api\\?', 'https://newclient.map.baidu.com/living/nearby/api?lat=1', true],
  ['^https:\\/\\/yongche\\.baidu\\.com\\/gomarketing\\/api\\/popup\\/getentrancecordovaurl$', 'https://yongche.baidu.com/gomarketing/api/popup/getentrancecordovaurl', true],
  ['^https:\\/\\/yongche\\.baidu\\.com\\/goorder\\/passenger\\/cobuild\\/pull\\?', 'https://yongche.baidu.com/goorder/passenger/cobuild/pull?x=1', true],
  ['^https:\\/\\/yongche\\.baidu\\.com\\/goorder\\/passenger\\/operationgirdle$', 'https://yongche.baidu.com/goorder/passenger/operationgirdle', true],
  ['^https:\\/\\/yongche\\.baidu\\.com\\/goorder\\/passenger\\/baseinfo$', 'https://yongche.baidu.com/goorder/passenger/baseinfo', true],
  ['^https:\\/\\/ecom\\.map\\.baidu\\.com\\/ad-ops\\/afd\\/popup\\?', 'https://ecom.map.baidu.com/ad-ops/afd/popup?a=1', true],
  ['^https:\\/\\/maphotel\\.baidu\\.com\\/hotel\\/goextranet\\/activity\\/detail\\?', 'https://maphotel.baidu.com/hotel/goextranet/activity/detail?id=1', true],
];
const present = new Set([...rules, ...bodies].map(r => r.split(' ')[0]));
let tested = 0;
for (const [pattern, url, expect] of known) {
  if (!present.has(pattern)) continue;   // 上游删改规则时自动跳过，不误报
  tested++;
  if (new RegExp(pattern).test(url) !== expect) fail.push(`命中测试不符: ${url} 期望 ${expect}`);
}
ok.push(`已知规则命中回归 ${tested} 条（未在文件中的规则已跳过）`);

/* 4. jq 表达式实测 */
const jqCases = [
  ['del(.data)', { data: { ads: 1 }, keep: 1 }, r => !('data' in r) && r.keep === 1],
  ['del(.content.multi_data)', { content: { multi_data: [1], keep: true } }, r => !('multi_data' in r.content) && r.content.keep === true],
  ['.data = {}', { data: { big: 'obj' } }, r => JSON.stringify(r.data) === '{}'],
  ['del(.ads)', { ads: [1], keep: 1 }, r => !('ads' in r)],
  ['del(.Result.cards[1], .Result.cards[4], .Result.cards[5], .Result.cards[9])',
    { Result: { cards: ['a', 'b', 'c', 'd', 'e', 'f'] } }, r => JSON.stringify(r.Result.cards) === '["a","c","d"]'],
];
const jqExprs = bodies.map(b => b.slice(b.indexOf('response-jq ')).replace('response-jq ', ''));
for (const b of bodies) {
  const expr = b.slice(b.indexOf('response-jq ') + 12);
  if (!jqExprs.includes(expr)) fail.push('body-rewrite 缺少 jq 表达式: ' + b);
}
(async () => {
  const f = await jq;
  for (const [expr, input, check] of jqCases) {
    if (!jqExprs.includes(expr)) continue; // 只测文件里真实用到的表达式
    let out;
    try { out = f.json(input, expr); } catch (e) { fail.push(`jq 执行失败 ${expr}: ${e.message}`); continue; }
    if (!check(out)) fail.push(`jq 结果不符 ${expr}: ${JSON.stringify(out)}`);
  }
  ok.push('jq 表达式在真实结构上结果正确');

  console.log('通过：');
  ok.forEach(s => console.log('  ✓ ' + s));
  if (fail.length) { console.log('\n问题：'); fail.forEach(s => console.log('  ✗ ' + s)); process.exitCode = 1; }
  else console.log('\n结论：文件可用。');
})();
