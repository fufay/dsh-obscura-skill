# DECISIONS · dsh-obscura-skill 决策记录

> 只追加「决定了什么 / 为什么 / 放弃了什么」。不写每日进度、不写命令流水账。
> 当前状态看 `HANDOFF.md`；规则看 `AGENTS.md`；环境看 `docs/00-环境与工具链.md`。

| ID | 日期 | 决定 | 为什么 / 放弃了什么 | 影响 / 文档 |
|---|---|---|---|---|
| D-001 | 2026-11-14 | 建立项目骨架：AGENTS / HANDOFF / DECISIONS + `docs/` 编号文档 + 环境文档 | 新会话开工先读 HANDOFF/环境文档，避免重复探测；文档编号便于长期维护 | 本仓库根三文件、`docs/` |

| D-002 | 2026-11-14 | 资产改用「归档 + 解压」模型（tar.gz/zip），而非 lightpanda 的单文件 | 上游按归档发布；解压后定位 obscura/obscura-worker，跨平台一致 | `scripts/resolve.mjs`、`docs/11` |
| D-003 | 2026-11-14 | OHOS 资产由本项目自建并随 release 发布；上游 5 平台直接用上游资产 | 上游无 musl/OHOS 资产；自建已实测可跑（`Eva-Research/…移植评估`） | `tools/build-obscura-ohos.sh`、`assets/manifest.json` |
| D-004 | 2026-11-14 | 首版不做 stealth；默认 render 变体 | render 已覆盖截图/PDF/抓取；stealth 需 BoringSSL 交叉，单独立项 | `docs/10` §3 |
| D-005 | 2026-11-14 | 缓存默认 `~/.cache/dsh-obscura`（不用 `/tmp`） | OHOS `/tmp` 不可执行（EPERM），实测 126 | `scripts/resolve.mjs` |

## 追加格式

```text
| D-0xx | YYYY-MM-DD | 决定（一句话） | 为什么 / 放弃了什么 | 影响文件 / docs 链接 |
```
