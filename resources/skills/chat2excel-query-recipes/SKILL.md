---
name: chat2excel-query-recipes
description: DuckDB 只读查询配方。写 SQL 前读取：时间聚合、同比环比、Top N、占比、去重计数、分位数、条件透视、空值与字符串清洗，以及 Chat2Excel 的 SQL 安全限制。
version: 1.0.0
author: Chat2Excel
---

# DuckDB 查询配方

面向 Chat2Excel 的 `query_database`。所有示例使用占位符 `<table>`、`<date_col>`、`<amount_col>`、`<category_col>`，实际执行时替换为 `describe_table` 返回的真实列名。

## 硬性限制

- 只能是**单条 SELECT**，不能有分号，不能有 DDL/DML（CREATE、INSERT、DROP、COPY、ATTACH、PRAGMA、SET）。
- 不能读取文件或网络：禁止 `read_csv`、`read_parquet`、`read_json`、`httpfs`、`glob`、`query` 等。
- 只能引用当前对话上下文中的表。物理表名必须加双引号，例如 `"sales_20240101_ab12"`。
- 结果默认上限 2000 行，预览 50 行。需要完整结论时先聚合，不要依赖明细。
- 标识符里有空格、中文或保留字时一律用双引号：`"订单 金额"`。

## 先看结构

写 SQL 前确认：

- 日期列是 `DATE` 还是 `TIMESTAMP`，还是被推断成 `VARCHAR`。
- 金额列是 `BIGINT` / `DOUBLE` 还是文本（含货币符号或千分位）。
- 分类列的真实取值（“华东” vs “华东区” vs “East”）。
- 空值比例和唯一值数量。

## 时间聚合

按月份：

```sql
SELECT date_trunc('month', "<date_col>") AS month,
       SUM("<amount_col>") AS total
FROM "<table>"
WHERE "<date_col>" >= DATE '2024-01-01'
  AND "<date_col>" <  DATE '2025-01-01'
GROUP BY 1
ORDER BY 1;
```

按天/周/季度/年：把 `'month'` 换成 `'day'`、`'week'`、`'quarter'`、`'year'`。

格式化标签：

```sql
SELECT strftime("<date_col>", '%Y-%m') AS month, SUM("<amount_col>") AS total
FROM "<table>"
GROUP BY 1
ORDER BY 1;
```

日期列是文本时，先转换：

```sql
SELECT strptime("<date_col>", '%Y/%m/%d') AS dt
FROM "<table>"
LIMIT 5;
```

确认格式后再聚合；格式不确定时不要批量转换，先抽样。

## 同比 / 环比

月度同比（同月对比）：

```sql
WITH monthly AS (
  SELECT date_trunc('month', "<date_col>") AS month,
         SUM("<amount_col>") AS total
  FROM "<table>"
  GROUP BY 1
)
SELECT month,
       total,
       LAG(total, 12) OVER (ORDER BY month) AS total_last_year,
       ROUND(
         100.0 * (total - LAG(total, 12) OVER (ORDER BY month))
         / NULLIF(LAG(total, 12) OVER (ORDER BY month), 0),
         1
       ) AS yoy_pct
FROM monthly
ORDER BY month;
```

环比把 `LAG(total, 12)` 改为 `LAG(total, 1)`。分母为 0 时用 `NULLIF`，不要让查询报错或产生无穷大。

## Top N 与“其他”

```sql
SELECT "<category_col>" AS category,
       SUM("<amount_col>") AS total
FROM "<table>"
GROUP BY 1
ORDER BY total DESC
LIMIT 10;
```

需要“Top 5 + 其他合计”：

```sql
WITH ranked AS (
  SELECT "<category_col>" AS category,
         SUM("<amount_col>") AS total,
         ROW_NUMBER() OVER (ORDER BY SUM("<amount_col>") DESC) AS rn
  FROM "<table>"
  GROUP BY 1
)
SELECT CASE WHEN rn <= 5 THEN category ELSE '其他' END AS category,
       SUM(total) AS total
FROM ranked
GROUP BY 1
ORDER BY total DESC;
```

类别数超过 12 个时默认 Top 10，并说明其余合计，不要画 40 根柱子。

## 占比

```sql
WITH grouped AS (
  SELECT "<category_col>" AS category,
         SUM("<amount_col>") AS total
  FROM "<table>"
  GROUP BY 1
)
SELECT category,
       total,
       ROUND(100.0 * total / NULLIF(SUM(total) OVER (), 0), 1) AS share_pct
FROM grouped
ORDER BY total DESC;
```

- 分子分母必须同一口径、同一筛选。
- `share_pct` 合计不一定是 100：空值、重复、多选标签都可能导致偏差，要在回答里说明。
- 需要排除空值时用 `WHERE "<category_col>" IS NOT NULL`，并说明排除了多少行。

## 去重计数与行数

```sql
SELECT COUNT(*) AS row_count,
       COUNT(DISTINCT "<id_col>") AS unique_ids
FROM "<table>";
```

订单数、客户数、商品数通常要去重；不要默认 `COUNT(*)` 等于业务单量。检查重复：

```sql
SELECT "<id_col>", COUNT(*) AS n
FROM "<table>"
GROUP BY 1
HAVING COUNT(*) > 1
ORDER BY n DESC
LIMIT 20;
```

## 分位数与分布

```sql
SELECT quantile_cont("<amount_col>", 0.5) AS median,
       quantile_cont("<amount_col>", 0.9) AS p90,
       AVG("<amount_col>") AS mean
FROM "<table>";
```

平均值受极端值影响大时，同时给中位数。需要分桶：

```sql
SELECT FLOOR("<amount_col>" / 100) * 100 AS bucket_start,
       COUNT(*) AS n
FROM "<table>"
GROUP BY 1
ORDER BY 1;
```

## 条件透视

```sql
SELECT "<category_col>" AS category,
       SUM(CASE WHEN "<status_col>" = '已完成' THEN "<amount_col>" ELSE 0 END) AS completed,
       SUM(CASE WHEN "<status_col>" = '已退款' THEN "<amount_col>" ELSE 0 END) AS refunded
FROM "<table>"
GROUP BY 1
ORDER BY completed DESC;
```

先 `describe_table` 确认真实状态值，不要凭中文习惯猜“已完成”。

## 空值与字符串清洗

```sql
SELECT COALESCE("<category_col>", '未知') AS category,
       COUNT(*) AS n
FROM "<table>"
GROUP BY 1
ORDER BY n DESC;
```

```sql
SELECT TRIM(LOWER("<category_col>")) AS normalized, COUNT(*) AS n
FROM "<table>"
GROUP BY 1
ORDER BY n DESC;
```

分组前先抽样看值是否统一（大小写、前后空格、全半角）。如果清洗会合并不同业务含义的值，先向用户说明。

## 明细查询

用户明确要看明细时：

```sql
SELECT "<col1>", "<col2>", "<date_col>", "<amount_col>"
FROM "<table>"
WHERE "<date_col>" >= DATE '2024-01-01'
ORDER BY "<date_col>" DESC
LIMIT 100;
```

只选需要的列，务必带 `LIMIT`。结果超过 50 行时，先看预览，再用 `read_query_page` 翻页；不要把整表塞进上下文。

## 出错时

- `column not found`：回到 `describe_table`，核对大小写和引号。
- `table not found`：用 `list_tables` 确认物理表名，不要使用显示名。
- 类型错误：用 `TRY_CAST(col AS DATE)` / `TRY_CAST(col AS DOUBLE)` 先抽样，再决定是否整列转换。
- 查询超时：缩小时间范围、先按粗粒度聚合、避免无谓的笛卡尔连接。
