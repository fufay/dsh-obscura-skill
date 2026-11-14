---
name: dsh-obscura
description: 用 Obscura（Rust 写的无头浏览器，真渲染）抓网页/跑 JS/截图/导出 PDF/CDP 交互，覆盖 HarmonyOS PC、Linux(x86_64/aarch64)、macOS(arm64/x64)、Windows(x64)；二进制按平台下载并按 sha256 校验。分三档：P2 无状态抓取（fetch：markdown/html/text/links/assets/cookies）、P4 渲染（截图 PNG / PDF）、P3 有状态会话（serve+CDP：cookie 持久化/多步交互）。触发词：用 obscura 抓、无头浏览器截图、网页转 PDF、抓这个页面、跑 JS 抓接口、登录后抓数据、CDP 截图、渲染检查。
whenToUse: 用户要求抓取网页内容/列表/结构化数据、需要真实渲染截图或导出 PDF、需要执行页面 JS 后再取内容、需要登录态（cookie）跨步骤抓数据、或需要 CDP 驱动页面。不用于：纯搜索（先用搜索工具）、需要过强反爬（Cloudflare 等，本 skill 默认无 TLS 指纹伪装）、需要视频播放/验证码识别。
---

# dsh-obscura：带真渲染的无头浏览器

> 调用 **Obscura**（<https://github.com/h4ckf0r0day/obscura>，Apache-2.0，非 Chromium）。
> 二进制不在仓库里：`scripts/resolve.mjs` 按平台从 **GitHub → AtomGit → 上游** 下载归档、sha256 校验、解压到
> `~/.cache/dsh-obscura/<tag>/`；HarmonyOS 用本项目自建的 musl 资产（上游只发 glibc）。

## 0. 先决策：用哪一档

| 档位 | 何时用 | 入口 |
|---|---|---|
| **P2 无状态抓取**（默认） | 公开页面、只要内容（markdown/html/text/links）、单页/多 URL | `scripts/fetch.mjs` |
| **P4 渲染** | 要截图 PNG / PDF、要检查布局 | `fetch.mjs --screenshot`（简版）或 `serve.mjs`+`cdp.mjs`（可控） |
| **P3 有状态会话** | 需要 cookie/登录态、多步交互、同一会话连续取多页 | `scripts/serve.mjs` + `scripts/cdp.mjs` |

**默认 P2**；要"像浏览器一样的画面/排版"→ P4；要"记住状态"→ P3（P3 也能截图/PDF）。

## 1. 准备（首次自动完成）

```sh
NODE=node            # Node 18+；Node 22+ 最好（内建 WebSocket，cdp.mjs 需要）
$NODE scripts/resolve.mjs --check    # 看本平台选哪个资产（不下载）
$NODE scripts/resolve.mjs            # 下载+校验+解压，打印 obscura 路径
```

- **HarmonyOS PC**：用本项目自建 `obscura-aarch64-ohos.tar.gz`（musl + 自签，可直接跑）；
- Linux x86_64/arm64、macOS、Windows：用上游 v0.2.7 的 `render` 资产；
- 离线/内网：把对应归档放到一个目录，设 `DSH_OBSCURA_LOCAL_DIR=<dir>`（也支持已解压的目录）；
- 缓存：`~/.cache/dsh-obscura/<tag>/`；重下用 `--force`。

## 2. P2：无状态抓取

```sh
# 正文（markdown，最省 token）
$NODE scripts/fetch.mjs "https://example.com" --dump markdown

# 结构化/原始
$NODE scripts/fetch.mjs "https://example.com" --dump html
$NODE scripts/fetch.mjs "https://example.com" --dump links
$NODE scripts/fetch.mjs "https://example.com/api.json" --dump original   # 绕过 JS，原样取 body（JSON/图片/CSS）

# 跑 JS 后再取（wait 单位是秒；默认自适应 5s 封顶）
$NODE scripts/fetch.mjs "https://site/list" --dump html --wait 8
$NODE scripts/fetch.mjs "https://site/x" --eval "document.title"

# 抓子资源清单 / HttpOnly cookie（登录态提取）
$NODE scripts/fetch.mjs "https://site/page" --dump assets
$NODE scripts/fetch.mjs "https://site/page" --dump cookies

# 截图（PNG；注意：fetch 子命令没有 --font-dir，中文会缺字，CJK 页面请走 P3+P4）
$NODE scripts/fetch.mjs "https://example.com" --screenshot shot.png

# 代理 / UA / robots / 私网
$NODE scripts/fetch.mjs "https://x" --proxy http://127.0.0.1:7890
$NODE scripts/fetch.mjs "http://127.0.0.1:8000" --allow-private-network

# 多 URL + JSON（串行，一个失败不影响其它）
$NODE scripts/fetch.mjs "https://a" "https://b" --dump markdown --json
```

## 3. P3：有状态会话（serve + CDP）

```sh
$NODE scripts/serve.mjs ensure --port 9222          # 幂等启动；默认 storage 固定（cookie 跨重启）
$NODE scripts/serve.mjs status --port 9222
$NODE scripts/serve.mjs stop   --port 9222

# 页面里跑 JS
$NODE scripts/cdp.mjs --port 9222 --url "https://site/login" --eval "document.title"

# 等元素出现再取值
$NODE scripts/cdp.mjs --port 9222 --url "https://site/list" \
  --poll-selector ".card" --min 5 \
  --eval "JSON.stringify([...document.querySelectorAll('.card')].map(e=>e.innerText))"

# 截图 / 全页截图 / PDF（CJK 字体由 serve 自动挂 /system/fonts）
$NODE scripts/cdp.mjs --port 9222 --url "https://site" --screenshot page.png --full-page
$NODE scripts/cdp.mjs --port 9222 --url "https://site" --pdf page.pdf

# 导出 cookie（含 HttpOnly）
$NODE scripts/cdp.mjs --port 9222 --url "https://site" --cookies
```

- **cookie 持久化**：`serve --storage-dir`（默认 `~/.cache/dsh-obscura/serve/storage-<port>`），重启后登录态还在。
- **CJK**：OHOS 上 `serve` 自动加 `--font-dir /system/fonts`；其它平台用 `--font-dir` 指定字体目录。
- 代理：`serve --proxy http://...`（Obscura 不保证读 `HTTPS_PROXY`，显式传）。

## 4. 平台矩阵

| 平台 | 资产 | 备注 |
|---|---|---|
| HarmonyOS PC (aarch64) | 本项目自建 musl + 自签 | `serve` 自动挂系统字体；可直接执行 |
| Linux x86_64 / aarch64 | 上游 `obscura-*-linux.tar.gz`（glibc 2.35+） | 需要对应 glibc |
| macOS arm64 / x64 | 上游 `*-macos.tar.gz` | 首次运行可能需 `xattr -d com.apple.quarantine` |
| Windows x64 | 上游 `*-windows.zip` | **原生 exe**（lightpanda 需 WSL2） |

## 5. 与 dsh-lightpanda 的分工

- 轻量抓取（只要正文/接口、成本敏感）→ 仍用 `dsh-lightpanda`（更快更省）。
- 要**真渲染**（截图/PDF/布局）、要 **cookie 持久化**、要 **HttpOnly cookie / assets 清单**、要 **Windows 原生**、要 **MCP** → 用本 skill。
- 强反爬站点（Cloudflare/Akamai）：本 skill 默认 **render** 版本，没有 TLS 指纹伪装；需要时另做 stealth 构建（BoringSSL，见项目 `docs/`）。

## 6. 返回与判定

- `fetch.mjs --json`：`{ok,url,output,screenshot?,stderr}`（多 URL 为数组）。
- `cdp.mjs`：`{ok,url,title,value,screenshot?,pdf?,cookies?,error?}`。
- 失败优先看 `stderr`/`error`：`CDP 不可达` → 没起 serve；`Network error` → 代理/域名解析；`certificate` → 自签站点需 `SSL_CERT_FILE`（fetch/serve 进程环境变量）。
