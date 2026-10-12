import { backgroundWallpaper } from "@/config";

// 首页整屏壁纸随滚动淡出。
//
// 背景：首页的壁纸层被铺满整个视口（见 layout-base.css 的「三改」），正文卡片是半透明毛玻璃，
// 壁纸一直垫在下面会让亮背景干扰阅读。这里把三个背景层的透明度随滚动渐变到 0，
// 最终露出页面底色，只留文章。
//
// 为什么只淡出这三层、而不是它们的父容器 #wallpaper-wrapper：
//  1. wrapper 带 overflow:hidden，而图片/视频/遮罩在「三改」里是 position:fixed 逃出裁剪的；
//     给祖先加 opacity / will-change 会改变 fixed 子元素的包含块，整屏壁纸会被裁成 65vh 一条。
//  2. hero 标题所在的 #banner-overlay-container 在 fullscreen 模式下由
//     fullscreen-wallpaper-utils.ts 逐帧写 opacity（标题视差淡出），两边同时写会互相覆盖；
//     而 banner 模式下标题是绝对定位在页首的，滚动时本就会随页面上移离开视口，不需要淡出。
//
// 另外：背景视频播放时，BackgroundPlayer 用 [data-bg-video-playing] 的 !important 规则
// 把图片层与遮罩层压成 opacity:0，只留 #bg-player-overlay 可见，所以真正要淡的是它；
// 其余两层的内联写入会被 !important 覆盖，无害。
//
// 性能约束（与 fullscreen-wallpaper-utils.ts 同一套做法）：
//  - 滚动回调只置标志位，读写都在 rAF 里做
//  - 值未变化时不写（比较内联样式，读取不触发重排）
//  - 设备分档开关只在初始化 / 窗口尺寸变化时解析，不逐帧读 innerWidth
//  - will-change 只在淡出过程中挂上，回到不透明立即撤销
//    （常驻 will-change 会让整层长期驻留，本仓库有过残留发糊的先例，见 swup-transitions.ts）

const FADE_TARGET_IDS = [
	"banner-images-container", // 壁纸图（含轮播）
	"bg-player-overlay", // 背景视频
	"banner-dim-container", // 遮罩
] as const;

const OPACITY_STEP = 0.02; // 透明度量化步长
const DEFAULT_DISTANCE = 0.8; // 默认：滚动 0.8 倍视口高度后完全淡出
const DEFAULT_MIN_OPACITY = 0; // 默认：淡出到完全透明

type DeviceSwitch = boolean | { desktop: boolean; mobile: boolean } | undefined;

let ticking = false;
let initialized = false;
let enabledOnThisDevice = true;
let fadeDistance = DEFAULT_DISTANCE;
let fadeMinOpacity = DEFAULT_MIN_OPACITY;

/** 解析「布尔值 / 分设备对象」形态的开关，未配置视为开启 */
function resolveDeviceSwitch(value: DeviceSwitch): boolean {
	if (typeof value === "boolean") return value;
	if (!value) return true;
	return window.innerWidth < 1024 ? value.mobile : value.desktop;
}

/** 量化并格式化为固定两位小数，避免浮点噪声；空字符串表示移除内联样式 */
function formatOpacity(value: number): string {
	return (Math.round(value / OPACITY_STEP) * OPACITY_STEP).toFixed(2);
}

/**
 * 把同一个透明度写到三个背景层。
 * 空字符串 = 移除内联样式，把控制权交还 CSS（非首页 / 无壁纸 / 未启用 / 回到顶部时使用）。
 * 逐元素比较内联值再写，这样后出现的层也能被正确同步。
 */
function applyFadeToLayers(value: string): void {
	const shouldHint = value !== "";
	for (const id of FADE_TARGET_IDS) {
		const layer = document.getElementById(id);
		if (!layer) continue;
		if (value === "") {
			if (layer.style.opacity !== "") layer.style.removeProperty("opacity");
		} else if (layer.style.opacity !== value) {
			layer.style.opacity = value;
		}
		// 只在「正在淡出」期间提示合成层：透明度的合成不需要重栅格化，但前提是元素有自己的层
		const hinted = layer.style.getPropertyValue("will-change") === "opacity";
		if (shouldHint && !hinted) {
			layer.style.setProperty("will-change", "opacity");
		} else if (!shouldHint && hinted) {
			layer.style.removeProperty("will-change");
		}
	}
}

/** 按当前滚动位置同步壁纸透明度；可重复调用（切页 / 切模式 / 初始化后都调它） */
export function syncHomeWallpaperFade(): void {
	const isHome = document.body.classList.contains("is-home");
	const mode = document.documentElement.getAttribute("data-wallpaper-mode");
	if (!isHome || mode === "none" || !enabledOnThisDevice) {
		applyFadeToLayers("");
		return;
	}

	const scrollY = window.pageYOffset || document.documentElement.scrollTop;
	const fadeSpan = window.innerHeight * fadeDistance;
	const ratio = fadeSpan > 0 ? Math.min(scrollY / fadeSpan, 1) : 1;
	const opacity = 1 - ratio * (1 - fadeMinOpacity);
	// 首屏（ratio <= 0）不写内联样式，保持与默认渲染完全一致
	applyFadeToLayers(opacity >= 1 ? "" : formatOpacity(opacity));
}

function requestHomeWallpaperFade(): void {
	if (ticking) return;
	ticking = true;
	requestAnimationFrame(() => {
		ticking = false;
		syncHomeWallpaperFade();
	});
}

/** 视口变化：设备分档与淡出距离都跟视口有关，需要重新解析后再同步 */
function handleViewportResize(): void {
	enabledOnThisDevice = resolveDeviceSwitch(
		backgroundWallpaper.homeScrollFade?.enable,
	);
	requestHomeWallpaperFade();
}

/** 注册监听并做初始同步（由 layout-init 调用一次） */
export function initHomeWallpaperFade(): void {
	if (initialized) return;
	initialized = true;

	const config = backgroundWallpaper.homeScrollFade;
	enabledOnThisDevice = resolveDeviceSwitch(config?.enable);
	const distance = config?.distance;
	if (typeof distance === "number" && distance > 0) fadeDistance = distance;
	const minOpacity = config?.minOpacity;
	if (typeof minOpacity === "number" && minOpacity >= 0 && minOpacity <= 1) {
		fadeMinOpacity = minOpacity;
	}

	window.addEventListener("scroll", requestHomeWallpaperFade, {
		passive: true,
	});
	window.addEventListener("resize", handleViewportResize, { passive: true });
	window.addEventListener("wallpaperModeChange", requestHomeWallpaperFade);
	syncHomeWallpaperFade(); // 初始加载（浏览器可能恢复了滚动位置）
}
