#!/system/bin/sh
# 安装 skill 到 DSH skills 目录。用法: sh tools/install.sh [目标目录]
# 默认 $DSH_HOME/skills（本机即 $HOME/dsh/home/skills）。
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
DEST=${1:-${DSH_HOME:-$HOME/.dsh}/skills}
mkdir -p "$DEST"
rm -rf "$DEST/dsh-obscura"
cp -r "$HERE/skill/dsh-obscura" "$DEST/dsh-obscura"
echo "✅ 已安装到 $DEST/dsh-obscura"
echo "   自检: node $DEST/dsh-obscura/scripts/resolve.mjs --check"
