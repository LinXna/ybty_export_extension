# 滚球接口导出数据结构

本文档是预测系统导入 `leisu_v2.8.0_interface_data_*.json` 的正式契约。诊断文件中的 `evidence` 不属于预测字段。

## 顶层结构

```json
{
  "export_version": "2.8.0-interface",
  "export_type": "leisu_interface_data",
  "captured_at": "ISO-8601 时间",
  "results": []
}
```

`results` 每项代表一场比赛：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `match_id` | string | 雷速比赛 ID；导入时建议始终按字符串处理 |
| `available` | boolean | 静态比赛、实时比赛和 `match_analysis` 三个核心来源是否可用 |
| `complete` | boolean | `completeness` 中所有模块是否都有数据；`false` 不等于整场无效 |
| `completeness` | object | 各模块采集状态 |
| `formal` | object | 唯一供预测系统消费的正式数据层 |

`completeness` 当前包含：`static_match`、`live_match`、`match_analysis`、`text_live`、`odds`、`recent_matches`、`league_standings`、`goal_distribution`、`trend_summary`、`lineup`。某模块为 `false` 时只跳过该模块，不应丢弃其他已经取得的数据。

## `formal.static_match`：比赛静态资料

来源：`/api/v3/f/d`。

| 路径 | 类型 | 含义 |
| --- | --- | --- |
| `id` | number | 比赛 ID |
| `matchTime` | number | 开赛时间，Unix 秒 |
| `homeTeam.id/name/shortName/rank` | number/string | 主队 ID、名称、简称、页面排名文字 |
| `awayTeam.id/name/shortName/rank` | number/string | 客队 ID、名称、简称、页面排名文字 |
| `competition.id/name/type/shortName` | number/string | 赛事信息 |
| `environment.weather` | string | 天气文字 |
| `environment.pressure` | string | 气压原值 |
| `environment.temperature` | string | 温度原值 |
| `environment.wind` | string | 风力/风向原值 |
| `environment.humidity` | string | 湿度原值 |
| `environment.weatherId` | number | 雷速天气枚举 ID |

所有 logo、球衣图片均已移除。

## `formal.live_match`：比分、状态、统计和文字直播

比分与统计来源：`/api/v3/f/vd`。文字直播来源：详情 HTML 内嵌载荷 `match_detail.tlive`。

### 基础状态

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `source` | string | 当前固定为 `/api/v3/f/vd` |
| `statistics_source` | string | 技术统计来源 |
| `match_id` | number/null | 比赛 ID |
| `status_id` | number/null | 雷速比赛状态枚举 |
| `home_scores` / `away_scores` | object | 主客队比分对象 |

比分对象字段：

- `score`：当前/完场比分。
- `halfScore`：半场比分。
- `redCard`、`yellowCard`、`corner`：红牌、黄牌、角球。
- `overTime`：加时赛比分；无数据为 `null`。
- `penalty`：点球大战比分；无数据为 `null`。

### `confirmed_statistics`

每项结构均为 `{ "home": number, "away": number }`，缺失时为 `null`：

| 字段 | 中文 |
| --- | --- |
| `corners` | 角球 |
| `yellow_cards` | 黄牌 |
| `red_cards` | 红牌 |
| `attacks` | 进攻 |
| `dangerous_attacks` | 危险进攻 |
| `possession` | 控球率，保留接口数值 |
| `shots_on_target` | 射正，已确认 code 21 |
| `shots_off_target` | 射偏，已确认 code 22 |

页面“射门”总数可由 `shots_on_target + shots_off_target` 计算。未确认的统计 code 不会冒充正式中文字段。

### `text_live`

数组元素：`main`、`type`、`position`、`time`、`data`。其中 `data` 是事件文字，`time` 是页面事件时间；`position` 为 0 中立、1 主队、2 客队。`type` 保留雷速事件类型码，未建立可靠枚举时不得自行解释。

这是一份详情页首屏返回时的事件快照，不保证等同于持续长连接的最终完整事件流。

## `formal.odds` 与 `formal.opening_odds`

来源：详情 HTML 内嵌 `match_odds`，筛选雷速公司 `cid=2`，兼容 `type=2`。不是可视 DOM 表格。

`odds` 为完整结构：

```json
{
  "source": "payload:initial-detail.match_odds",
  "company_id": 2,
  "company_name": "雷速",
  "phase_mapping": { "initial": "f", "pregame": "n[0]", "live": "r[0]" },
  "markets": {
    "asian_handicap": { "initial": null, "pregame": null, "live": null },
    "match_winner": { "initial": null, "pregame": null, "live": null },
    "total_goals": { "initial": null, "pregame": null, "live": null },
    "corners": { "initial": null, "pregame": null, "live": null }
  }
}
```

四类市场及单阶段字段：

| 市场 | 单阶段字段 |
| --- | --- |
| `asian_handicap` 让球 | `home`、`line`、`away` |
| `match_winner` 胜负 | `home`、`draw`、`away` |
| `total_goals` 总进球 | `over`、`line`、`under` |
| `corners` 角球 | `over`、`line`、`under` |

`opening_odds` 是上述四个市场 `initial` 阶段的便捷投影，并固定为对象。盘口未提供时字段是 `null`，绝不能解释为赔率 0。

## `formal.analysis_match_context`

来源：`match_analysis.cur_match`，不是实时比分来源。`realtime` 固定为 `false`。

`record` 包含 `match_id`、`season_id`、`competition_id`、`status_id`、`match_time`、`neutral`、主客队 ID、`home_scores`、`away_scores`、`opening_odds`、`current_odds`、`home_stats`、`away_stats`。其中数组是雷速原记录的规范化保留值；预测系统优先使用 `static_match`、`live_match` 和正式 `odds`，不要自行猜测数组位置。

## `formal.head_to_head`：历史交锋

数组，元素结构与 `analysis_match_context.record` 相同。用于历史模型时应按 `match_time` 排序，并以元素自身 `home_team_id`、`away_team_id` 判断主客，不能按当前比赛主客队强行套用。

## `formal.recent_matches`：双方近期战绩

```text
recent_matches.home  当前主队自己的近期比赛
recent_matches.away  当前客队自己的近期比赛
```

两组数据相互隔离。每场字段：

| 字段 | 含义 |
| --- | --- |
| `match_id` | 历史比赛 ID |
| `league_id` / `league_name` | 赛事 ID/名称 |
| `match_time` / `match_date` | Unix 秒 / ISO 时间 |
| `home_team_id/name` | 该场历史比赛主队 |
| `away_team_id/name` | 该场历史比赛客队 |
| `halftime_score.home/away` | 半场主客比分 |
| `fulltime_score.home/away` | 全场主客比分 |
| `result` | 从当前被统计球队视角得到的“赢/输/和” |
| `goals` | 该场双方总进球数 |
| `handicap_trend.result/class` | 让球结果；中文值与 `win/loss/draw` |
| `goals_trend.result/class` | 大小球结果；中文值与 `big/small/draw` |

## `formal.league_standings`：联赛积分

包含 `home_team`、`away_team`。每队含 `team_id`、`team_name`、`competition_id`、`competition_name`、`season`，以及 `total`（总）、`home`（主场）、`away`（客场）三行。

每行字段：`title`、`position`（排名）、`total`（比赛场数）、`won`、`loss`、`draw`、`goals`、`goals_against`、`net_goals`、`points`、`win_ratio`。

除 `net_goals` 和展示用 `win_ratio` 外均保留 `match_analysis` 返回值；尤其 `points` 不按胜平负重新计算。

## `formal.goal_distribution`：进球分布

结构为主客双方 `home/away`，每方再分 `all`（全部）、`home`（主场）、`away`（客场）。每个范围包含：

- `matches`：样本场次。
- `scored`：进球时间分布。
- `first_scored`：首次进球时间分布。

分布数组每项为 `[数量, 百分比, 开始分钟, 结束分钟]`，通常有 6 个时间段。失球相关分布不进入正式字段。

## `formal.trend_summary`：让球及大小球走势

包含 `home`、`away` 和规则标记 `rule=leisu_trend_bundle_exact_v1`。每队：

- `table`：总、主、客三行；字段有 `row_title`、`total`、`asia_total`、`win/draw/loss`、`win_ratio`、`bs_total`、`big/small`、`big_ratio/small_ratio`。
- `recent6.asia`：近 6 场让球结果。
- `recent6.bs`：近 6 场大小球结果。

该模块按已归档雷速 `trend.js` 的规则复现，不是普通胜负走势。

## `formal.lineup`：阵容

来源：解密后的 `match_lineup`。接口未给阵容时整个字段为 `null`，不能生成空的假阵容。

顶层字段包括 `source`、`confirmed`、`venue`、`referee`、主客阵型、主客教练、主客球员数组、主客伤停数组、球队身价、平均年龄、坐标和统计可用标记。

球员元素包含：`player_id`、`team_id`、`name`、`status`、`starter`、`captain`、`shirt_number`、`position`、`position_name`、`position_code`、`position_number`、`x/y`、`rating`、`best_player`、`age`、`height`、`market_value`、`market_value_text`、`incidents`。

`incidents` 是球员在该场的结构化事件列表；是否出现取决于上游阵容响应。它不应与 `live_match.text_live` 的文字事件混为一谈。

## `formal.future_schedule`

保留 `match_analysis.future` 的未来赛程结构，可能为 `null`。所有 logo 会递归删除。该部分目前保留上游结构，导入方应做可选字段处理。

## 空值、类型和导入要求

1. `null` 表示上游未提供或该模块不适用，不等于数值 0。
2. 空数组表示已知为列表但没有条目。
3. 时间戳字段均为 Unix 秒；`match_date` 是额外生成的 ISO-8601。
4. 比率既可能是接口数值，也可能是带 `%` 的展示字符串，模型入库前应按字段定义转换。
5. `available=false` 或 `complete=false` 时必须查看 `completeness`，按模块降级导入。
6. 不要导入诊断文件的 `evidence`；其中包含原始响应和重复结构，字段稳定性不作保证。
7. 不要从 `analysis_match_context` 的原始数组二次命名字段；优先使用本文列出的正式结构。

## 诊断导出差异

`leisu_interface_diagnostic_*.json` 与正式文件具有相同 `formal`，但额外包含 `evidence`，用于证明来源和排查采集失败。预测系统可以拒绝 `export_type != leisu_interface_data` 的文件，或明确只读取 `results[].formal`。
