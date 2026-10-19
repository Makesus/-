#!/usr/bin/env node
/**
 * update-from-lpx.js
 * 把 Kelee 的 Loon 插件 BaiduMap_remove_ads.lpx 转换成 Stash 覆写(.stoverride)。
 *
 * 用法：
 *   node update-from-lpx.js          # 拉取上游最新版并重新生成 .stoverride
 *   node update-from-lpx.js --local path\to\BaiduMap_remove_ads.lpx
 *   node update-from-lpx.js --verify # 只校验当前 .stoverride 与上游是否一致/可解析
 *
 * 依赖：npm i yaml
 */
'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const OUT = path.join(__dirname, 'BaiduMap_remove_ads.stoverride');

// 上游：官方源最容易触发 Cloudflare 拦截，GitHub 镜像作为回退
const SOURCES = [
  'https://kelee.one/Tool/Loon/Lpx/BaiduMap_remove_ads.lpx',
  'https://raw.githubusercontent.com/mihoyo-typ/KeleeOne/Loon/Plugin/BaiduMap_remove_ads.lpx',
  'https://cdn.jsdelivr.net/gh/mihoyo-typ/KeleeOne@Loon/Plugin/BaiduMap_remove_ads.lpx',
];

/* ---------------- 拉取 ---------------- */
async function fetchSource() {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Stash-Override-Updater)' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (!text.includes('[Rewrite]')) throw new Error('响应不是 lpx 内容');
      return { text, url };
    } catch (e) {
      console.error(`  ! ${url} -> ${e.message}`);
    }
  }
  throw new Error('所有上游源都失败');
}

/* ---------------- 解析 lpx ---------------- */
function parseLpx(text) {
  const meta = {};
  let section = '';
  const rewrites = [];
  let mitm = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const h = line.match(/^#!([\w-]+)=(.*)$/);
    if (h) { meta[h[1]] = h[2].trim(); continue; }

    const s = line.match(/^\[(.+)\]$/);
    if (s) { section = s[1].toLowerCase(); continue; }

    if (section === 'rewrite') {
      // <regex> <action> [args...]
      const m = line.match(/^(\S+)\s+(\S+)\s*(.*)$/);
      if (m) rewrites.push({ pattern: m[1], action: m[2], args: m[3] ? m[3].trim().split(/\s+/) : [] });
    } else if (section === 'mitm') {
      const m = line.match(/^hostname\s*=\s*(.*)$/i);
      if (m) mitm = m[1].split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return { meta, rewrites, mitm };
}

/* ---------------- 路径 / 主机工具 ---------------- */
const toJqPath = p => (p.startsWith('.') ? p : '.' + p);

function hostOf(pattern) {
  // 先把正则里的转义斜杠还原，再取主机部分，最后去掉残留的反斜杠（\. -> .）
  const s = pattern.replace(/\\\//g, '/').replace(/^\^/, '');
  const m = s.match(/^https?:\/\/([^/:]+)/i);
  if (!m) return null;
  const host = m[1].replace(/\\/g, '');
  return /^[\w.*-]+$/.test(host) ? host : null; // 含正则元字符的（如 .+）直接忽略
}

const q = s => "'" + s.replace(/'/g, "''") + "'";

/* ---------------- 转换 ---------------- */
function convert({ meta, rewrites, mitm }, srcUrl) {
  const urlRewrite = [];
  const bodyRewrite = [];
  const skipped = [];
  const usedHosts = new Set();

  for (const { pattern, action, args } of rewrites) {
    const host = hostOf(pattern);
    if (host && !/[*?()[\]]/.test(host)) usedHosts.add(host);

    switch (action) {
      case 'reject':
      case 'reject-200':
      case 'reject-img':
      case 'reject-dict':
      case 'reject-array':
        urlRewrite.push(`${pattern} - ${action}`);
        break;
      case 'response-body-json-del':
        bodyRewrite.push(`${pattern} response-jq del(${args.map(toJqPath).join(', ')})`);
        break;
      case 'response-body-json-replace':
        bodyRewrite.push(`${pattern} response-jq ${toJqPath(args[0])} = ${args.slice(1).join(' ')}`);
        break;
      default:
        // 302 / 307：<pattern> <target> <code>
        if (action === '302' || action === '307') {
          urlRewrite.push(`${pattern} ${args[0]} ${action}`);
        } else {
          skipped.push(`${action} :: ${pattern}`);
        }
    }
  }

  // MITM：插件自带的 + 规则里实际用到但插件漏写的（例如 maphotel.baidu.com）
  const hostList = [...new Set([...mitm, ...usedHosts])];

  const bd = [
    ['name', meta['name'] || '百度地图去广告'],
    ['desc', (meta['desc'] || '百度地图去广告') + '（Stash 移植版）'],
    ['author', meta['author'] || '可莉'],
    ['homepage', meta['homepage'] || srcUrl],
    ['icon', meta['icon'] || ''],
    ['tag', meta['tag'] || '去广告'],
    ['date', meta['date'] || ''],
  ].filter(([, v]) => v);

  const out = [];
  out.push(`# 由 Loon 插件移植：${meta['name'] || 'BaiduMap_remove_ads'}`);
  out.push(`# 上游：${srcUrl}`);
  // 不写入生成时间，保证上游无变化时文件内容稳定（CI 里才不会每天产生空提交）
  out.push(`# 转换脚本：update-from-lpx.js（重新运行即可跟随上游更新）`);
  out.push('');
  for (const [k, v] of bd) out.push(`#!${k}=${v}`);
  out.push('');
  out.push(`name: ${q(meta['name'] || '百度地图去广告')}`);
  out.push(`desc: ${q((meta['desc'] || '百度地图去广告') + '（Stash 移植版）')}`);
  out.push('');
  out.push('http:');
  out.push('  mitm:');
  for (const h of hostList) out.push(`    - ${h}`);
  out.push('');
  out.push('  # Loon [Rewrite] reject-dict / reject --→ Stash url-rewrite');
  out.push('  url-rewrite:');
  for (const r of urlRewrite) out.push(`    - ${r}`);
  out.push('');
  out.push('  # Loon response-body-json-del / -replace --→ Stash body-rewrite (response-jq)');
  out.push('  body-rewrite:');
  for (const r of bodyRewrite) out.push(`    - ${q(r)}`);
  out.push('');

  return { text: out.join('\n'), stats: { urlRewrite: urlRewrite.length, bodyRewrite: bodyRewrite.length, mitm: hostList.length, skipped } };
}

/* ---------------- 自检 ---------------- */
function verify(text, sourceModel) {
  const doc = YAML.parse(text);
  const mitm = new Set(doc.http.mitm);
  const problems = [];

  const rules = [...(doc.http['url-rewrite'] || []), ...(doc.http['body-rewrite'] || [])];
  for (const r of rules) {
    const pattern = r.split(' ')[0];
    const host = hostOf(pattern);
    if (host && !mitm.has(host)) problems.push(`MITM 缺失: ${host} (${pattern})`);
    try { new RegExp(pattern); } catch (e) { problems.push(`正则非法: ${pattern} -> ${e.message}`); }
  }
  if (rules.length !== sourceModel.rewrites.length) {
    problems.push(`规则数不一致: lpx=${sourceModel.rewrites.length} stash=${rules.length}`);
  }
  return { problems, counts: { rules: rules.length, mitm: mitm.size } };
}

/* ---------------- main ---------------- */
(async () => {
  const args = process.argv.slice(2);
  let text, srcUrl;

  const localIdx = args.indexOf('--local');
  if (localIdx >= 0) {
    const p = args[localIdx + 1];
    text = fs.readFileSync(p, 'utf8');
    srcUrl = 'file://' + path.resolve(p);
    console.log('使用本地文件:', p);
  } else {
    const got = await fetchSource();
    text = got.text; srcUrl = got.url;
    console.log('已拉取上游:', srcUrl);
  }

  const model = parseLpx(text);
  console.log(`解析：${model.rewrites.length} 条 Rewrite，${model.mitm.length} 个 MITM 主机`);

  const { text: outText, stats } = convert(model, srcUrl);
  const { problems, counts } = verify(outText, model);

  if (args.includes('--verify')) {
    console.log('校验结果:', problems.length ? problems : 'OK', counts);
    if (problems.length) process.exitCode = 1;
    return;
  }

  fs.writeFileSync(OUT, outText, 'utf8');
  console.log(`已写出 ${path.basename(OUT)}：url-rewrite ${stats.urlRewrite} 条，body-rewrite ${stats.bodyRewrite} 条，mitm ${stats.mitm} 个`);
  if (stats.skipped.length) console.log('未转换(需人工处理):', stats.skipped);
  console.log('自检:', problems.length ? problems : 'OK', counts);
  if (problems.length) process.exitCode = 1;
})();
