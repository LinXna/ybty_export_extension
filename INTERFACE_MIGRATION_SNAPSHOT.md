# 接口迁移状态快照

更新时间：2026-08-15

## 目标与边界

“滚球接口获取导出”最终独立输出雷速正式数据，不再以兼容旧滚球字段为目标。旧版“导出滚球分析数据”继续保留并冻结；接口链开发不得修改它。

## 当前已完成

- 列表页批量调度，不要求用户逐场打开详情页。
- `/api/v3/f/d`、`/f/vd`、`/f/s` protobuf 捕获与解码。
- `match_analysis` 的 `code - 100 → rot2 → Base64 → GZIP → UTF-8 → JSON` 解码。
- 近期战绩、历史交锋、联赛积分、进球分布、让球/大小球走势正式映射。
- `match_lineup` 解密和阵容正式映射。
- 详情 HTML 内嵌首屏载荷解码，取得 `match_detail.tlive` 与 `match_odds`；不再读取可视文字直播 DOM、赔率表格或 Vue 状态。
- 正式与诊断两种导出：正式只含 `formal`，诊断额外含 `evidence`。
- logo 全面移除；失球分布和未确认统计 code 不进入正式中文字段。
- 永久参考材料、离线工具、临时验证文件已分目录管理。

## 正式数据模块

```text
static_match            比赛、球队、赛事、开赛时间、天气
live_match              状态、比分、半场、牌、角球、统计、首屏文字直播
opening_odds / odds     让球、胜负、总进球、角球的初始/赛前/即时赔率
analysis_match_context  match_analysis 当前比赛上下文（非实时）
head_to_head            历史交锋
recent_matches          双方隔离的近期战绩
league_standings        双方总/主/客联赛积分
goal_distribution       双方总/主/客进球与首次进球分布
trend_summary           让球和大小球走势
lineup                  场地、裁判、教练、阵型、球员、伤停、事件
future_schedule         未来赛程（上游可选）
```

字段类型和导入规则以 [滚球接口导出数据结构](docs/leisu-interface-export-schema.md) 为准。

## 当前限制

- `text_live` 是详情 HTML 首屏返回时的文字事件快照，不等同于持续长连接的最终事件流。
- 赔率和文字直播虽然不依赖可视 DOM，但其载荷入口仍是 HTML 的 `#weatherArea[src]`。
- 无阵容、无某类盘口、无进球分布均可能是合法空值；不能补 0。
- 统计 code 7、8、27、32、37 及其他未确认 code 只保留原始证据，不写成正式中文字段。
- 仍需用更多比赛持续回归合法空值、不同赛事和不同比赛状态。

## 固定规则

- 不猜测字段含义。
- 不用比分、角球等无关字段交叉证明射门或赔率。
- 联赛积分保留接口的总/主/客三行和原始积分，不重新计算。
- 页面射门总数是正式射正与射偏之和；code 21 为射正、22 为射偏。
- 诊断证据不得混入预测系统默认输入。
- 旧滚球链保持不动。

## 文档

- 主操作说明：[README.md](README.md)
- 正式导出契约：[docs/leisu-interface-export-schema.md](docs/leisu-interface-export-schema.md)
- 项目结构：[docs/project-structure.md](docs/project-structure.md)
- 解密链：[docs/match-analysis-chain.md](docs/match-analysis-chain.md)
- 固定材料：[docs/leisu-reference/README.md](docs/leisu-reference/README.md)
