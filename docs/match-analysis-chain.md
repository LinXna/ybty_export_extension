# 雷速 match_analysis 解密与解析链

## 已确认的真实链路

```text
/v1/web/match/football/match_analysis?match_id=<match_id>
→ response.code
→ keyIndex = code - 100
→ rot2(data, keyIndex)
→ roott
→ pushmsg22
→ Base64 解码
→ GZIP 解压
→ UTF-8
→ JSON.parse
```

`code` 在 100–126 时使用上述分支。`keyIndex` 是前端位移参数，不是 AES 密钥。

## 已排除的错误路径

- 不把 `soring` 当作 `match_analysis` 解密入口；
- 不直接把响应 Base64 当 AES 密文；
- 不把 `keyIndex` 当 AES key；
- 不以空的 crypto trace 或 soring trace 判定解密失败；
- 不把 DOM/Vue 读取称为接口迁移完成。

## 解析结果

解密 JSON 中已确认存在：

```text
cur_match
history
distribution_data
table
teams
match_events
match_list
```

正式映射包括近期战绩、联赛积分、进球分布和走势。失球分布暂不进入正式业务字段。完整原始解析结果不进入正式接口文件，只由详情页诊断导出保留。

## 参考材料

```text
docs\leisu-reference\verified-materials\verified_match_analysis_code106_decrypted.json
docs\leisu-reference\frontend-sources\layout-after.js
docs\leisu-reference\frontend-sources\recent-rank.js
docs\leisu-reference\frontend-sources\league.js
docs\leisu-reference\frontend-sources\distribution.js
docs\leisu-reference\frontend-sources\trend.js
```

参考材料目录的用途与更新规则见 `docs/leisu-reference/README.md`；正式输出结构见 `docs/leisu-interface-export-schema.md`。

## 代码边界

`background.js` 负责接口采集、解密与结构整理；`leisu_content.js` 负责列表页批量调度和正式字段组装。早期 `leisu_interface_migration.js` 已归档到 `docs/leisu-reference/legacy-tools/`，仅供参考，不参与扩展运行。旧版滚球导出逻辑不得修改。

## 相邻详情数据链

```text
match_lineup → code/keyIndex → rot2 → JSON → formal.lineup

GET detail-{match_id} HTML
→ #weatherArea[src] 内嵌加密业务载荷
→ splitimg → $.rot(..., 1) → JSON.parse
→ match_detail.tlive → formal.live_match.text_live
→ match_odds / top_data.match_odds → formal.odds
```

首屏赔率和文字直播不是独立 XHR/fetch 接口，也不是从页面展示文本反向解析；它们由详情页 HTML 响应携带。当前入口读取 `#weatherArea[src]`，所以只能表述为“不依赖可视 DOM”，不能表述为“整个采集生命周期零 DOM”。
