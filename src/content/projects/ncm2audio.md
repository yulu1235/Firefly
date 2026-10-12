---
title: "ncm2audio"
published: 2026-10-12
order: 100
description: "把网易云音乐客户端下载的 .ncm 文件解密导出为 mp3 / flac 的命令行工具。零运行时依赖，同时可当库用，附带 19 个不依赖真实样本的测试用例。"
status: "published"
tags:
  - Node.js
  - CLI
  - 加密解密
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/yulu1235/ncm2audio"
---

## 它解决什么问题

网易云客户端把下载的歌曲存成 `.ncm` 外壳，只有它自己能播。这个工具把外壳剥掉，还原成标准的 mp3 / flac，方便在本地播放器或自建音乐库里使用。

## 做了什么

- **命令行**：`ncm2audio song.ncm`，支持 `-o/--out`、`--no-cover`、`-q/--quiet`；退出码区分「全部成功 / 参数错误 / 有文件失败」，批量转换时单个失败不会中断其余文件
- **可当库用**：解密核心 `decryptNcm(buf)` 是纯函数，不碰文件系统，出错抛 `NcmError`
- **零运行时依赖**：只用 Node 内置模块（`node:crypto` 做 AES-128-ECB）
- **19 个测试用例**，且不依赖真实 `.ncm` 样本：测试里实现了对应的「打包侧」逻辑，先造出合法的 ncm 容器，再走完整解密路径做往返比对，覆盖无封面 / 有封面 / mp3 / 文件截断 / 魔数错误 / CLI 参数与退出码
- 顺带导出内嵌封面，按文件头判断 jpg / png

## 命令行示例

```console
$ ncm2audio -o ./music song.ncm
OK  song.ncm
    -> D:\music\song.flac  4.19 MB  [flac]
    封面: 35 KB  -> D:\music\song.cover.jpg
    元数据: 前前前世 — RADWIMPS — 君の名は。
```

## 技术要点

`.ncm` 是三层壳：AES-128-ECB 保护的 RC4 密钥材料、异或 + base64 + AES 的元数据块、以及用密钥流逐字节异或的音频本体。

真正的难点是**音频起点**——不同版本在音频前面还塞了 CRC / 占位 / 封面，长度不固定。这里没有写死偏移量，而是循环尝试候选位置、用「解密后必须是合法音频头（`fLaC` / `ID3` / mp3 帧同步字）」来定位，找到了才动手解音频。
