# 百度地图去广告 · Stash 版（可自动更新）

把 [Kelee（可莉）的 Loon 插件 `BaiduMap_remove_ads.lpx`](https://kelee.one/Tool/Loon/Lpx/BaiduMap_remove_ads.lpx) 逐条移植成 **Stash 覆写文件**（`.stoverride`），并附带一个转换脚本：上游插件一更新，重新跑一次脚本就能生成新版；配合 GitHub Action 即可"订阅一次，之后自动跟随上游更新"。

## 文件说明

| 文件 | 作用 |
|---|---|
| `BaiduMap_remove_ads.stoverride` | **主文件**，Stash 直接用 |
| `update-from-lpx.js` | 拉取上游 `.lpx` 并重新生成 `.stoverride`（跟随更新） |
| `verify.js` | 校验 YAML 结构、正则、MITM 覆盖、jq 表达式 |
| `.github/workflows/update.yml` | 每天自动跑一次更新 + 校验并提交 |

## 安装（Stash）

1. 打开 Stash → **配置** → **覆写** → 右上角 `+`。
2. 二选一：
   - **本地**：选「文件」，导入 `BaiduMap_remove_ads.stoverride`；
   - **远程**：选「URL」，填入你自己的 raw 链接（见下节），之后 Stash 会跟随远程文件更新。
3. 到 Stash → **设置** → **证书**，确认根证书已生成并在系统里**安装 + 信任**（否则 443 无法解密，规则不生效）。
4. 打开百度地图验证：开屏广告、出行页推广、周边页推广、打车页推广消失，「我的」页面变干净。

## 让它可以"自动更新"

规则文件本身是静态 YAML，真正的"可更新"靠**托管 + 远程订阅**：

```
① fork / 新建仓库 → 把本目录内容推上去
② 仓库 Settings → Actions → 允许运行
③ 默认每天 04:30 跑一次 update.yml：拉上游 → 重新生成 → 校验 → 有变化才 commit
④ Stash 用这个地址做远程覆写：
   https://raw.githubusercontent.com/<你>/<仓库>/main/BaiduMap_remove_ads.stoverride
   （或 jsDelivr：https://cdn.jsdelivr.net/gh/<你>/<仓库>@main/BaiduMap_remove_ads.stoverride）
```

不想用 CI，本地手动更新也行：

```bash
npm install
npm run update     # 重新生成
npm run verify     # 校验
```

> 上游 `kelee.one` 有 Cloudflare 防护，脚本会自动回退到 GitHub 镜像
> `mihoyo-typ/KeleeOne`（内容同源）。镜像滞后时用 `--local 路径` 直接喂本地 lpx 也能生成。

## Loon → Stash 的移植对照

这次转换用到的三类能力，正好是两种格式差异最大的地方：

| Loon 写法 | Stash 写法 | 说明 |
|---|---|---|
| `[Rewrite]` 段 + `reject-dict` | `http.url-rewrite`：`- <正则> - reject-dict` | Stash 的 `reject-dict` 同样是「200 + 响应体 `{}`」，语义完全对齐 |
| `response-body-json-del a b` | `http.body-rewrite`：`- '<正则> response-jq del(.a, .b)'` | Stash 没有 `response-body-json-*` 指令，等价能力是 `body-rewrite` + jq |
| `response-body-json-replace a {}` | `... response-jq .a = {}` | 路径 `a.b[1]` → `.a.b[1]` |
| `[MitM] hostname=a, b` | `http.mitm` 列表 | 每个被改写的域名都必须在这里 |

`body-rewrite` 的 jq 表达式已用真实结构实测：`del()` 在字段缺失时不会报错（`{}` → `{}`），
`del(.Result.cards[1], .Result.cards[4], .Result.cards[5], .Result.cards[9])` 会按原始下标删除，
得到 `["a","c","d"]`，与 Loon 行为一致。

## 与原插件的差异（只有一处，且是修 bug）

原插件 `[MitM]` 只写了 4 个域名：`afd.baidu.com, newclient.map.baidu.com, yongche.baidu.com, ecom.map.baidu.com`，
但规则里还有一条 `maphotel.baidu.com/hotel/goextranet/activity/detail?` 的 `reject-dict` ——
**该域名没进 MITM，这条规则在 Loon 里其实是不生效的**。Stash 版已补上 `maphotel.baidu.com`。
转换脚本也会自动把「规则用到但插件漏写」的主机补进 `mitm`，以后再出现同类遗漏会自动兜住。

## 注意 / 排错

- **App Store 版百度地图可能无效**：原作者注明需要签名 IPA 才能用（App 对 `map.baidu.com` 做了证书校验 / 走的不是可解密通道）。Stash 同样受此限制，能装 MITM 证书但被 App 拒绝时无解。
- 百度地图部分请求走 HTTP/3（QUIC），Stash 的 HTTP 引擎抓不到；如确有需要可在配置里加 `http.force-http-engine: ['*:443']`（会增加耗电，非必要不加）。
- 某条接口若返回的不是 JSON 对象，`response-jq` 会跳过该次改写，不影响正常请求；实在要更"硬"的手段，可把对应 `reject-dict` 换成 `reject-200`。
- 小红书/知乎那种"整段 JSON 清空"的写法这里不用：本插件只删具体字段，保守且不易让 App 白屏。

## 校验结果（当前版本）

```
✓ YAML 解析正常：url-rewrite 7 / body-rewrite 5 / mitm 5
✓ 全部正则可编译，规则引用的主机都在 mitm 中
✓ 已知规则命中回归 17 条（未在文件中的规则已跳过）
✓ jq 表达式在真实结构上结果正确
```

`verify.js` 是「按 pattern 存在性」做断言的：上游增删规则时只跳过不再存在的用例，不会误报，
所以可以直接放进 CI 当作更新后的守门人。

上游版本：`#!date=2025-05-13 15:17:08`（12 条 Rewrite 全部转换，无遗漏）。
