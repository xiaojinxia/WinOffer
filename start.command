#!/bin/bash
# Finder may start this script outside the application folder.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 24.14 或更新的 24.x 版本，再打开此文件。"
  echo "官方下载：https://nodejs.org/en/download/"
  read -r -p "按回车键退出……" _
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major !== 24 || minor < 14) { console.error("当前 Node.js 版本为 " + process.versions.node + "，请安装 24.14 或更新的 24.x 版本。"); process.exit(1); }'; then
  read -r -p "按回车键退出……" _
  exit 1
fi

if [ ! -f node_modules/imapflow/package.json ]; then
  npm ci || exit 1
fi
node server/index.js --open
winoffer_status=$?
if [ "$winoffer_status" -ne 0 ]; then
  read -r -p "启动未完成，请查看上方提示。按回车键退出……" _
fi
exit "$winoffer_status"
