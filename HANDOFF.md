# HANDOFF · dsh-obscura-skill 项目交接

> **当前状态，不是规则。** 规则看 `AGENTS.md`；决策看 `DECISIONS.md`；环境看 `docs/00-环境与工具链.md`。
> 每次开工先读本文件，收尾必须更新本文件。目标 1–2 页，不写流水账。

**最后更新**：2026-11-14
**仓库**：本地 git（远端待定）· 分支 `main`
**当前环境**：HarmonyOS PC 工作区（`/storage/Users/currentUser/projects/DSH_Proj`）

---

## 1. 当前目标

- 把 Obscura 封装成跨平台 DSH skill（`skill/dsh-obscura/`），能力面超过 `dsh-lightpanda`：
  P2 抓取 + P4 渲染（截图/PDF）+ P3 serve+CDP（cookie 持久化）。

## 2. 上次做到哪

- 2026-11-14：补齐 **stealth 变体**：OHOS 自建 stealth 资产（95.3MB，BoringSSL）跑通；`--stealth` 自动选变体；
  实测 JA3 与 render 不同（`h2` + GREASE + Chrome UA）。发布待办：GitHub release + AtomGit。
- 2026-11-14：完成 skill 首版：`resolve/fetch/serve/cdp` 四件套 + manifest（6 平台）+ OHOS 自建资产（81.7MB）+ 发布工具；
  本机实测 fetch（markdown/text）、截图、serve+CDP（evaluate/screenshot/PDF）全通过（CJK 正常）。
- 2026-11-14：初始化项目骨架（`AGENTS.md` / `HANDOFF.md` / `DECISIONS.md` / `README.md` / `docs/` 编号文档 / `tools/` / `.gitignore`）。

## 3. 下一步（按优先级）

1. 发布：`tools/update-manifest.mjs` + `tools/publish-release.sh` 把 OHOS 资产与 manifest 发到 GitHub/AtomGit（需用户定仓库名/凭据）。
2. 用真实站点回归：`fetch --dump markdown`（JS 站）、`cdp --poll-selector`、`--pdf`、`--dump cookies`（登录态）。
3. 评估 stealth 变体（BoringSSL + TLS 指纹），作为可选资产。
4. 与 lightpanda skill 的默认路由（轻抓取 vs 渲染）写进上层使用说明。

## 4. 已知坑 / 约束（别重复踩）

- 见 `docs/00-环境与工具链.md` §6（本机通用坑：npm/pnpm 假壳、brew 命令不在默认 PATH、python SSL、chmod 无效、DevEco 目录不可读、`gcc` 其实是 clang 包装、没有 ldd/gdb/valgrind）。

## 5. 本次改动（2026-11-14）

- 初始化项目骨架；未写业务代码、未改环境。

## 6. 开工 / 收尾模板

```text
开工：项目 dsh-obscura-skill。先读 HANDOFF.md、AGENTS.md、DECISIONS.md、docs/00。
本次只做：<一个明确任务>。结束前更新 HANDOFF.md。
收尾：更新 HANDOFF.md：1) 改了什么 2) 验证结果 3) 没做完的 4) 新坑 5) 下一步。
```
