---
title: "Nginx / Redis / 消息队列：每个中间件最高频的两个故障"
published: 2026-10-19
description: "中间件的故障看起来千奇百怪，实际反复出现的就那么几个：Nginx 的 502 与连接数、Redis 的慢查询与大 key、MQ 的堆积与重复消费。每类给现象、判断依据和处理顺序。"
tags:
  - Nginx
  - Redis
  - 消息队列
  - 中间件
  - 排障
category: "学习"
series: "系统实施运维：从入门到上岗"
seriesOrder: 5
draft: false
---

中间件不用学全，但要**对每个件的「典型病」有肌肉记忆**。这篇按「现象 → 判断 → 处理」写，现场可以直接照做。

## 一、Nginx：502 与连接数打满

### 故障 A：一大片 502 Bad Gateway

502 的定义是「网关连不上上游」，所以查的顺序永远是 **上游进程 → 网络可达 → 配置 → 超时**。

```bash
# 1. 上游进程活着吗
systemctl status myapp; ss -lntp | grep 8080

# 2. Nginx 能不能连到上游
curl -I http://127.0.0.1:8080/health

# 3. 看错误日志里的具体原因
tail -n 100 /var/log/nginx/error.log
```

错误日志里最常见的三种：

| 日志关键字 | 原因 | 处理 |
| --- | --- | --- |
| `Connection refused` | 上游没监听 / 端口错 | 起进程、改 `proxy_pass` 端口 |
| `upstream timed out` | 上游处理太慢 | 调 `proxy_read_timeout`，但更要优化上游 |
| `no live upstreams` | 健康检查把节点全摘了 | 看 `max_fails`、`fail_timeout`，先确认为什么探测失败 |

一个常被忽略的点：**`proxy_pass` 结尾带不带斜杠，路径会不一样**。

```nginx
location /api/ {
    proxy_pass http://backend;      # 转发到 /api/xxx
    proxy_pass http://backend/;     # 转发到 /xxx（吃掉 /api 前缀）
}
```

### 故障 B：连接数打满，新请求排队

```bash
ss -s                                   # 连接总览
ss -tn state established | wc -l        # 已建立连接数
grep -E "worker_connections|worker_processes" /etc/nginx/nginx.conf
```

Nginx 的理论上限是 `worker_processes × worker_connections`，再除去与上游的连接占用。调大之前先确认两件事：

1. **系统级限制**：`ulimit -n`、`fs.file-max`、`net.core.somaxconn`；
2. **是不是真的该有这么多连接**：短连接没复用、客户端没超时、上游不响应都会让连接堆积。

```nginx
# 让客户端连接尽快释放
keepalive_timeout 30;
client_header_timeout 10;
client_body_timeout 10;
send_timeout 10;

# 与上游复用长连接，减少 TIME_WAIT
upstream backend {
    server 127.0.0.1:8080;
    keepalive 32;
}
```

## 二、Redis：大 key 与慢查询

### 故障 A：突然变慢、超时

Redis 是单线程处理命令，**一条慢命令会阻塞所有人**。所以第一个动作永远是查慢日志：

```bash
redis-cli SLOWLOG GET 10
redis-cli --latency            # 当前延迟
redis-cli INFO stats | grep -E "instantaneous_ops|rejected"
redis-cli --bigkeys            # 找出大 key
```

高频原因：

| 原因 | 表现 | 处理 |
| --- | --- | --- |
| 大 key（几 MB 的 Hash/List） | `DEL`/`HGETALL` 时卡顿 | 拆分、改用 `HSCAN` 分批、异步删除 `UNLINK` |
| `KEYS *` / `FLUSHALL` | 整个实例卡住 | 生产禁用 `KEYS`，用 `SCAN` |
| 内存满触发淘汰 | 命中率骤降、写失败 | 看 `maxmemory-policy`，扩容或清理 |
| 持久化 fork 阻塞 | 周期性抖动 | RDB 频率、`save` 配置、内存不要超过物理内存 60% |

**判断内存是否危险**：`INFO memory` 看 `used_memory` 和 `maxmemory` 的比例，以及 `evicted_keys` 是否在增长。

### 故障 B：缓存与数据库不一致

这是面试和现场都必考的题。结论先给：**没有完美方案，只有权衡**。

| 方案 | 做法 | 问题 |
| --- | --- | --- |
| 先更新库再删缓存 | 最常用 | 极端并发下仍可能读到旧值 |
| 延迟双删 | 更新后延迟几百毫秒再删一次 | 只是缩小窗口，不是消除 |
| 订阅 binlog 异步失效 | Canal 之类 | 链路长，但最终一致性最稳 |
| 只更新缓存不删 | 简单 | 并发写会互相覆盖 |

配套的三个概念必须分清：

- **穿透**：查一个不存在的 key，每次都打到库 → 空值缓存 / 布隆过滤器；
- **击穿**：热点 key 过期瞬间大量请求打到库 → 互斥锁 / 逻辑过期；
- **雪崩**：大批 key 同时过期或实例挂掉 → 过期时间加随机、多级缓存、限流降级。

## 三、消息队列：堆积与重复消费

### 故障 A：消费积压，延迟越来越高

```bash
# Kafka
kafka-consumer-groups.sh --bootstrap-server broker:9092 --describe --group my-group
# 看 LAG 列
```

积压判断顺序：**生产是不是突然暴涨 → 消费是不是变慢 → 分区数是不是不够**。

| 现象 | 结论 | 处理 |
| --- | --- | --- |
| 生产速率平稳但 LAG 持续涨 | 消费能力不足 | 加消费者实例（不超过分区数）、优化单条处理耗时 |
| LAG 在某时刻陡增 | 消费端异常或重启 | 看消费日志、确认是否有毒消息反复重试 |
| 单个分区 LAG 特别高 | 分区键倾斜 | 换分区键、拆分热点 key |

一个常见误区是「无脑加实例」：**消费者数超过分区数，多出来的实例会空闲**，因为一个分区只能被同组内一个消费者消费。

### 故障 B：重复消费与顺序错乱

可靠消息系统给的是 **至少一次**，不是恰好一次。所以消费端必须幂等：

```sql
-- 唯一约束兜底
INSERT INTO processed_msg (msg_id, created_at) VALUES (?, NOW());
-- 或者业务表上加唯一索引：订单号 + 操作类型
```

顺序问题则来自两处：**生产端乱序**（不同分区）与**消费端并发**（多线程处理同一分区）。要严格顺序就保证同业务 key 进同一分区、单线程消费——代价是吞吐。

### 三个必答概念

- **消息丢失**：生产端确认（`acks=all`）、broker 副本（`min.insync.replicas`）、消费端手动提交位点；
- **消息重复**：幂等 + 去重表；
- **消息堆积**：扩容分区/消费者、削峰限流、把耗时操作移出消费链路。

## 四、一张中间件体检表

| 组件 | 每天该看 | 出事第一现场 |
| --- | --- | --- |
| Nginx | `error.log` 里的 502/504 数量、连接数 | `error.log` 关键字 |
| Redis | 内存使用率、`evicted_keys`、慢日志 | `SLOWLOG`、`--bigkeys` |
| Kafka | 各 group 的 LAG | `--describe --group` |
| MySQL | 连接数、慢查询、主从延迟 | `SHOW PROCESSLIST`、`EXPLAIN` |

配套的 12 道中间件面试题在 [alo_program · 面试题库](https://yulu1235.github.io/alo_program/interview.html)。

下一篇讲容器与流水线：实施运维到底需要把 K8s 学到多深。
