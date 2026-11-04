// 全应用图标的单一来源。
//
// 为什么要有这个文件：界面里原来混着三套东西——emoji（🗒📁🗑🔒📌◐🔍）、
// 文字字形（⇅ ✎ ↑ ↓ ✕）、和手写 SVG。emoji 是彩色位图：不跟随主题、
// 基线对不齐、深色模式下发脏，小尺寸尤其明显。这里统一成单色描边 SVG，
// 全部继承 currentColor，亮暗自动跟随。
//
// 规格：20×20 视框、stroke 1.75、round 端点/连接、不填充。
// 想调整某个图标只改这一处，全局生效。

const svg = (paths, size = 18) =>
  `<svg viewBox="0 0 20 20" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

// 全部笔记：一页纸 + 几行字
export const iconAllNotes = (s) =>
  svg(`<path d="M5 2.5h7.5L16 6v11.5H5z"/><path d="M12 2.5V6h4"/>
       <line x1="7.5" y1="9.5" x2="13" y2="9.5"/>
       <line x1="7.5" y1="12.5" x2="11" y2="12.5"/>`, s);

export const iconFolder = (s) =>
  svg(`<path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 2h6a1.5 1.5 0 0 1 1.5 1.5v7
       a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z"/>`, s);

export const iconTrash = (s) =>
  svg(`<path d="M3.5 5.5h13"/><path d="M8 5.5V3.5h4v2"/>
       <path d="M5 5.5l.8 11a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9l.8-11"/>
       <line x1="8.5" y1="8.5" x2="8.8" y2="14"/>
       <line x1="11.5" y1="8.5" x2="11.2" y2="14"/>`, s);

// 上锁（笔记列表的小锁 / 工具栏加密按钮 / 锁屏大图标共用）
export const iconLock = (s) =>
  svg(`<rect x="4" y="8.5" width="12" height="8.5" rx="2"/>
       <path d="M7 8.5V6a3 3 0 0 1 6 0v2.5"/>
       <circle cx="10" cy="12.7" r="1"/>`, s);

// 置顶：一枚图钉
export const iconPin = (s) =>
  svg(`<path d="M12.5 2.8l4.7 4.7-2 .5-3.4 3.4.4 3.4-1.2 1.2-6.6-6.6 1.2-1.2 3.4.4
       3.4-3.4z"/><line x1="6.6" y1="13.4" x2="3" y2="17"/>`, s);

// 排序：上下双箭头
export const iconSort = (s) =>
  svg(`<path d="M6.5 12.5v-9"/><path d="M4 6l2.5-2.5L9 6"/>
       <path d="M13.5 7.5v9"/><path d="M11 14l2.5 2.5L16 14"/>`, s);

// 新建笔记：一支笔
export const iconPencil = (s) =>
  svg(`<path d="M14.2 3.3a1.8 1.8 0 0 1 2.5 2.5L7.4 15.1l-3.4 1 1-3.4z"/>
       <line x1="12.8" y1="4.7" x2="15.3" y2="7.2"/>`, s);

export const iconArrowUp = (s) =>
  svg(`<path d="M10 16V4.5"/><path d="M5.5 9L10 4.5 14.5 9"/>`, s);

export const iconArrowDown = (s) =>
  svg(`<path d="M10 4v11.5"/><path d="M14.5 11L10 15.5 5.5 11"/>`, s);

export const iconClose = (s) =>
  svg(`<line x1="5.5" y1="5.5" x2="14.5" y2="14.5"/>
       <line x1="14.5" y1="5.5" x2="5.5" y2="14.5"/>`, s);

export const iconSearch = (s) =>
  svg(`<circle cx="9" cy="9" r="5"/><line x1="12.8" y1="12.8" x2="16.5" y2="16.5"/>`, s);

// 亮/暗切换：半边填实的圆，一眼看出是"对比度/明暗"
export const iconTheme = (s = 18) =>
  `<svg viewBox="0 0 20 20" width="${s}" height="${s}" fill="none"
    stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">
    <circle cx="10" cy="10" r="6.75"/>
    <path d="M10 3.25a6.75 6.75 0 0 0 0 13.5z" fill="currentColor" stroke="none"/>
  </svg>`;

// Touch ID：指纹
export const iconFingerprint = (s) =>
  svg(`<path d="M10 3.2c-1.6 0-3 .6-4.1 1.6"/>
       <path d="M3.4 7.2A7 7 0 0 1 10 3.2a7 7 0 0 1 6.6 4"/>
       <path d="M6.6 16.4A9 9 0 0 0 6 12a4 4 0 0 1 8 0c0 1.6-.2 3-.6 4.4"/>
       <path d="M9 16.8c-.3-1.5-.4-3.1-.4-4.8a1.4 1.4 0 0 1 2.8 0c0 1.7-.1 3.3-.4 4.8"/>`, s);

// 折叠本节：两条横线夹一个向下的箭头（收起成一行）
export const iconFold = (s) =>
  svg(`<line x1="3.5" y1="4.5" x2="16.5" y2="4.5"/>
       <line x1="3.5" y1="15.5" x2="16.5" y2="15.5"/>
       <path d="M7.5 8.5L10 11l2.5-2.5"/>`, s);

// 折叠三角：展开态朝下，折叠态朝右（在 CSS 里旋转）
export const iconChevron = (s = 15) =>
  svg(`<path d="M5.5 8L10 12.5 14.5 8"/>`, s);
