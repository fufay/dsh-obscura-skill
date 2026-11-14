#!/bin/sh
# build-obscura-ohos.sh — 为 HarmonyOS PC（aarch64 / OHOS musl）构建 Obscura（render-only）并打包商品资产
#
# 产出：_build/assets/obscura-aarch64-ohos.tar.gz（含 obscura + obscura-worker，已自签）
#       把脚本末尾打印的 size/sha256 填进 skill/dsh-obscura/assets/manifest.json 的 openharmony 条目。
#
# 用法：
#   sh tools/build-obscura-ohos.sh [options]
#
#   默认：联网（走按需代理）→ 准备源码/归档/垫片 → cargo build → 自签 → smoke → 打包
#
# options:
#   --no-proxy     不经过 with-proxy.sh（依赖已缓存/能直连 crates.io 时用）
#   --strip        构建后 strip 二进制（118MB → 更小；先 strip 再签）
#   --no-sign      只构建，不签名（产物无法在本机执行）
#   --no-smoke     跳过 smoke（--version/JS/截图）
#   --no-package   不打包 tar.gz（只构建/签名）
#   --smoke-net    额外跑一条联网 smoke（https://www.baidu.com）
#   -h, --help     显示帮助
#
# 环境变量（一般不用改）：
#   OBSCURA_SRC     源码目录，默认 <项目>/_refer/github-obscura-v0.2.7
#   OHOS_SELFSIGN   ohos-selfsign 路径，默认 <工作区>/Skills/2026-10-28-ohos-native-tool/_build/ohos-selfsign
#
# 设计：幂等。缺什么补什么；归档按 sha256 校验；重复运行只增量编译。
# 依据：Eva-Research/2026-11-14-obscura-musl移植评估/docs/11-实证记录-链接与运行.md（E3/E4）。
# 改动构建链请同步更新该文档与 AGENTS.md §三。

set -eu

PROJ=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WS=$(CDPATH= cd -- "$PROJ/../.." && pwd)
BREW=/storage/Users/currentUser/.harmonybrew/bin
P="$PROJ"
SELF="$PROJ/tools/build-obscura-ohos.sh"

# ---- 固定输入（与 docs/02 一致；升级 V8 时必须成对替换）----------------------
V8_TAG=v150.4.0
V8_FILE=librusty_v8_simdutf_release_aarch64-unknown-linux-musl.a
V8_URL="https://github.com/denoland/rusty_v8/releases/download/$V8_TAG/$V8_FILE.gz"
V8_SHA=1cfbd44349e2fe35c2add74ead0dc2193c7f2ac44a206ddb1d5d3dcc76e51d3c
BIND_FILE=src_binding_simdutf_release_aarch64-unknown-linux-musl.rs
BIND_URL="https://github.com/denoland/rusty_v8/releases/download/$V8_TAG/$BIND_FILE"
BIND_SHA=7727826ae479bdb645e807239fb12d1f8e2e23de7a6cf16f5ee592690d1d8506
REPO_URL=https://github.com/h4ckf0r0day/obscura.git
REPO_TAG=v0.2.7
REPO_COMMIT=0ecc41770da5c5300227dd83a15bfa1e5100d5d4

SRC=${OBSCURA_SRC:-$PROJ/_refer/github-obscura-v0.2.7}
V8_DIR=$PROJ/_build/v8-musl-aarch64
SHIM_DIR=$PROJ/_build/shim
TARGET_DIR=$PROJ/_build/obscura-target
LOG=$PROJ/_build/obscura-build.log
SMOKE_PNG=$PROJ/_build/evidence/smoke.png
ASSET=$PROJ/_build/assets/obscura-aarch64-ohos.tar.gz
SELFSIGN=${OHOS_SELFSIGN:-$WS/Skills/2026-10-28-ohos-native-tool/_build/ohos-selfsign}
PROXY_SH=$WS/Common/ProxyAgent/scripts/with-proxy.sh

USE_PROXY=1
DO_STRIP=0
DO_SIGN=1
DO_SMOKE=1
SMOKE_NET=0
DO_PACKAGE=1

usage() { sed -n '2,26p' "$SELF" | sed 's/^# \{0,1\}//'; }
die() { echo "ERROR: $*" >&2; exit 1; }
say() { echo "==> $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --no-proxy) USE_PROXY=0 ;;
    --strip) DO_STRIP=1 ;;
    --no-sign) DO_SIGN=0 ;;
    --no-smoke) DO_SMOKE=0 ;;
    --smoke-net) SMOKE_NET=1 ;;
    --no-package) DO_PACKAGE=0 ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（--help 看用法）" ;;
  esac
  shift
done

# ---- 工具函数 ---------------------------------------------------------------
# 走代理执行；USE_PROXY=0 或没有 with-proxy.sh 时直接执行。
net() {
  if [ "$USE_PROXY" = 1 ] && [ -x "$PROXY_SH" ]; then
    sh "$PROXY_SH" "$@"
  else
    "$@"
  fi
}

sha_of() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }

need_sha() { # need_sha <file> <sha> <说明>；缺失/不符返回 1（由调用方重新获取）
  [ -f "$1" ] || return 1
  got=$(sha_of "$1")
  if [ "$got" != "$2" ]; then
    echo "    ⚠️  $3 校验不符（期望 $2，实际 $got），重新获取"
    return 1
  fi
  return 0
}

download() { # download <url> <out>
  say "下载 $1"
  curl -fSL --retry 3 --connect-timeout 20 -o "$2.part" "$1"
  mv "$2.part" "$2"
}

# ---- 0. 前置检查 ------------------------------------------------------------
say "项目：$PROJ"
[ -x "$BREW/rustc" ] || die "找不到 rustc：$BREW/rustc"
command -v cargo >/dev/null 2>&1 || export PATH=$BREW:$PATH
command -v cargo >/dev/null 2>&1 || die "找不到 cargo（应在 $BREW）"
command -v cc >/dev/null 2>&1 || die "找不到 C 编译器 cc"
echo "    rustc: $($BREW/rustc --version)"
echo "    cargo: $(cargo --version)"
[ "$USE_PROXY" = 1 ] && echo "    网络：经 with-proxy.sh" || echo "    网络：直连（--no-proxy）"

# ---- 1. 源码 ----------------------------------------------------------------
if [ -d "$SRC/.git" ]; then
  head=$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)
  if [ "$head" != "$REPO_COMMIT" ]; then
    echo "    ⚠️  $SRC HEAD=$head，期望 $REPO_COMMIT（继续构建该目录）"
  else
    echo "    源码：$SRC @ $head"
  fi
else
  say "克隆 Obscura $REPO_TAG → $SRC"
  mkdir -p "$(dirname "$SRC")"
  net git clone "$REPO_URL" "$SRC"
  git -C "$SRC" checkout --quiet "$REPO_COMMIT" 2>/dev/null || \
    git -C "$SRC" checkout --quiet "$REPO_TAG"
  head=$(git -C "$SRC" rev-parse HEAD)
  [ "$head" = "$REPO_COMMIT" ] || echo "    ⚠️  clone 到 $head（与 $REPO_COMMIT 不同）"
fi
git config --global --add safe.directory "$SRC" >/dev/null 2>&1 || true
[ -f "$SRC/Cargo.lock" ] || die "源码目录不完整（缺 Cargo.lock）：$SRC"

# ---- 2. V8 归档 + 绑定 + __clear_cache 垫片 ---------------------------------
mkdir -p "$V8_DIR" "$SHIM_DIR" "$PROJ/_build/evidence"

if ! need_sha "$V8_DIR/$V8_FILE" "$V8_SHA" "V8 归档"; then
  [ -f "$V8_DIR/$V8_FILE" ] && echo "    V8 归档不存在或校验失败，重新下载…"
  download "$V8_URL" "$V8_DIR/$V8_FILE.gz"
  gzip -dc "$V8_DIR/$V8_FILE.gz" > "$V8_DIR/$V8_FILE.part"
  mv "$V8_DIR/$V8_FILE.part" "$V8_DIR/$V8_FILE"
  rm -f "$V8_DIR/$V8_FILE.gz"
  need_sha "$V8_DIR/$V8_FILE" "$V8_SHA" "V8 归档" || die "V8 归档解压后校验失败"
fi
echo "    V8 归档：$V8_DIR/$V8_FILE（sha256 OK）"

if ! need_sha "$V8_DIR/$BIND_FILE" "$BIND_SHA" "V8 绑定"; then
  download "$BIND_URL" "$V8_DIR/$BIND_FILE"
  need_sha "$V8_DIR/$BIND_FILE" "$BIND_SHA" "V8 绑定" || die "V8 绑定校验失败"
fi
echo "    V8 绑定：$V8_DIR/$BIND_FILE（sha256 OK）"

# OHOS target 的 rustc 不带 __clear_cache（V8 的 FlushICache 需要）。
say "编译 __clear_cache 垫片"
$BREW/rustc --edition 2021 --crate-type=lib --emit=obj -O \
  "$SHIM_DIR/clear_cache.rs" -o "$SHIM_DIR/clear_cache.o"
[ -s "$SHIM_DIR/clear_cache.o" ] || die "垫片编译失败：$SHIM_DIR/clear_cache.o"

# ---- 3. 构建 ----------------------------------------------------------------
say "开始构建（render-only）"
export PATH=$BREW:$PATH
export CARGO_TARGET_DIR=$TARGET_DIR
export RUSTFLAGS="-C link-arg=$SHIM_DIR/clear_cache.o"
export RUSTY_V8_ARCHIVE=$V8_DIR/$V8_FILE
export RUSTY_V8_SRC_BINDING_PATH=$V8_DIR/$BIND_FILE

mkdir -p "$(dirname "$LOG")"
start=$(date +%s)
if ( cd "$SRC" && net cargo build --release -p obscura-cli --bins --features render >"$LOG" 2>&1 ); then
  :
else
  echo "---- 构建失败，日志末尾 ----" >&2
  tail -n 40 "$LOG" >&2
  die "cargo build 失败（完整日志：$LOG）"
fi
end=$(date +%s)
echo "    完成，用时 $((end - start))s（日志：$LOG）"

BIN_DIR=$TARGET_DIR/release
[ -x "$BIN_DIR/obscura" ] || die "未找到产物：$BIN_DIR/obscura"

# ---- 4. strip（可选）--------------------------------------------------------
if [ "$DO_STRIP" = 1 ]; then
  say "strip 二进制"
  STRIP=$BREW/llvm-strip
  [ -x "$STRIP" ] || STRIP=strip
  for b in obscura obscura-worker; do
    [ -f "$BIN_DIR/$b" ] || continue
    before=$(wc -c < "$BIN_DIR/$b")
    "$STRIP" --strip-all "$BIN_DIR/$b"
    after=$(wc -c < "$BIN_DIR/$b")
    echo "    $b: $before → $after bytes"
  done
fi

# ---- 5. 签名 ----------------------------------------------------------------
if [ "$DO_SIGN" = 1 ]; then
  [ -x "$SELFSIGN" ] || die "找不到 ohos-selfsign：$SELFSIGN（用 OHOS_SELFSIGN=… 指定，或 --no-sign）"
  say "自签"
  for b in obscura obscura-worker; do
    [ -f "$BIN_DIR/$b" ] || continue
    "$SELFSIGN" sign "$BIN_DIR/$b" "$BIN_DIR/$b.signed" >/dev/null
    "$SELFSIGN" verify "$BIN_DIR/$b.signed" | grep -q 'signature_match=yes' || \
      die "$b 签名校验失败"
    echo "    $b.signed（verify OK）"
  done
  RUN_BIN=$BIN_DIR/obscura.signed
else
  echo "    （--no-sign：产物为未签名 ELF，本机不可执行）"
  RUN_BIN=$BIN_DIR/obscura
fi

# ---- 6. smoke ---------------------------------------------------------------
if [ "$DO_SMOKE" = 1 ] && [ "$DO_SIGN" = 1 ]; then
  say "smoke（离线，data: URL）"
  v=$(timeout 60 "$RUN_BIN" --version 2>&1 | tail -1)
  echo "    --version → $v"
  out=$(timeout 60 "$RUN_BIN" fetch \
    "data:text/html,<title>SMOKE</title><h1 id=h>x</h1><script>document.getElementById('h').textContent='JS OK'</script>" \
    --eval "document.title + '|' + document.getElementById('h').textContent" 2>&1 | tail -1)
  [ "$out" = "SMOKE|JS OK" ] || die "smoke 失败：期望 'SMOKE|JS OK'，实际 '$out'"
  echo "    JS/DOM → $out"
  timeout 60 "$RUN_BIN" fetch "data:text/html,<h1>smoke</h1>" --screenshot "$SMOKE_PNG" >/dev/null 2>&1 || \
    die "截图 smoke 失败"
  [ -s "$SMOKE_PNG" ] || die "截图 smoke 无产物：$SMOKE_PNG"
  echo "    截图 → $SMOKE_PNG（$(wc -c < "$SMOKE_PNG") bytes）"
  if [ "$SMOKE_NET" = 1 ]; then
    say "smoke（联网）"
    timeout 90 "$RUN_BIN" fetch https://www.baidu.com --eval "document.title" 2>&1 | tail -2
  fi
fi

# ---- 7. 打包资产（供 skill 下载）------------------------------------------
if [ "$DO_PACKAGE" = 1 ]; then
  say "打包 OHOS 资产"
  PKG=$PROJ/_build/assets/pkg
  rm -rf "$PKG"; mkdir -p "$PKG"
  cp "$BIN_DIR/obscura.signed" "$PKG/obscura"
  if [ -f "$BIN_DIR/obscura-worker.signed" ]; then cp "$BIN_DIR/obscura-worker.signed" "$PKG/obscura-worker"; fi
  chmod 755 "$PKG"/*
  mkdir -p "$(dirname "$ASSET")"
  tar -czf "$ASSET" -C "$PKG" obscura obscura-worker
  SIZE=$(wc -c < "$ASSET")
  SHA=$(sha_of "$ASSET")
  echo "    资产：$ASSET"
  echo "    size=$SIZE"
  echo "    sha256=$SHA"
  echo "    → 填进 skill/dsh-obscura/assets/manifest.json 的 openharmony 条目（size/sha256）"
fi

# ---- 汇总 ------------------------------------------------------------------
say "完成"
for f in "$BIN_DIR/obscura" "$BIN_DIR/obscura.signed" "$BIN_DIR/obscura-worker" "$BIN_DIR/obscura-worker.signed"; do
  [ -f "$f" ] && printf '    %-12s %10s bytes  sha256=%s\n' "$(basename "$f")" "$(wc -c < "$f")" "$(sha_of "$f")"
done
echo "    产物目录：$BIN_DIR"
echo "    下一步：$RUN_BIN serve --port 9222 --font-dir /system/fonts   （CJK 需要 --font-dir）"
