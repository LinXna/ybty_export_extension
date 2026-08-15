# YBTY / 雷速数据导出扩展

## 当前目标

扩展同时保留两条相互隔离的链路：

- **导出滚球分析数据**：旧版生产链，仍是 DOM/接口混合采集，已冻结，不得被接口迁移改动。
- **滚球接口获取导出**：列表页批量采集雷速接口及详情页内嵌业务载荷，输出稳定的 `results[].formal` 数据，供预测系统使用。

诊断数据与正式数据分开：正常导入使用“滚球接口获取导出”；排错时才使用“滚球接口诊断导出（正式+证据）”。

## 按钮和真实执行流程

### 导出滚球分析数据

旧版入口，调用原有 `exportLive()`、`collectLive(true, true)` 及旧版详情采集逻辑。该链路不属于本轮接口迁移范围。

### 滚球接口获取导出

在雷速列表页点击，一次处理列表中的比赛，不要求手工逐场打开详情页：

```text
列表页取得比赛 ID
→ collectStatisticsApi() 捕获 /api/v3/f/d、/f/s、/f/vd
→ collectDetailApi() 自动打开后台详情标签
→ 触发并捕获 match_analysis、match_lineup
→ 解码详情 HTML 内嵌 #weatherArea[src] 业务载荷
→ 提取 match_detail.tlive 和 match_odds
→ 后台按雷速前端规则解码
→ 删除 logo 和诊断内容
→ 生成 results[].formal
```

### 滚球接口诊断导出（正式+证据）

采集过程与正式接口导出完全相同，但每场额外包含 `results[].evidence`。只用于定位前端改版、接口缺失或字段映射问题，不作为预测系统输入。

### 诊断：完整采集当前详情页

只在当前 `live.leisu.com/detail-{match_id}` 页面使用。它会刷新当前详情页并调用 `chrome.debugger`，保存网络原始响应、运行时快照和 crypto trace。该工具不参与列表页批量导出，也不生成正式预测字段。

## 数据来源边界

- `/api/v3/f/d`：静态比赛资料，protobuf。
- `/api/v3/f/vd`：实时比分与统计，protobuf。
- `/api/v3/f/s`：补充比赛统计，protobuf；未确认 code 只留原始值。
- `match_analysis`：近期战绩、交锋、联赛积分、进球分布、走势。
- `match_lineup`：阵容、教练、场地、裁判及球员信息。
- `GET /detail-{match_id}` 的 HTML 内嵌载荷：首屏文字直播快照 `match_detail.tlive` 和赔率 `match_odds`。

赔率和首屏文字直播不读取页面显示文本、赔率表格或 Vue 状态，但其载荷入口是详情 HTML 中 `#weatherArea[src]` 属性，因此应描述为“解析服务端返回的 HTML 内嵌数据”，不能描述为独立 XHR 接口。

## 已确认解码链

```text
match_analysis / match_lineup:
code 100–126 → keyIndex = code - 100 → rot2 → roott → pushmsg22
→ Base64 → GZIP → UTF-8 → JSON.parse

/api/v3/f/d  → ApiResult → Detail
/api/v3/f/vd → ApiResult → LiveData
/api/v3/f/s  → ApiResult → InGameStats

详情 HTML 内嵌载荷:
#weatherArea[src] → splitimg → $.rot(..., 1) → JSON.parse
```

`keyIndex` 是凯撒位移参数，不是 AES 密钥；`soring` 不是 `match_analysis` 的解密入口。完整依据见 [match-analysis-chain.md](docs/match-analysis-chain.md)。

## 项目目录

```text
background.js                       后台标签管理、响应捕获、protobuf/接口解码
leisu_content.js                    雷速列表页按钮、批量调度和正式结构组装
leisu_detail_network.js             详情页网络响应捕获
leisu_detail_bridge.js              详情页触发及诊断桥接
leisu_*_bridge.js / *_network.js    manifest 明确加载的页面桥接脚本
content.js                          YBTY 页面入口
tools/                              离线验证与扁平化工具
docs/leisu-reference/api-docs/      雷速接口字段参考
docs/leisu-reference/frontend-sources/ 已筛选的雷速前端包
docs/leisu-reference/verified-materials/ 固定回归样本
docs/leisu-reference/legacy-tools/  已退出运行链、但有参考价值的历史代码
导出结果/                          本机验证输出；被 Git 忽略
```

目录审计和保留理由见 [project-structure.md](docs/project-structure.md)。预测系统应按 [leisu-interface-export-schema.md](docs/leisu-interface-export-schema.md) 导入。

## 文档索引

- [接口迁移状态快照](INTERFACE_MIGRATION_SNAPSHOT.md)
- [接口正式导出数据结构](docs/leisu-interface-export-schema.md)
- [项目结构与清理规则](docs/project-structure.md)
- [match_analysis 解密链](docs/match-analysis-chain.md)
- [固定参考材料索引](docs/leisu-reference/README.md)

## 约束

- 不修改旧版滚球导出链。
- 不根据字段名或单场数值猜测含义。
- 未经前端源码、接口文档或页面值验证的统计 code 不进入中文正式字段。
- 所有 logo 均不导出。
- 正式文件不携带 Base64、完整 HTML、DOM 快照或重复解密结果。
- 缺失值保持 `null` 或空数组，不能改成 0。
- `node_modules/`、`导出结果/`、HAR 和 TSV 验证文件不纳入 Git。
