# 项目结构与清理规则

## 审计结论

本次按 manifest 引用、跨文件消息调用、离线工具入口和文档用途审核。根目录运行时脚本均有实际入口，没有删除任何旧滚球或接口导出运行代码。

### 运行时文件：保留在根目录

`manifest.json`、`background.js`、`content.js`、`leisu_content.js`、`leisu_canvas_capture.js`、`leisu_detail_network.js`、`leisu_detail_bridge.js`、`leisu_odds_detail_bridge.js`、`leisu_widget_network.js`、`leisu_widget_bridge.js`。

这些脚本由 manifest 直接加载，或是 service worker 本体。即便某些桥接脚本只服务旧版链路，也不能按“接口导出未使用”删除。

### 离线工具：保留在 `tools/`

- `leisu_har_decode.js`：使用 `protobufjs` 对 HAR 中 `/f/d`、`/f/vd` 等载荷做离线回归。
- `flatten_leisu_export.js`：把嵌套导出展开为逐字段清单，便于人工核对。

因此 `package.json`、`package-lock.json` 和开发依赖 `protobufjs` 保留；`node_modules/` 只在本地安装，不进入 Git。

### 永久参考材料：统一放在 `docs/leisu-reference/`

- `api-docs/`：接口字段文档。
- `frontend-sources/`：从 HAR 筛出的解析相关前端包。
- `verified-materials/`：已经过核对的固定样本。
- `legacy-tools/`：不再运行但能解释历史迁移过程的代码。

### 临时输出：不进入版本库

`导出结果/`、`*.har`、`*.tsv` 由 `.gitignore` 排除。验证通过且具有长期回归价值的材料，必须改用明确文件名复制到 `verified-materials/`，不能直接把整个导出目录提交。

## 本次已删除或归档

- 删除根目录重复的 `match_analysis_code106_decrypted.json`；固定版本位于 `verified-materials/`。
- 删除无 manifest、工具或源码引用的 `protobuf.min.js`；离线工具使用 npm 的 `protobufjs`。
- 删除 `tmp_har_scripts/` 临时拆包目录；仅将解析相关的 7 个雷速前端包归档到 `frontend-sources/`。
- 将根目录接口参数文档迁移到 `api-docs/leisu-api-response-fields.txt`。

## 后续新增文件规则

1. 扩展实际加载的脚本放根目录，并同步 manifest 与 README。
2. 可执行离线脚本放 `tools/`，不得混入运行时。
3. 上游源码和固定样本放 `docs/leisu-reference/`，必须在其 README 建索引。
4. 临时抓包和导出只放 `导出结果/`，验证后按需精选归档。
5. 不保留“改名但不调用”的死代码；有参考价值就移入 `legacy-tools/`，无参考价值直接删除。
