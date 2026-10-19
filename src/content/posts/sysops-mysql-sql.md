---
title: "MySQL 与 SQL：实施工程师要的不是索引原理，是「把数取对」"
published: 2026-10-19
description: "实施和运维日常用 SQL 做三件事：取数、核对、应急改数。这篇给三类能直接套用的语句模板，加一张面试必答的索引与慢查询清单。"
tags:
  - MySQL
  - SQL
  - 数据核对
  - 实施
category: "学习"
series: "系统实施运维：从入门到上岗"
seriesOrder: 4
draft: false
---

DBA 关心的是「这条 SQL 为什么慢」，实施工程师关心的是「这个数为什么不对」。两者用的知识有交集，但重点完全不同。

实施岗遇到 SQL 的场景几乎只有三类：**按客户要求取数**、**核对两边数据**、**应急修正一条数据**。这篇按这三类给模板。

## 一、取数：先确认口径，再写 SQL

客户说「帮我统计一下上个季度各部门的报销金额」，这句话里至少有三个歧义：

1. 「报销金额」是申请金额、审批金额还是实际付款金额？
2. 「上个季度」按单据创建时间、审批完成时间还是财务记账期间？
3. 「部门」是申请人所属部门，还是成本中心归属部门？

**口径没确认就写的 SQL，返工率接近 100%。** 养成习惯：把这三问在聊天窗口里问清楚，截图存档。

确认之后的模板：

```sql
SELECT
  d.dept_name                        AS 部门,
  DATE_FORMAT(b.submit_time, '%Y-%m') AS 月份,
  COUNT(*)                           AS 单据数,
  SUM(b.amount)                      AS 金额合计
FROM expense_bill b
JOIN sys_dept d ON d.id = b.dept_id
WHERE b.status = 'APPROVED'
  AND b.submit_time >= '2026-07-01'
  AND b.submit_time <  '2026-10-01'    -- 用左闭右开，别用 BETWEEN 配日期
GROUP BY d.dept_name, DATE_FORMAT(b.submit_time, '%Y-%m')
ORDER BY 月份, 金额合计 DESC;
```

几个必须讲清的细节：

- **日期用左闭右开**：`BETWEEN '2026-07-01' AND '2026-09-30'` 会漏掉 9 月 30 日当天带时分秒的数据；
- **`SUM` 遇 NULL 返回 NULL**，外面套 `IFNULL(SUM(...), 0)`；
- **`COUNT(*)` 与 `COUNT(col)` 结果可能不同**，后者不统计 NULL；
- 金额字段如果是 `DECIMAL` 就别在 SQL 里做除法再四舍五入，交给前端或导出后再算，避免精度扯皮。

## 二、核对：四步法

数据对不上是实施岗的日常。固定的四步：

**第一步：对总数。** 两边行数是否一致。

```sql
SELECT COUNT(*), SUM(amount) FROM a;
SELECT COUNT(*), SUM(amount) FROM b;
```

**第二步：找差异。** 用 `LEFT JOIN ... IS NULL` 单向找，别用 `<>` 全表比。

```sql
-- A 有 B 没有
SELECT a.id, a.amount
FROM a LEFT JOIN b ON a.id = b.src_id
WHERE b.src_id IS NULL;

-- 两边金额不一致
SELECT a.id, a.amount AS a_amt, b.amount AS b_amt, b.amount - a.amount AS diff
FROM a JOIN b ON a.id = b.src_id
WHERE a.amount <> b.amount;
```

**第三步：归类差异。** 按原因分组统计，而不是逐条看到天荒地老：

```sql
SELECT
  CASE
    WHEN b.src_id IS NULL      THEN 'B 缺失'
    WHEN a.id IS NULL          THEN 'A 缺失'
    WHEN a.amount <> b.amount  THEN '金额不符'
    ELSE '其他'
  END AS 差异类型,
  COUNT(*) AS 条数,
  SUM(ABS(IFNULL(b.amount,0) - IFNULL(a.amount,0))) AS 差额
FROM a LEFT JOIN b ON a.id = b.src_id
GROUP BY 差异类型;
```

**第四步：给结论。** 报告里只写三件事：差异总数、差异分布、建议动作（补数据 / 调口径 / 改程序）。

> 核对时最容易犯的错：**先在程序里找 bug，而不是先确认口径**。经验是七成的「数据不对」最后确认是统计口径或时间范围不一致。

## 三、应急改数：先 SELECT，再事务，再留痕

生产环境改数据是这个岗位最容易出事的地方。规矩只有四条：

```sql
-- 1. 先查，确认影响行数和内容
SELECT id, status, updated_at FROM expense_bill WHERE id = 12345;

-- 2. 备份到临时表（或至少把原值记下来）
CREATE TABLE _bak_bill_20261019 AS
SELECT * FROM expense_bill WHERE id = 12345;

-- 3. 事务内改，并在事务里再查一次
START TRANSACTION;
UPDATE expense_bill SET status = 'APPROVED' WHERE id = 12345;
SELECT id, status FROM expense_bill WHERE id = 12345;
COMMIT;   -- 不对就 ROLLBACK

-- 4. 记录变更：谁、什么时候、为什么、原值、新值
```

**永远不要写没有 WHERE 的 UPDATE/DELETE。** 也永远不要在生产上直接跑从别处复制来、没改过条件的语句——这是运维事故里的头号死因。

条件反射：`UPDATE`/`DELETE` 之前，把同样的 `WHERE` 放进 `SELECT COUNT(*)` 跑一次。

## 四、索引与慢查询：面试必答清单

实施岗被问索引，一般不会让你讲 B+ 树分裂，而是问这些：

**1. 为什么加了索引还是不生效？**

常见原因：列上做了函数或运算（`WHERE DATE(create_time) = ...`）、隐式类型转换（字符串列传数字）、`LIKE '%xx'` 前导通配、联合索引不满足最左前缀、优化器判断走索引更贵。

**2. 联合索引 (a, b, c) 能命中哪些查询？**

`a`、`a,b`、`a,b,c` 都能用；`b`、`b,c`、`a,c` 用不上（`a,c` 只能用到 `a`）。范围查询之后的列会失效：`WHERE a=1 AND b>2 AND c=3` 里 `c` 用不到索引排序。

**3. 怎么看一条 SQL 慢在哪？**

```sql
EXPLAIN SELECT ...;           -- 看 type、key、rows、Extra
EXPLAIN ANALYZE SELECT ...;   -- 8.0 看真实耗时
SHOW PROCESSLIST;             -- 当前在跑什么
SELECT * FROM sys.statement_analysis ORDER BY avg_latency DESC LIMIT 10;
```

`EXPLAIN` 里最该看的三个字段：`type`（别出现 `ALL` 全表扫）、`key`（用的是不是你以为的索引）、`rows`（预估扫描行数）。

**4. 深分页为什么慢？**

`LIMIT 100000, 20` 要先扫 10 万行再丢掉。改成游标式：

```sql
SELECT * FROM t WHERE id > 100000 ORDER BY id LIMIT 20;
```

**5. 主从延迟怎么发现、怎么缓解？**

```sql
SHOW SLAVE STATUS\G   -- 看 Seconds_Behind_Master
```

缓解：减少大事务、把批量更新拆小、从库并行复制、关键读走主库、监控延迟并做读流量切换。

## 五、备份与恢复：别只背命令

```bash
# 逻辑备份（小库、跨版本迁移）
mysqldump -uroot -p --single-transaction --routines --triggers db > db.sql

# 物理备份（大库、快速恢复，用 XtraBackup）
xtrabackup --backup --target-dir=/backup/full
```

真正要能答的是 **PITR（按时间点恢复）**：全量备份 + binlog，恢复到误删之前的那个时刻。

```bash
# binlog 里定位误操作位置
mysqlbinlog --start-datetime="2026-10-19 10:00:00" --stop-datetime="2026-10-19 10:30:00" mysql-bin.000123 | grep -n "DELETE FROM"
```

**同时必须说的一句：备份没验证过等于没有备份。** 定期做恢复演练，比多做一次备份更重要。

## 六、一张自查清单

- [ ] 交付前跑一遍 `EXPLAIN`，确认没有 `type=ALL` 的大表查询
- [ ] 所有 UPDATE/DELETE 都带主键或索引条件，执行前先 SELECT COUNT
- [ ] 备份任务有成功告警，且每季度做一次恢复演练
- [ ] 慢查询日志开着（`slow_query_log=ON`，`long_query_time=1`）
- [ ] 生产库账号最小权限，导出数据前确认是否含敏感字段

题库里 MySQL 部分有 20 道题，可以直接对着练：[alo_program · 面试题库](https://yulu1235.github.io/alo_program/interview.html)。

下一篇讲中间件：Nginx、Redis、消息队列各自最高频的那两个故障。
