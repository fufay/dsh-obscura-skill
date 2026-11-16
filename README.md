# dsh-obscura-skill

> 把 **Obscura** 封装成跨平台 DSH skill：真渲染截图/PDF、cookie 持久化、CDP、Windows 原生。
> 创建于 2026-11-14；上位项目 `dsh-lightpanda-skill` 的结构参照。

## 与 dsh-lightpanda-skill 的比较优势

两者都是本机的无头浏览器 skill；**dsh-obscura 是"完整浏览器后端"，dsh-lightpanda 是"轻量抓取后端"**。
同一个任务，Obscura 多出来的能力：

| 维度 | dsh-lightpanda | dsh-obscura（本 skill） |
|---|---|---|
| 渲染 | 轻量渲染 | **真渲染**（Taffy 布局 + 文本整形）；截图、全页截图、`Page.printToPDF` |
| 内容导出 | markdown / html / structured_data / semantic_tree | 再加 **text / links / assets（子资源清单）/ cookies（含 HttpOnly）/ original（原样 body）** |
| 登录态 | `--cookie` / `--cookie-jar` 文件 | **`--storage-dir` 持久化**（cookie/localStorage 跨进程重启），`login.mjs` 两步登录 + 图形验证码（agent 识别后回填） |
| 反爬 | 无 | **可选 stealth**（BoringSSL/TLS 指纹 + GREASE + HTTP/2 + tracker 屏蔽；实测 JA3 与 render 不同） |
| Windows | 需 WSL2 | **原生 exe** |
| 协议面 | LP 专有 CDP 方法 | **标准 Chrome 风格 CDP**（Puppeteer/Playwright 可接）+ 内置 **MCP** |
| 并发抓取 | 批量 | `scrape --concurrency`（默认 10） |
| 体积 / 启动成本 | **更轻更快**（74MB 级） | 更重（OHOS 94MB，真渲染 + V8） |

**结论**：要"内容/接口抓取、体积敏感"→ lightpanda 仍合适；要"渲染截图、PDF、登录态、反爬、Windows 原生、CDP/MCP"
→ 用 dsh-obscura。两者 skill 名不同，可以共存。

**本机现状**：已卸载 `dsh-lightpanda`（保留源码仓库），抓取/截图/PDF/登录统一走 `dsh-obscura`。
更细的权衡与实测数据见 [docs/10-设计与能力对比.md](docs/10-设计与能力对比.md)。

## 安装（DSH Desktop / Whale）

```sh
# 国内优先 AtomGit；GitHub 亦可
git clone https://atomgit.com/Kevin911/dsh-obscura-skill dsh-obscura-skill
# 或 git clone https://github.com/fufay/dsh-obscura-skill dsh-obscura-skill
sh dsh-obscura-skill/tools/install.sh        # 复制到 $DSH_HOME/skills/dsh-obscura
```

之后在 DSH 里直接用触发词（"用 obscura 抓/截图/导出 PDF"）。首次调用会按平台下载二进制并校验 sha256
（OHOS 用本项目自建资产；其它平台用上游 v0.2.7 资产）。

## 各平台二进制从哪来

**本仓库 release 只放 HarmonyOS 自建资产**（上游没有 musl/OHOS 版）。其他平台直接用上游 Obscura v0.2.7
的官方资产，`resolve.mjs` 会自动下载并校验 sha256：

| 平台 | 资产文件（render / stealth） | 来源 |
|---|---|---|
| HarmonyOS PC (aarch64) | `obscura-aarch64-ohos{,-stealth}.tar.gz` | **本仓库 release**（自建 + 自签） |
| Linux x86_64 | `obscura-x86_64-linux{,-stealth}.tar.gz` | 上游 release |
| Linux aarch64 | `obscura-aarch64-linux{,-stealth}.tar.gz` | 上游 release |
| macOS arm64 | `obscura-aarch64-macos{,-stealth}.tar.gz` | 上游 release |
| macOS x86_64 | `obscura-x86_64-macos{,-stealth}.tar.gz` | 上游 release |
| Windows x64 | `obscura-x86_64-windows{,-stealth}.zip` | 上游 release |

上游：<https://github.com/h4ckf0r0day/obscura/releases/tag/v0.2.7>

**查找顺序**（同名文件）：本仓库 GitHub release → 本仓库 AtomGit release → 上游 release；找到后按 manifest 的 sha256 校验。

如果 GitHub 慢/不可达（国内常见）：

1. 先设代理再首次调用：`export HTTPS_PROXY=http://127.0.0.1:7890`（`resolve.mjs` 用 `curl`，会读取该变量）；
2. 或手动下载上表对应资产放进一个目录，设 `DSH_OBSCURA_LOCAL_DIR=<dir>`（离线安装）；
3. 或自建镜像：`DSH_OBSCURA_ASSET_BASE=https://<镜像>/<tag>`。

## 快速开始

```sh
NODE=node
$NODE skill/dsh-obscura/scripts/resolve.mjs --check   # 本平台选哪个资产
$NODE skill/dsh-obscura/scripts/resolve.mjs           # 下载+校验+解压
$NODE skill/dsh-obscura/scripts/fetch.mjs https://example.com --dump markdown
$NODE skill/dsh-obscura/scripts/serve.mjs ensure --port 9222
$NODE skill/dsh-obscura/scripts/cdp.mjs --port 9222 --url https://example.com --screenshot /tmp/a.png
```

## 登录（含图形验证码，给 agent 用）

```sh
# 账号密码从环境变量读；验证码截成图片给 agent 识别
node skill/dsh-obscura/scripts/login.mjs start --port 9222 --url https://site/login \
  --user-sel "#user" --user-env LOGIN_USER --pass-sel "#pass" --pass-env LOGIN_PASS \
  --captcha-sel "#captcha" --captcha-out /tmp/cap.png --code-sel "#code"
# agent 识别 /tmp/cap.png 后：
node skill/dsh-obscura/scripts/login.mjs answer --port 9222 --code A7K3 --success-url https://site/home
```

## 文档索引

| 文件 | 内容 |
|---|---|
| [SKILL.md](skill/dsh-obscura/SKILL.md) | **skill 本体**：触发词、三档形态、用法与判定 |
| [AGENTS.md](AGENTS.md) | 稳定规则（读序/铁律/构建验收/git） |
| [HANDOFF.md](HANDOFF.md) | 当前状态 / 下一步 / 坑 |
| [DECISIONS.md](DECISIONS.md) | 决策记录 |
| [docs/01-项目概览.md](docs/01-项目概览.md) | 目标 / 范围 / 明确不做 |
| [docs/02-参考资源清单.md](docs/02-参考资源清单.md) | 上游版本与资产清单 |
| [docs/10-设计与能力对比.md](docs/10-设计与能力对比.md) | **与 lightpanda 的能力矩阵与取舍** |
| [docs/11-发布与设计.md](docs/11-发布与设计.md) | 资产模型、发布流程、升级步骤 |
| [docs/99-参考链接.md](docs/99-参考链接.md) | 来源 |

## 目录

| 目录 | 用途 |
|---|---|
| `skill/dsh-obscura/` | skill 本体（SKILL.md / scripts / assets） |
| `tools/` | 构建 OHOS 资产、刷新 manifest、发布 |
| `_build/` | 构建产物与下载缓存（**不入库**） |
| `_refer/` | 上游源码原始副本（**不入库**） |

## 许可

- **本仓库的 skill 代码与文档：MIT**（见 [LICENSE](LICENSE)）。
- **Obscura 二进制**：由上游 [h4ckf0r0day/obscura](https://github.com/h4ckf0r0day/obscura) 构建，**Apache-2.0**；
  OHOS 版为本项目自建，同样遵循上游 Apache-2.0。
