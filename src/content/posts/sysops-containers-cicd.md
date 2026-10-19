---
title: "容器与流水线：实施运维到底要把 K8s 学到多深"
published: 2026-10-19
description: "很多人卡在这里：一边被 K8s 名词吓住，一边在客户现场只需要 docker compose。这篇给一条分层标准——哪层必须会、哪层看懂就行，附最小可用的 Dockerfile 与流水线。"
tags:
  - Docker
  - Kubernetes
  - CICD
  - 自动化
  - 运维
category: "学习"
series: "系统实施运维：从入门到上岗"
seriesOrder: 6
draft: false
---

「要会 K8s 吗？」这个问题没有统一答案，取决于你去的是甲方自建云、乙方交付现场，还是 SaaS 公司运维。

比较务实的判断标准是：**看你要交付的系统跑在哪**。私有化交付八成是虚拟机 + Docker Compose；互联网业务才是 K8s。所以学习顺序应该跟着用途走。

## 一、四层能力，按需爬到哪层

| 层 | 内容 | 谁需要 |
| --- | --- | --- |
| L1 会用容器 | `docker run/build/logs/exec`、Dockerfile、volume、network | 所有运维，必会 |
| L2 会编排单机 | compose 文件、环境变量、健康检查、依赖顺序 | 私有化交付，必会 |
| L3 会部署到集群 | Deployment/Service/Ingress、ConfigMap/Secret、`kubectl` 常用命令、看日志排障 | 云原生环境，必会 |
| L4 会运维集群 | 节点、存储类、网络插件、HPA、Operator、升级 | 专职 K8s 运维 |

**实施岗把 L1、L2 练到熟，L3 能照着文档部署和排障，L4 了解概念即可。** 面试里被问 K8s，答出 L3 的实操细节比背控制面组件更有用。

## 二、L1：Dockerfile 里最值得写的六行

```dockerfile
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY target/app.jar app.jar
ENV TZ=Asia/Shanghai JAVA_OPTS="-Xms512m -Xmx512m"
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["sh","-c","exec java $JAVA_OPTS -jar app.jar"]
```

几条经验：

- **基础镜像选 alpine/slim**，别用 `latest`，镜像大小直接影响交付和拉取时间；
- **`ENTRYPOINT` 用 exec 形式**（`["java","-jar",...]`），否则 PID 1 是 shell，收不到 SIGTERM，`docker stop` 要等 10 秒才强杀；
- **时区一定要设**，不然日志时间差 8 小时，排查时能绕死你；
- **`HEALTHCHECK` 让编排系统知道容器是不是真活着**，比「进程在跑」准确得多。

常用命令其实就这些：

```bash
docker ps -a                      # 包括退出的容器，看退出码
docker logs -f --tail 100 app     # 跟日志
docker exec -it app sh            # 进去看
docker stats                      # 资源占用
docker image prune -a             # 清无用镜像（小心）
docker inspect app | grep -i health
```

## 三、L2：一份能交付的 compose

```yaml
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PWD}
      TZ: Asia/Shanghai
    volumes:
      - ./data/mysql:/var/lib/mysql
      - ./init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1"]
      interval: 10s
      retries: 10
    restart: unless-stopped

  app:
    image: registry.local/myapp:1.4.2
    depends_on:
      mysql:
        condition: service_healthy
    environment:
      SPRING_DATASOURCE_URL: jdbc:mysql://mysql:3306/biz?useSSL=false
    ports:
      - "8080:8080"
    restart: unless-stopped
```

现场交付经常踩的坑：

1. **数据卷没挂出来**：容器删了数据也没了。数据库、上传目录、日志目录必须挂宿主机；
2. **`depends_on` 不等于「准备好了」**：要用 `condition: service_healthy`；
3. **时区和字符集**：MySQL 容器默认 `utf8mb4` 一般没问题，但 `TZ`、`lower_case_table_names` 要统一；
4. **`restart` 策略**：交付现场用 `unless-stopped`，别用 `always`（维护时停不掉）。

## 四、L3：K8s 只需要记这些

```bash
kubectl get pods -n prod -o wide
kubectl describe pod <pod> -n prod         # 事件在最后，排障第一现场
kubectl logs -f <pod> -n prod --tail=200
kubectl exec -it <pod> -n prod -- sh
kubectl rollout restart deploy/<name> -n prod
kubectl rollout undo deploy/<name> -n prod # 回滚
kubectl get events -n prod --sort-by=.lastTimestamp | tail -20
```

四个对象就能覆盖大多数交付场景：

| 对象 | 干什么 | 常配的字段 |
| --- | --- | --- |
| Deployment | 管理 Pod 副本 | `replicas`、`image`、`resources`、`probes` |
| Service | 集群内访问入口 | `selector`、`port`、`targetPort` |
| Ingress | 集群外 HTTP 入口 | `host`、`path`、`tls` |
| ConfigMap/Secret | 配置与密钥 | 挂载或环境变量注入 |

排障时的判断顺序：**`describe` 看事件 → `logs` 看应用 → `exec` 进去验证网络和配置 → 看 `resources` 是否 OOMKilled。**

`kubectl describe pod` 最后那段 Events 信息量最大：`ErrImagePull` 是镜像拉不到（仓库地址/密钥），`CrashLoopBackOff` 是进程起来就退（看 logs），`OOMKilled` 是内存超限（调 limits 或查泄漏）。

## 五、流水线：最小可用的 CI

流水线的价值不是「自动化显得高级」，而是**让发布这件事可重复、可回滚、有记录**。

```yaml
# .github/workflows/deploy.yml
name: build-and-deploy
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - run: docker build -t registry.local/myapp:${{ github.sha }} .
      - run: docker push registry.local/myapp:${{ github.sha }}
      - name: deploy
        run: ssh ops@server "cd /opt/app && ./deploy.sh ${{ github.sha }}"
```

配套的三条铁律：

1. **镜像 tag 用 commit sha，不用 `latest`**——出问题才能精确回滚；
2. **部署脚本要幂等**，重复执行结果一致；
3. **回滚一步到位**：`deploy.sh` 支持传上一个版本号，或者用 `kubectl rollout undo`。

### 顺带说一下 Ansible

私有化交付里，Ansible 比 K8s 更常见：几十台机器装同一套环境，用 playbook 比手工 SSH 靠谱得多。

```yaml
- hosts: all
  become: yes
  tasks:
    - name: 安装依赖
      yum: name={{ item }} state=present
      loop: [chrony, ntpdate, lsof]
    - name: 同步时间
      copy: src=chrony.conf dest=/etc/chrony.conf
      notify: restart chronyd
```

`notify` + `handlers` 是关键：只在配置真正变化时才重启服务。

## 六、别掉进的两个坑

**坑一：把「会用」当成「会调」。** 面试问「Pod 一直 Pending 怎么查」，如果你只会 `kubectl get pods`，说明没真正排过障。标准答案是：`describe` 看事件 → 节点资源/污点/亲和性 → PVC 是否绑定 → 镜像大小是否超过节点磁盘。

**坑二：为了用容器而用容器。** 单机部署一个 Java 应用的私有化项目，硬上 K8s 会让交付和售后成本翻倍。**技术选型的第一原则是匹配客户的运维能力。**

容器与云原生相关的 8 道题在 [alo_program · 面试题库](https://yulu1235.github.io/alo_program/interview.html)。

下一篇讲监控与排障：如何从「靠人喊」变成「系统先发现」。
