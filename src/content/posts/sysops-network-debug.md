---
title: "一个请求不通，怎么在五分钟内定位到层"
published: 2026-10-19
description: "「网站打不开了」这句话里没有信息。按 DNS → 端口 → 防火墙 → TLS → 应用五层往下砍，每一层给一条能立刻执行的命令和判据。"
tags:
  - 网络
  - 排障
  - 运维
  - TCP
category: "学习"
series: "系统实施运维：从入门到上岗"
seriesOrder: 3
draft: false
---

「网站打不开了」是最没用的故障描述。它可能是 DNS 解析错了、端口没起、防火墙挡了、证书过期了，也可能是应用自己返回了 500——这五种情况的处理人完全不同。

所以第一步永远是**分层**：从下往上，每层问一个能用命令回答的问题。

## 一、五层定位表

| 层 | 问什么 | 命令 | 判据 |
| --- | --- | --- | --- |
| 1 网络可达 | 能到这个 IP 吗 | `ping -c 3 <ip>` | 通不代表服务正常（ICMP 常被禁）；不通要看路由 |
| 2 DNS | 域名解析到哪 | `dig +short example.com` / `nslookup` | 结果必须是你期望的 IP |
| 3 端口与 TCP | 端口通不通 | `nc -vz host 443` / `telnet host 443` | `succeeded` 说明 TCP 三次握手成了 |
| 4 TLS / HTTP | 协议层能不能谈 | `curl -vI https://example.com` | 看证书、看状态码 |
| 5 应用 | 应用自己怎么说 | `curl -s -o /dev/null -w "%{http_code} %{time_total}\n"` | 200/500/502 各有含义 |

**关键点：`ping` 通不等于服务通，`telnet` 通不等于 HTTP 正常。** 一层层往下砍，能省掉大量猜测。

## 二、每层的实操细节

### 1. 网络可达

```bash
ping -c 3 10.0.0.8
traceroute -n 10.0.0.8        # Windows 是 tracert
ip route get 10.0.0.8         # 本机走哪条路由
```

如果 ping 不通：先看是不是本机网络问题（`ip a`、`ip route`），再看是不是中间设备丢包（`mtr` 比 traceroute 好用）。**注意很多云主机默认禁 ICMP，ping 不通不代表没通。**

### 2. DNS

```bash
dig +short example.com
dig @8.8.8.8 example.com       # 换一个 DNS 服务器对比
dig +trace example.com         # 从根开始跟，看在哪一步断
cat /etc/resolv.conf
```

DNS 问题最高频的三种形态：

- **解析到了旧 IP**：改过记录但 TTL 还没过期，或本机有 `dnsmasq`/`nscd` 缓存；
- **内网域名解析不出来**：`/etc/resolv.conf` 没指到内网 DNS；
- **能解析但连不上**：说明不是 DNS 问题，往下走。

### 3. 端口与 TCP

```bash
nc -vz example.com 443
ss -lntp | grep 443            # 服务端：谁在监听
ss -tnp state established | grep 443   # 看已建立的连接
```

服务端最常见的问题是**监听地址**：`127.0.0.1:8080` 只接受本机访问，外部当然连不上；`0.0.0.0:8080` 才是全网卡。Nginx 配置里的 `listen 127.0.0.1:80` 坑过很多人。

### 4. 防火墙

```bash
# 服务端
iptables -L -n -v
firewall-cmd --list-all          # CentOS/RHEL
ufw status verbose               # Ubuntu

# 云上还有一层安全组：控制台确认入方向放行了端口
```

三层防火墙要一起看：**云安全组 → 主机防火墙 → 应用监听**。少看一层就会在两个小时的扯皮里打转。

### 5. TLS 与 HTTP

```bash
curl -vI https://example.com 2>&1 | head -30
openssl s_client -connect example.com:443 -servername example.com </dev/null 2>/dev/null | openssl x509 -noout -dates
```

看三件事：**证书有效期**、**证书域名是否匹配**、**是否被中间代理拦截（自签证书最常见）**。

### 6. 应用层

```bash
curl -s -o /dev/null -w "code=%{http_code} dns=%{time_namelookup} conn=%{time_connect} tls=%{time_appconnect} total=%{time_total}\n" https://example.com
```

这条命令把耗时拆开，一眼能看出慢在哪：

| 现象 | 说明 |
| --- | --- |
| `time_namelookup` 大 | DNS 慢 |
| `time_connect` 大 | TCP 握手慢，网络或 backlog 问题 |
| `time_appconnect` 大 | TLS 握手慢，证书链或加密套件问题 |
| `time_starttransfer` 大 | 服务端处理慢 |
| `time_total` 大但前几项都小 | 传输慢，带宽或大响应体 |

## 三、状态码的含义（背下来能省很多时间）

| 码 | 谁的问题 | 常见原因 |
| --- | --- | --- |
| 502 | 网关/代理 | 后端进程挂了、后端超时、upstream 配错 |
| 504 | 网关/代理 | 后端处理超时（`proxy_read_timeout`） |
| 503 | 服务端 | 服务未就绪、连接数满了 |
| 413 | 代理 | `client_max_body_size` 太小，上传大文件失败 |
| 499 | 客户端 | 客户端主动断开（Nginx 特有），通常是后端太慢导致前端等不及 |
| 401/403 | 认证/权限 | 别急着查后端，先看鉴权与文件权限 |

**502 和 504 的区别值得多讲一句**：502 是「连不上后端」，504 是「连上了但后端没在超时内回」。前者查进程，后者查性能。

## 四、抓包：最后的证据

```bash
tcpdump -i any -nn port 8080 -w /tmp/cap.pcap
tcpdump -i any -nn -A 'tcp port 80 and (((ip[2:2] - ((ip[0]&0xf)<<2)) - ((tcp[12]&0xf0)>>2)) != 0)'
```

看包顺序就够了：**SYN → SYN/ACK → ACK 之后有没有 HTTP 请求、有没有 RST**。

- 只有 SYN，没有 SYN/ACK：服务端没监听或被防火墙丢；
- SYN 后立刻 RST：端口没开；
- 有请求有响应但客户端还在等：应用层慢或响应没发完。

## 五、面试题型与答法

**问：用户说网站慢，你怎么查？**

答：先确认是全部慢还是部分慢、是所有用户还是个别用户；然后用 `curl -w` 拆耗时定位是 DNS / 连接 / TLS / 服务端处理；服务端再看 `ss` 连接数、`top` 负载、应用日志里的慢请求；最后看数据库慢查询和外部依赖耗时。**先分层，再定位，别一上来就重启。**

**问：为什么 Nginx 日志里有 499？**

答：499 是 Nginx 记录「客户端在服务端响应前主动关闭连接」。通常是后端处理超过客户端耐心（浏览器/APP 超时），说明要优化后端响应时间或调大上游超时，而不是改 Nginx 的错误页。

**问：内网服务突然全都不通，你的思路？**

答：按影响面先定性——单机还是整网段、是否刚做过变更（DNS/防火墙/证书/发布）。然后从本机 `ip a`、`ip route`、`ping 网关`、`dig` 逐层确认。整网段问题优先怀疑最近一次变更和网络设备，而不是逐个服务查。

## 六、把工具留住

```bash
# 一个能一次跑完五层的自查脚本
host=$1
echo "== dns ==";  dig +short "$host"
echo "== ping =="; ping -c 2 -W 1 "$host" | tail -2
echo "== port =="; nc -vz -w 2 "$host" 443
echo "== http =="; curl -s -o /dev/null -w "code=%{http_code} total=%{time_total}\n" "https://$host"
```

保存成 `netcheck.sh`，客户打电话来的时候先跑一遍，比在电话里问「你再刷新一下试试」有用得多。

配套练习和面试题在 [alo_program · 面试题库](https://yulu1235.github.io/alo_program/interview.html)（网络部分 12 题）。下一篇回到数据库：实施岗最常被考的不是索引原理，是「你能不能把数取对」。
