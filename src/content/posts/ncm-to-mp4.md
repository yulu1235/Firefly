---
title: "把 NCM 音乐转成 MP4：先分清你要的是哪一种"
published: 2026-10-12
description: "网易云下载的 .ncm 怎么变成 MP4？分两种情况：只要一个车机能播的音频文件，还是要一个能上传视频平台的带封面视频。两条命令都在这里，附实测踩过的坑。"
tags:
  - NCM
  - ffmpeg
  - 音频
  - 教程
category: "折腾"
draft: false
---

网易云把下载的歌存成 `.ncm`，只有它自己能播。想变成 MP4，第一件事不是敲命令，而是先想清楚你要的「MP4」是哪一个：

- **音频版**：一个能塞进车机 U 盘、老播放器、剪辑软件的音轨（MP4 容器里装 AAC，扩展名一般写 `.m4a`）
- **视频版**：一个能传 B 站 / YouTube 的成品（一张封面图当画面 + 音轨）

两种需求前半步完全一样，后半步是两条不同的命令。

## 第 0 步：先把 .ncm 的壳剥掉

`ffmpeg` 不认识 `.ncm`，它只认标准容器。所以不管走哪条路，都要先把 ncm 还原成 flac / mp3。

这一步用 [ncm2audio](https://github.com/yulu1235/ncm2audio)（一条命令的小工具，零依赖，Node 18 以上就能跑）：

```console
$ ncm2audio -o ./music song.ncm
OK  song.ncm
    -> D:\music\song.flac  4.19 MB  [flac]
    封面: 35 KB  -> D:\music\song.cover.jpg
    元数据: 前前前世 — RADWIMPS — 君の名は。
```

它顺手把内嵌封面和歌曲信息取出来了 —— 做视频版时正好拿来当画面。

## A. 音频版：转成 m4a

```bash
ffmpeg -i song.flac -c:a aac -b:a 256k -vn song.m4a
```

- `-c:a aac`：音频编码成 AAC，MP4 容器里最通用的音频编码，车机、手机、剪辑软件都认
- `-b:a 256k`：码率。无损转有损必然掉信息，256k 基本听不出差别；空间紧可以降到 192k
- `-vn`：不要视频轨。别以为音频文件就没有视频轨 —— 带内嵌封面的 flac 里就有一条

老车机、老播放器上建议再加 `-movflags +faststart`：

```bash
ffmpeg -i song.flac -c:a aac -b:a 256k -vn -movflags +faststart song.m4a
```

它把索引挪到文件开头，播放器不用读完整个文件就能开始播、也能拖进度条。

想让播放器显示封面，就再嵌一张图：

```bash
ffmpeg -i song.m4a -i song.cover.jpg -map 0:a -map 1:v -c:a copy -c:v mjpeg \
  -disposition:v attached_pic -metadata title="前前前世" -metadata artist="RADWIMPS" song-cover.m4a
```

`-disposition:v attached_pic` 是关键：它把这张图标记成「封面」而不是「一帧画面」，否则有些播放器会当成 MV 从头播到尾（画面只有一张图，很尴尬）。

## B. 视频版：一张图 + 一条音轨

```bash
ffmpeg -loop 1 -framerate 2 -i song.cover.jpg -i song.flac \
  -c:v libx264 -tune stillimage -pix_fmt yuv420p \
  -c:a aac -b:a 256k -shortest -movflags +faststart song.mp4
```

- `-loop 1`：让图一直循环，否则第一帧之后就黑屏了
- `-framerate 2`：静止画面不需要 30fps，2 帧足够，文件小一大截
- `-tune stillimage`：告诉 x264「画面几乎不动」，它按这个前提优化质量和体积
- `-pix_fmt yuv420p`：**最容易漏的一条**，不加可能生成 yuv444，播放器和视频平台会黑屏或直接拒收
- `-shortest`：音轨放完就结束，不然图片会无限循环，文件越滚越大

想连歌词一起烧进画面？这里有个坑：**`subtitles=` 滤镜根本不认 `.lrc`，而且是静默忽略 —— 不报错、退出码还是 0，你只会得到一个没有歌词的视频**。我实测对比过：同样的命令，输入 `.srt` 时画面里有字，输入 `.lrc` 时那一帧与「完全不加字幕」像素级一模一样。

所以要先转成 `.srt`：

```js
// lrc2srt.mjs —— 用法: node lrc2srt.mjs song.lrc [song.srt]
import fs from "node:fs";

const toMs = (m, s) => Math.round((Number(m) * 60 + Number(s)) * 1000);
const fmt = (ms) => {
	const p = (n, w = 2) => String(n).padStart(w, "0");
	return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
};

const input = process.argv[2];
if (!input) {
	console.error("用法: node lrc2srt.mjs <song.lrc> [输出.srt]");
	process.exit(1);
}
const output = process.argv[3] ?? input.replace(/\.lrc$/i, ".srt");

// 国内的 .lrc 有 BOM、甚至整份是 GBK 的都很常见：先按 UTF-8 读，出现替换字符就退回 GBK
const buf = fs.readFileSync(input);
let text = buf.toString("utf8");
if (text.includes("\uFFFD")) text = new TextDecoder("gbk").decode(buf);

const cues = [];
for (const line of text.split(/\r?\n/)) {
	const stamps = [...line.matchAll(/\[(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/g)];
	const label = line.replace(/\[[^\]]*\]/g, "").trim();
	if (!stamps.length || !label) continue;
	for (const st of stamps) cues.push({ at: toMs(st[1], st[2]), text: label });
}
cues.sort((a, b) => a.at - b.at);

const body = cues
	.map((cue, i) => {
		const end = Math.max(cues[i + 1]?.at ?? cue.at + 4000, cue.at + 500);
		return `${i + 1}\n${fmt(cue.at)} --> ${fmt(end)}\n${cue.text}\n`;
	})
	.join("\n");

fs.writeFileSync(output, body, "utf8");
console.log(`${cues.length} 行歌词 → ${output}`);
```

转完再渲染：

```bash
ffmpeg -loop 1 -framerate 2 -i song.cover.jpg -i song.flac \
  -vf "subtitles=song.srt" -c:v libx264 -tune stillimage -pix_fmt yuv420p \
  -c:a aac -b:a 256k -shortest song-lyrics.mp4
```

Windows 上给滤镜传绝对路径要写成 `subtitles='D\:/path/song.srt'` 这种转义形式，容易被路径里的反斜杠和冒号坑到；省事的办法是先 `cd` 进目录，只用文件名。

## 批量

```powershell
# 先把一个目录里的 ncm 全解开
Get-ChildItem *.ncm | ForEach-Object { ncm2audio -q -o .\out $_ }

# 再把解出来的 flac 批量转 m4a
Get-ChildItem .\out\*.flac | ForEach-Object {
  ffmpeg -i $_.FullName -c:a aac -b:a 256k -vn -movflags +faststart ($_.FullName -replace '\.flac$', '.m4a')
}
```

## 实测踩过的坑

| 现象 | 原因 |
| --- | --- |
| 传上去被平台压成马赛克 | 忘了 `-pix_fmt yuv420p`；或码率太低，视频版可以加 `-crf 20` 提质量 |
| 车机里进度条拖不动 | 少了 `-movflags +faststart` |
| MP4 比原来的 flac 还大 | AAC 码率给太高。无损转 AAC 没有意义，256k 足够 |
| 封面不显示，或被当成 MV 播 | 少了 `-disposition:v attached_pic`；封面图也别太大，500×500 左右就够 |
| 加了歌词却一个字都没出现 | `.lrc` 被静默忽略，先转 `.srt` |

## 最后一句

`.ncm` 只是网易云在本地文件外面套的一层壳，把它还原成 flac / mp3 属于格式转换，不是破解。但**能转不等于能随便传**：自己听、自己转、自己用没问题，公开分发（包括传视频平台）仍然要看版权，这点自己把握。
