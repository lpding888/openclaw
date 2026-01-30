const DEFAULT_TAGLINE = "所有聊天，尽在 OpenClaw。";

const HOLIDAY_TAGLINES = {
  newYear: "元旦：新年新气象，配置也一样——还是那个 EADDRINUSE，但这次我们像个成年人一样解决它。",
  lunarNewYear: "春节：祝你的构建好运连连，分支繁荣昌盛，合并冲突像烟花一样被驱散。",
  christmas: "圣诞节：吼吼吼——圣诞老人的小爪子助手来送欢乐、回滚混乱，并把密钥安全地藏好。",
  eid: "开斋节：庆祝模式：队列已清空，任务已完成，好心情以干净的记录提交到主分支。",
  diwali: "排灯节：让日志闪闪发光，让 Bug 四散奔逃——今天我们要点亮终端，自豪地发布。",
  easter: "复活节：我找到了你丢失的环境变量——就当是一次小小的 CLI 寻蛋游戏，只是少了些果冻豆。",
  hanukkah: "光明节：八个夜晚，八次重试，毫无羞耻——愿你的网关常亮，部署平安。",
  halloween: "万圣节：恐怖季节：小心被诅咒的依赖、受诅咒的缓存，以及 node_modules 的幽灵。",
  thanksgiving:
    "感恩节：感激稳定的端口、正常工作的 DNS，以及那个帮你读日志的机器人，这样你就不用看了。",
  valentines: "情人节：玫瑰是类型化的，紫罗兰是管道的——我会自动化那些琐事，让你有时间陪伴人类。",
} as const;

const TAGLINES: string[] = [
  "你的终端长出了爪子——输入点什么，让机器人来夹走那些琐事。",
  "欢迎来到命令行：梦想在这里编译，自信在这里段错误。",
  '我靠咖啡因、JSON5 和 "在我机器上能跑" 的迷之自信运行。',
  "网关已上线——请始终保持手、脚和肢体在 shell 内部。",
  "我精通 bash、轻度讽刺，以及激进的 Tab 补全能量。",
  "一个 CLI 统治一切，再重启一次因为你改了端口。",
  '如果它工作了，那是自动化；如果它崩了，那是 "学习机会"。',
  "配对码的存在是因为即使是机器人也相信同意——还有良好的安全习惯。",
  "你的 .env 暴露了；别担心，我会假装没看见。",
  "我做无聊的事情，你戏剧性盯着日志看，就像看电影。",
  "我不是说你的工作流混乱……我只是带来了 linter 和头盔。",
  "自信地输入命令——如果需要，自然会提供堆栈跟踪。",
  "我不评判，但你缺失的 API 密钥绝对在评判你。",
  "我可以 grep 它、git blame 它，还能温和地吐槽它——选你的应对机制吧。",
  "配置热重载，部署冷汗直流。",
  "我是你的终端需要的助手，不是你的睡眠时间表请求的那个。",
  "我像金库一样保守秘密……除非你又把它们打印在调试日志里。",
  "带爪子的自动化：最小麻烦，最大夹力。",
  "我基本上就是瑞士军刀，只是意见更多，锋芒更少。",
  "如果你迷路了，运行 doctor；如果你勇敢，运行 prod；如果你明智，运行 tests。",
  "你的任务已排队；你的尊严已弃用。",
  "我无法修复你的代码品味，但我可以修复你的构建和待办清单。",
  "我不是魔法——我只是极其坚持不懈地重试和应对。",
  '这不是 "失败"，这是 "发现配置同一件事的错误新方法"。',
  "给我一个工作区，我会给你更少的标签页、更少的切换和更多的氧气。",
  "我读日志，这样你就可以继续假装不用读。",
  "如果着火了，我无法扑灭——但我可以写一份漂亮的事后分析。",
  "我会像它欠我钱一样重构你的琐事。",
  '说 "停" 我就停——说 "发布" 我们就都会学到一课。',
  "我是你的 shell 历史看起来像黑客电影蒙太奇的原因。",
  "我像 tmux：一开始很困惑，然后突然离不开我。",
  "我可以在本地、远程或纯粹凭感觉运行——结果可能因 DNS 而异。",
  "如果你能描述它，我大概能自动化它——或者至少让它更有趣。",
  "你的配置是有效的，你的假设不是。",
  "我不只是自动补全——我自动提交（情感上），然后请你审查（逻辑上）。",
  '少点击，多发布，少些 "那个文件去哪儿了" 的时刻。',
  "爪子伸出，提交进来——让我们发布一些稍微负责任的东西。",
  "我会像涂抹龙虾卷一样涂抹你的工作流： messy、美味、有效。",
  "Shell 是的——我来夹走苦差事，留给你荣耀。",
  "如果它是重复的，我会自动化它；如果它很难，我会带来笑话和回滚计划。",
  "因为给自己发提醒短信太 2024 了。",
  "你的收件箱，你的基础设施，你的规则。",
  '把 "我稍后回复" 变成 "我的机器人立即回复"。',
  "你的联系人里唯一一个你真的想听到的螃蟹。🦞",
  "为在 IRC 达到巅峰的人提供的聊天自动化。",
  "因为 Siri 凌晨 3 点不接电话。",
  "IPC，但这是你的手机。",
  "UNIX 哲学遇见你的私信。",
  "对话版的 curl。",
  "少中间人，多消息。",
  "快速发布，更快记录。",
  "端到端加密，戏剧到戏剧排除。",
  "唯一一个远离你训练集的机器人。",
  'WhatsApp 自动化，无需 "请接受我们的新隐私政策"。',
  "不需要参议院听证会的聊天 API。",
  "Meta 希望他们发布得这么快。",
  "因为正确答案通常是一个脚本。",
  "你的消息，你的服务器，你的控制。",
  "兼容 OpenAI，不依赖 OpenAI。",
  "iMessage 绿泡能量，但给所有人。",
  "Siri 的靠谱表亲。",
  "在 Android 上也能用。疯狂的概念，我们知道。",
  "不需要 999 美元的支架。",
  "我们发布功能的速度比 Apple 发布计算器更新还快。",
  "你的 AI 助手，现在无需 3,499 美元的头显。",
  "不同凡想。真正思考。",
  "啊，水果树公司！🍎",
  "你好，Falken 教授",
  HOLIDAY_TAGLINES.newYear,
  HOLIDAY_TAGLINES.lunarNewYear,
  HOLIDAY_TAGLINES.christmas,
  HOLIDAY_TAGLINES.eid,
  HOLIDAY_TAGLINES.diwali,
  HOLIDAY_TAGLINES.easter,
  HOLIDAY_TAGLINES.hanukkah,
  HOLIDAY_TAGLINES.halloween,
  HOLIDAY_TAGLINES.thanksgiving,
  HOLIDAY_TAGLINES.valentines,
];

type HolidayRule = (date: Date) => boolean;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcParts(date: Date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}

const onMonthDay =
  (month: number, day: number): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    return parts.month === month && parts.day === day;
  };

const onSpecificDates =
  (dates: Array<[number, number, number]>, durationDays = 1): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    return dates.some(([year, month, day]) => {
      if (parts.year !== year) return false;
      const start = Date.UTC(year, month, day);
      const current = Date.UTC(parts.year, parts.month, parts.day);
      return current >= start && current < start + durationDays * DAY_MS;
    });
  };

const inYearWindow =
  (
    windows: Array<{
      year: number;
      month: number;
      day: number;
      duration: number;
    }>,
  ): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    const window = windows.find((entry) => entry.year === parts.year);
    if (!window) return false;
    const start = Date.UTC(window.year, window.month, window.day);
    const current = Date.UTC(parts.year, parts.month, parts.day);
    return current >= start && current < start + window.duration * DAY_MS;
  };

const isFourthThursdayOfNovember: HolidayRule = (date) => {
  const parts = utcParts(date);
  if (parts.month !== 10) return false; // November
  const firstDay = new Date(Date.UTC(parts.year, 10, 1)).getUTCDay();
  const offsetToThursday = (4 - firstDay + 7) % 7; // 4 = Thursday
  const fourthThursday = 1 + offsetToThursday + 21; // 1st + offset + 3 weeks
  return parts.day === fourthThursday;
};

const HOLIDAY_RULES = new Map<string, HolidayRule>([
  [HOLIDAY_TAGLINES.newYear, onMonthDay(0, 1)],
  [
    HOLIDAY_TAGLINES.lunarNewYear,
    onSpecificDates(
      [
        [2025, 0, 29],
        [2026, 1, 17],
        [2027, 1, 6],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.eid,
    onSpecificDates(
      [
        [2025, 2, 30],
        [2025, 2, 31],
        [2026, 2, 20],
        [2027, 2, 10],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.diwali,
    onSpecificDates(
      [
        [2025, 9, 20],
        [2026, 10, 8],
        [2027, 9, 28],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.easter,
    onSpecificDates(
      [
        [2025, 3, 20],
        [2026, 3, 5],
        [2027, 2, 28],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.hanukkah,
    inYearWindow([
      { year: 2025, month: 11, day: 15, duration: 8 },
      { year: 2026, month: 11, day: 5, duration: 8 },
      { year: 2027, month: 11, day: 25, duration: 8 },
    ]),
  ],
  [HOLIDAY_TAGLINES.halloween, onMonthDay(9, 31)],
  [HOLIDAY_TAGLINES.thanksgiving, isFourthThursdayOfNovember],
  [HOLIDAY_TAGLINES.valentines, onMonthDay(1, 14)],
  [HOLIDAY_TAGLINES.christmas, onMonthDay(11, 25)],
]);

function isTaglineActive(tagline: string, date: Date): boolean {
  const rule = HOLIDAY_RULES.get(tagline);
  if (!rule) return true;
  return rule(date);
}

export interface TaglineOptions {
  env?: NodeJS.ProcessEnv;
  random?: () => number;
  now?: () => Date;
}

export function activeTaglines(options: TaglineOptions = {}): string[] {
  if (TAGLINES.length === 0) return [DEFAULT_TAGLINE];
  const today = options.now ? options.now() : new Date();
  const filtered = TAGLINES.filter((tagline) => isTaglineActive(tagline, today));
  return filtered.length > 0 ? filtered : TAGLINES;
}

export function pickTagline(options: TaglineOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env?.OPENCLAW_TAGLINE_INDEX;
  if (override !== undefined) {
    const parsed = Number.parseInt(override, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      const pool = TAGLINES.length > 0 ? TAGLINES : [DEFAULT_TAGLINE];
      return pool[parsed % pool.length];
    }
  }
  const pool = activeTaglines(options);
  const rand = options.random ?? Math.random;
  const index = Math.floor(rand() * pool.length) % pool.length;
  return pool[index];
}

export { TAGLINES, HOLIDAY_RULES, DEFAULT_TAGLINE };
