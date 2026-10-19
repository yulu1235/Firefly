---
title: "Linux 必会命令：把日常运维压缩成一张表"
published: 2026-10-19
description: "不用背 200 个命令。按「看状态、找东西、改权限、看日志、上服务」五类整理，每一类只留真正会用到的那几个，附上组合拳和面试会追问的点。"
tags:
  - Linux
  - 运维
  - 命令
  - 面试
category: "学习"
series: "系统实施运维：从入门到上岗"
seriesOrder: 2
draft: false
---

Linux 命令没必要全背。真正每天用的，按用途分五类，每类五六个，加起来不到四十个；剩下的遇到再查。

这篇按「你现在想干什么」组织，不是按字母表。

## 一、看状态：这台机器现在怎么样

| 想知道的 | 命令 | 关键点 |
| --- | --- | --- |
| 负载与运行时长 | `uptime` | 三个 load 值是 1/5/15 分钟平均。**看它和核数的比例**：8 核 load 8 才算满 |
| 实时的进程 TOP | `top` / `htop` | 先按 `P` 看 CPU，按 `M` 看内存；`1` 展开每个核 |
| 内存真实用量 | `free -h` | 关注 `available`，不是 `free`。`buff/cache` 是好事 |
| 磁盘空间 | `df -h` | 满了先找谁占的 |
| 磁盘目录占用 | `du -sh * \| sort -h` | 从大往小看，别一上来 `du -a` 全盘扫 |
| 磁盘 IO | `iostat -x 1` | 看 `%util` 和 `await`，前者接近 100% 说明盘吃满了 |
| 谁占了端口 | `ss -lntp` | 比 `netstat` 快；`-p` 要 root |
| 进程树 | `ps -ef --forest` | 找父进程，很多「杀不掉」是父进程在重启它 |
| 系统日志 | `journalctl -xe` | systemd 体系下第一现场 |

**一组最常用的排查组合**：

```bash
uptime; free -h; df -h; ss -lntp
```

四条命令十秒钟，能判断「是不是负载高 / 内存不足 / 磁盘满 / 端口没起」这四类占了八成的故障。**面试被问「服务器卡了怎么办」，先答这四条，再往下深入。**

## 二、找东西：文件、内容、进程

```bash
# 找文件（按名字、按时间、按大小）
find /var/log -name "*.log" -mtime -1 -size +100M

# 找内容（递归、带行号、忽略大小写）
grep -rn --include="*.conf" "proxy_pass" /etc/nginx

# 找进程
ps -ef | grep -v grep | grep java
pgrep -af java

# 找命令来自哪个包（Debian 系）
dpkg -S $(which nginx)
```

两个容易被追问的细节：

- `grep -r` 遇到二进制文件会输出乱码，加 `-I` 忽略；
- `find -mtime -1` 是「24 小时内修改过」，`-mmin -60` 才是「60 分钟内」——时间单位差了 24 倍，这是经典陷阱。

## 三、改权限：为什么网站 403 了

权限问题九成出在三个地方：文件权限、属主、SELinux。

```bash
ls -l /var/www/html            # 看权限位
chown -R www-data:www-data /var/www/html
chmod 755 /var/www/html        # 目录要 x 才能进
chmod 644 /var/www/html/*.html # 文件给读就够，别 777
```

记一下这个对应关系就不容易错：

| 权限 | 数字 | 目录上的含义 | 文件上的含义 |
| --- | --- | --- | --- |
| r | 4 | 能列出内容（`ls`） | 能读内容 |
| w | 2 | 能在里面增删文件 | 能改内容 |
| x | 1 | 能进入（`cd`） | 能执行 |

**目录没有 `x` 就进不去，即使有 `r` 也一样**——这是「权限看着对但访问 403/404」的头号原因。

如果权限都对还不行，检查 SELinux：

```bash
getenforce                       # Enforcing 就是开着
ls -Z /var/www/html              # 看安全上下文
restorecon -Rv /var/www/html     # 恢复默认上下文
```

## 四、看日志：从「报错了」到「哪一行报错」

```bash
tail -f /var/log/nginx/error.log          # 跟着看
tail -n 200 app.log | grep -i error       # 最近的错误
journalctl -u nginx --since "10 min ago"  # 按服务按时间
awk '$9 >= 500' access.log | wc -l        # 统计 5xx 数量
```

看日志的通用顺序是：**先看时间戳对不对（时区问题很常见），再看最后一条正常日志之后发生了什么，然后顺着 traceback 找第一个自己代码栈帧。**

面试常问「日志太大怎么办」，标准答案是轮转：`logrotate` 按天切、压缩、保留 N 天。手写的话至少也要 `> app.log` 清空（不是 `rm`，`rm` 删掉正在写的文件，空间不会立刻释放）。

## 五、上服务：让程序活着

```bash
# 临时跑（退出终端就死）
nohup ./app > app.log 2>&1 &

# 正经跑（开机自启、崩溃重启、统一日志）
systemctl enable --now myapp
systemctl status myapp
journalctl -u myapp -f

# 资源限制看一眼
ulimit -n                 # 当前会话
cat /etc/security/limits.conf
```

`systemd` 的 unit 文件是最值得花十分钟学的东西，最小可用版本：

```ini
[Unit]
Description=My App
After=network.target

[Service]
User=app
WorkingDirectory=/opt/app
ExecStart=/opt/app/start.sh
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

写完 `systemctl daemon-reload && systemctl enable --now myapp`。**面试里能默写这段，比背二十个命令更有说服力。**

## 六、面试会追问的几个点

1. **`df` 显示有空间但写不进去？** 多半是 inode 用完了（`df -i` 看），大量小文件导致的。
2. **`rm` 了大文件空间没释放？** 文件还被进程占着，`lsof | grep deleted` 找到进程后重启它。
3. **load 很高但 CPU 空闲？** 大量进程在等磁盘 IO 或不可中断睡眠（D 状态），用 `iostat` 和 `ps -eo stat,comm` 看。
4. **`kill -9` 杀不掉？** 僵尸进程或 D 状态进程，得解决根因（父进程、IO 阻塞）而不是硬杀。
5. **改了配置什么时候生效？** 分清 `systemctl reload`（重载，不断连接）与 `restart`（重启，断连接），线上优先 reload。

## 附：一张速查表

```bash
# 状态
uptime; free -h; df -h; df -i; ss -lntp; iostat -x 1
# 找
find / -name x -mtime -1; grep -rn "kw" dir; pgrep -af java
# 权限
ls -l; chown -R u:g dir; chmod -R 755 dir; getenforce; restorecon -Rv dir
# 日志
tail -f log; journalctl -u svc --since "1 hour ago"; logrotate -d /etc/logrotate.conf
# 服务
systemctl status|start|stop|restart|reload|enable svc; journalctl -u svc -f
```

完整的知识点手册（17 个模块、102 个知识点，含命令示例）在 [alo_program · 知识点](https://yulu1235.github.io/alo_program/knowledge.html)。

下一篇讲网络：一个请求不通，怎么在五分钟内判断是 DNS、端口、防火墙还是应用本身。
