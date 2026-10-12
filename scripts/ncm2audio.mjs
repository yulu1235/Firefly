import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CORE_KEY = Buffer.from("687A4852416D736F356B496E62617857", "hex"); // "hzHRAmso5kInbaxW"
const META_KEY = Buffer.from("2331346C6A6B5F215C5D2630553C2728", "hex"); // "#14ljk_!\\]&0U<'("

const ecb = (buf, key) => {
	const d = crypto.createDecipheriv("aes-128-ecb", key, null);
	d.setAutoPadding(false);
	return Buffer.concat([d.update(buf), d.final()]);
};

const stripPad = (buf) => {
	const pad = buf[buf.length - 1];
	return pad >= 1 && pad <= 16 && pad <= buf.length ? buf.subarray(0, buf.length - pad) : buf;
};

const xor = (buf, k) => {
	const o = Buffer.from(buf);
	for (let i = 0; i < o.length; i++) o[i] ^= k;
	return o;
};

/** ncm 音频头特征，用来定位音频起点 */
const AUDIO_HEADS = [
	["flac", Buffer.from("fLaC", "latin1")],
	["mp3", Buffer.from([0xff, 0xfb])],
	["mp3", Buffer.from([0xff, 0xfa])],
	["mp3", Buffer.from([0xff, 0xf3])],
	["mp3", Buffer.from([0xff, 0xf2])],
	["mp3", Buffer.from("ID3", "latin1")],
];

function decryptNcm(file) {
	const buf = fs.readFileSync(file);
	let off = 8 + 2; // "CTENFDAM" + 2 字节版本位

	// ① RC4 密钥材料
	const keyLen = buf.readUInt32LE(off);
	off += 4;
	const key = stripPad(ecb(xor(buf.subarray(off, off + keyLen), 0x64), CORE_KEY)).subarray(17);
	off += keyLen;

	// ② 元数据块（XOR 0x63 后是 "163 key(Don't modify):" + base64）
	let meta = null;
	const metaLen = buf.readUInt32LE(off);
	off += 4;
	if (metaLen > 0 && metaLen < 1024 * 1024) {
		const raw = xor(buf.subarray(off, off + metaLen), 0x63).subarray(22);
		off += metaLen;
		try {
			const plain = stripPad(ecb(Buffer.from(raw.toString("latin1"), "base64"), META_KEY)).subarray(6);
			meta = JSON.parse(plain.toString("utf8").replace(/\0+$/, ""));
		} catch {
			meta = null;
		}
	}

	// ③ RC4 式密钥流（与 ncmdump 一致的 box 构造）
	const box = new Uint8Array(256);
	for (let i = 0; i < 256; i++) box[i] = i;
	let c = 0;
	let last = 0;
	let ko = 0;
	for (let i = 0; i < 256; i++) {
		const swap = box[i];
		c = (swap + last + key[ko]) & 0xff;
		ko = (ko + 1) % key.length;
		box[i] = box[c];
		box[c] = swap;
		last = c;
	}
	const streamByte = (i) => {
		const j = (i + 1) & 0xff;
		return box[(box[j] + box[(box[j] + j) & 0xff]) & 0xff];
	};

	// ④ 音频起点：不同版本前面还有 CRC/占位/封面，用「解密后必须是合法音频头」定位
	const tryHead = (audioOff, imgOff, imgLen) => {
		if (audioOff + 4 > buf.length) return null;
		const head = Buffer.from(buf.subarray(audioOff, audioOff + 4));
		for (let i = 0; i < head.length; i++) head[i] ^= streamByte(i);
		for (const [ext, sig] of AUDIO_HEADS) {
			if (head.subarray(0, sig.length).equals(sig)) return { audioOff, imgOff, imgLen, ext };
		}
		return null;
	};

	let found = null;
	for (let p = off; p <= off + 64 && !found; p++) {
		const imgLen = buf.readUInt32LE(p);
		if (imgLen > 0 && imgLen < 20 * 1024 * 1024 && p + 4 + imgLen + 4 <= buf.length) {
			found = tryHead(p + 4 + imgLen, p + 4, imgLen);
		}
		if (!found) found = tryHead(p, 0, 0);
	}
	if (!found) throw new Error("找不到音频起点（文件可能不完整或非标准 ncm）");

	const audio = Buffer.from(buf.subarray(found.audioOff));
	for (let i = 0; i < audio.length; i++) audio[i] ^= streamByte(i);
	const image = found.imgLen > 0 ? Buffer.from(buf.subarray(found.imgOff, found.imgOff + found.imgLen)) : null;

	return { audio, ext: found.ext, image, meta };
}

// 用法：
//   node scripts/ncm2audio.mjs <a.ncm> [b.ncm ...]        输出到每个文件同级的 out/ 目录
//   node scripts/ncm2audio.mjs -o <输出目录> <a.ncm ...>   指定输出目录
// 说明：只解开网易云客户端自己下载的 ncm 外壳（AES-128-ECB + RC4 异或），
//       不涉及版权解除；转出来的文件请自行斟酌用途，别公开分发。

const argv = process.argv.slice(2);
let outDirOverride = null;
const files = [];
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === "-o" || argv[i] === "--out") {
		outDirOverride = argv[++i];
	} else {
		files.push(argv[i]);
	}
}
if (files.length === 0) {
	console.log("用法: node scripts/ncm2audio.mjs [-o 输出目录] <文件.ncm> [...]");
	process.exit(1);
}

for (const f of files) {
	try {
		const r = decryptNcm(f);
		const base = path.basename(f).replace(/\.ncm$/i, "");
		const outDir = outDirOverride ? path.resolve(outDirOverride) : path.join(path.dirname(f), "out");
		fs.mkdirSync(outDir, { recursive: true });
		const out = path.join(outDir, `${base}.${r.ext}`);
		fs.writeFileSync(out, r.audio);
		console.log(`OK  ${path.basename(f)}`);
		console.log(`    -> ${out}  ${(r.audio.length / 1048576).toFixed(2)} MB  [${r.ext}]`);
		console.log(`    封面: ${r.image ? `${(r.image.length / 1024).toFixed(0)} KB` : "无"}`);
		if (r.meta) {
			const artists = (r.meta.artist ?? []).map((a) => a[0]).join(" / ");
			console.log(`    元数据: ${r.meta.musicName ?? "?"} — ${artists || "?"} — ${r.meta.album ?? "?"}`);
		}
		if (r.image) {
			const ext = r.image[0] === 0xff && r.image[1] === 0xd8 ? "jpg" : "png";
			fs.writeFileSync(path.join(outDir, `${base}.cover.${ext}`), r.image);
		}
	} catch (e) {
		console.log(`ERR ${path.basename(f)}: ${e.message}`);
	}
}
