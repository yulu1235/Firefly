---
title: "监控与排障：从「客户打电话」到「系统先发现」"
published: 2026-10-19
description: "运维做得好不好，一条分界线是：故障是用户先发现还是你发现。这篇讲四层监控各看什么指标、告警怎么配才不吵，以及一套可以照着走的五步排障法。"
tags:
  - 监控
  - Prometheus
  - Zabbix
  - 排障
  - 可观测性
category: "学习"
series: "系统实施运维：从入门到上岗"
seriesOrder: 7
draft: false
---

## 一、四层监控，缺一层就会瞎

| 层 | 看什么 | 典型工具 | 缺了会怎样 |
| --- | --- | --- | --- |
| 基础设施 | CPU、内存、磁盘、网络 | Zabbix、node_exporter | 磁盘满了才知道 |
| 中间件 | 连接数、慢查询、队列积压 | exporter、自带面板 | 服务慢但不知道慢在哪 |
| 应用 | QPS、错误率、响应时间、JVM/GC | SkyWalking、APM | 只知道慢，不知道哪个接口 |
| 业务 | 下单量、支付成功率、对账差异 | 埋点 + 看板 | 系统指标全绿，业务已经出错 |

**最容易被跳过的是业务层。** 系统 CPU 30%、接口全部 200，但「支付成功了没记账」，只有业务监控能发现。实施运维的价值恰恰常在这里。

## 二、指标怎么选：四个黄金信号

Google SRE 的老话：延迟、流量、错误、饱和度。落到具体配置：

```promql
# 错误率（5 分钟窗口）
sum(rate(http_requests_total{status=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))

# P95 延迟
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# 磁盘使用率（超过 85% 告警）
100 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} * 100)

# 内存使用率（排除 cache）
100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)
```

几个指标要特别说明：

- **别用 `free` 的 free 值判断内存**，Linux 会尽量用满 cache。看 `MemAvailable`；
- **CPU 使用率高不等于有问题**，要看 load 与 CPU 核数的比值（load 长期 > 核数 × 0.7 才值得关注）；
- **磁盘 inode 也会满**，`df -i` 单独监控，小文件多的系统经常栽在这；
- **P95 比平均值有意义**，平均 200ms 可能意味着 5% 的用户在等 3 秒。

## 三、告警怎么配才不吵

告警噪声是监控体系死掉的头号原因。三条原则：

1. **只在「需要人立刻做动作」时告警**。CPU 80% 不需要半夜打电话，磁盘 90% 且 6 小时会满才需要；
2. **分级**：P1 电话 + 短信，P2 企业微信，P3 只进看板；
3. **有抑制和聚合**：同一台机器的 20 条告警合并成一条，上游挂了就别再报下游。

```yaml
# Alertmanager 片段：同组聚合 + 抑制
route:
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - match: { severity: "critical" }
      receiver: phone
inhibit_rules:
  - source_match: { alertname: "HostDown" }
    target_match_re: { alertname: ".*" }
    equal: ["instance"]
```

一个实用判断：**如果一条告警连续三周都是「看到就关掉」，它就该被删除或改阈值。**

## 四、日志：ELK 的最小实践

```bash
# 一条链路的三段日志，时间必须能对齐
# 应用日志带 traceId
{"ts":"2026-10-19T10:12:33.451+08:00","level":"ERROR","traceId":"a1b2c3","msg":"db timeout","cost":30012}
# Nginx 访问日志带同样的 upstream 耗时
log_format main '$remote_addr "$request" $status $request_time $upstream_response_time $upstream_addr';
```

三个要点：

- **全链路一个 traceId**，从入口日志一路带到下游，否则跨服务排查就是拼图；
- **日志按天切割 + 保留策略**（logrotate 或 ES 的 ILM），不然日志本身会撑爆磁盘；
- **错误日志要能聚合**：同样的异常一秒 1000 条，看板要能按异常类型汇总，而不是刷屏。

对应 7 道监控日志面试题：[alo_program · 面试题库](https://yulu1235.github.io/alo_program/interview.html)。

## 五、五步排障法

现场排障最怕的是乱试。固定的五步能把「碰运气」变成「排除法」：

**第 1 步：界定范围。** 全站还是单接口？所有用户还是个别人？什么时候开始的？——这三个答案能砍掉一半可能性。

**第 2 步：看现象分层。** 按下表自上而下排除：

```bash
uptime                       # load 高不高
top -b -n1 | head -20        # 谁在吃 CPU
free -m                      # 内存与 swap
df -h; df -i                 # 磁盘空间与 inode
ss -s; ss -lntp              # 连接与监听
journalctl -u myapp --since "10 min ago" | tail -50
tail -n 200 /var/log/nginx/error.log
```

**第 3 步：找最近变化。** 有没有发布、改配置、加数据、改 DNS、扩缩容？**七成的突发故障来自变更。** 所以「最近改了什么」这一问题必须先问。

**第 4 步：验证假设，一次只改一个变量。** 改了就回滚不了的操作，先想清楚再做。

**第 5 步：恢复优先于定位根因。** 生产环境里，先在 5 分钟内止血（回滚/切流/扩容/重启），再花时间复盘。**顺序搞反是新手最常见的错误。**

配套脚本：

```bash
#!/usr/bin/env bash
# quickdiag.sh —— 一次抓齐现场快照
set -u
OUT=/tmp/diag-$(date +%Y%m%d%H%M%S)
mkdir -p "$OUT"
{ uptime; free -m; df -h; df -i; ss -s; top -b -n1 | head -30; } > "$OUT/system.txt" 2>&1
journalctl --since "30 min ago" --no-pager | tail -2000 > "$OUT/journal.txt" 2>&1
echo "已保存到 $OUT"
```

**先抓快照再重启**——重启会破坏现场，很多根因线索就此消失。

## 六、复盘：把故障变成资产

复盘文档只写四件事，别写成检讨书：

1. **时间线**：几点几分发现、几点恢复、每步做了什么；
2. **根因**：直接原因 + 为什么没提前发现；
3. **影响面**：多少用户、多长时间、有无资损；
4. **改进项**：每条都要有负责人和截止时间，尤其是「监控没报出来」的那一条。

> 判断一个团队运维成熟度，不看有没有故障，看**同类故障会不会发生第二次**。

下一篇讲这个岗位最「不像技术」的部分：ERP 与财务共享业务，以及实施交付怎么做。
