# 雷速前端源码索引

这些文件从 `leisu_console_full.har` 的资源中筛选、改用稳定名称归档，仅用于反推和回归，不被扩展加载。

- `layout-after.js`：全局解码函数及公共运行时，包括 `rot2/roott/pushmsg22` 相关链路。
- `detail.js`：详情页主体、首屏数据和模块加载逻辑。
- `recent-rank.js`：近期战绩与排名展示规则。
- `league.js`：联赛积分表展示与字段取值规则。
- `distribution.js`：进球分布展示规则。
- `trend.js`：让球走势、大小球走势计算规则。
- `statistics.js`：技术统计展示规则。

文件名去除了构建 hash；更新上游文件时应记录采集日期，并重新完成字段回归。
