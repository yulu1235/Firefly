/**
 * 兼容入口：NCM 解密功能已抽成独立包，源码在同级的 alo_program/ncm2audio。
 *
 *   alo_program/
 *   ├── Firefly/scripts/ncm2audio.mjs   ← 本文件（薄入口）
 *   └── ncm2audio/                      ← 独立包，含 CLI、库、测试、README
 *
 * 参数与独立包 CLI 完全一致，例如：
 *   node scripts/ncm2audio.mjs song.ncm
 *   node scripts/ncm2audio.mjs -o ./music --no-cover a.ncm b.ncm
 *   node scripts/ncm2audio.mjs --help
 *
 * 注意：跨仓库相对引用只在本机的目录布局下有效；独立包单独 clone 时请用
 *   node ncm2audio/bin/ncm2audio.mjs <文件.ncm>
 */
const cliUrl = new URL("../../ncm2audio/src/cli.mjs", import.meta.url);

let main;
try {
	({ main } = await import(cliUrl.href));
} catch (e) {
	console.error("找不到独立包 ncm2audio。请确认它与 Firefly 处于同一级目录：");
	console.error("  alo_program/\n  ├── Firefly/\n  └── ncm2audio/");
	console.error(`  原始错误：${e.message}`);
	process.exitCode = 2;
}

if (main) process.exitCode = await main(process.argv.slice(2));
