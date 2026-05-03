# Claude Code 终端美化优化总结

## 概述

对 Claude Code 终端 CLI 进行了一系列 UI 美化和功能增强，包括自定义 HUD 状态栏、费用追踪（人民币）、缓存命中率监控、自动定价更新等。

---

## 1. 自定义 HUD 状态栏

**插件：** [claude-hud](https://github.com/jarrodwatts/claude-hud) v0.1.0

替代默认状态栏，多行显示实时信息，每 ~300ms 刷新一次。

### 默认显示行（expanded 模式）

```
[deepseek-v4-flash] │ ~/Desktop/Claude_projects git:(main)
上下文 ██░░░░░░░░ 24% │ 用量 █░░░░░░░░░ 7% (5h)
缓存命中 0.000% │ 估算 ¥0.05
```

- **第一行：** 模型名、项目路径、Git 分支
- **第二行：** 上下文进度条、用量配额（5h/7d）
- **第三行：** 缓存命中率（3位小数）、费用估算（¥）

### 配置位置

`~/.claude/plugins/claude-hud/config.json`

```json
{
  "language": "en",
  "lineLayout": "expanded",
  "display": {
    "showTools": false,
    "showAgents": false,
    "showTodos": false,
    "showProject": true,
    "showConfigCounts": true,
    "showSpeed": true,
    "showUsage": true,
    "showDuration": true,
    "showSessionName": true,
    "showSessionTokens": true,
    "showCost": true
  }
}
```

---

## 2. 费用显示（人民币 ¥）

**相关文件：** `cost.ts`

- 默认以 **人民币（¥）** 显示 API 使用费用
- 支持三种模式：`'cny'`（默认）、`'usd'`、`'both'`
- 汇率：1 USD ≈ 7.2 CNY
- 金额高亮：使用青色（cyan）显示，类似缓存命中率风格
- 格式化规则：
  - ≥ ¥1 → `¥1.23`
  - ≥ ¥0.01 → `¥0.05`
  - ≥ ¥0.0001 → `¥0.0050`
  - < ¥0.0001 → `< ¥0.0001`
- DeepSeek 模型跳过 Claude Code 原生费用估算，避免按 Anthropic 原价误算

---

## 3. 缓存命中率

**相关文件：** `cache-hit-rate.ts`

- 显示提示缓存命中百分比（3位小数），如 `缓存命中 75.123%`
- 公式：`cacheReadTokens / (inputTokens + cacheCreationTokens + cacheReadTokens) × 100%`
- 颜色分级：同上下文进度条（绿/黄/红），随命中率变化
- 会话累计统计，随每次 API 调用更新

---

## 4. DeepSeek 定价支持

**相关文件：** `cost.ts`、`pricing-cache.ts`、`pricing-fetcher.ts`

### 官方定价

| 模型 | 输入（/M tokens） | 输出（/M tokens） | 缓存命中（/M tokens） |
|------|------------------|------------------|--------------------|
| V4 Flash | ¥1 | ¥2 | ¥0.02 |
| V4 Pro (2.5折) | ¥3 | ¥6 | ¥0.025 |

### 缓存价格乘数

- Flash：缓存读取 = 输入价 × **2%**（非 Anthropic 的 10%）
- Pro：缓存读取 = 输入价 × **0.83%**
- 缓存写入（creation）：**不额外收费**（乘数 1.0，非 Anthropic 的 1.25）

---

## 5. 自动定价更新

**相关文件：** `pricing-cache.ts`、`pricing-fetcher.ts`

HUD 自动从 DeepSeek 官网拉取最新定价：

1. **缓存驱动：** 定价缓存文件 `~/.claude/plugins/claude-hud/pricing-cache/pricing-cache.json`
2. **有效期：** 24 小时
3. **后台拉取：** 缓存过期时，fork 子进程请求 `api-docs.deepseek.com/zh-cn/quick_start/pricing/`，解析定价表格
4. **防并发：** 文件锁机制，5 分钟冷却
5. **降级：** 官网不可用时自动回退硬编码默认定价

---

## 6. 模型配置

**配置位置：** `~/.claude/settings.json`

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_MODEL": "deepseek-v4-flash[1m]",
    "CLAUDE_CODE_EFFORT_LEVEL": "max"
  },
  "language": "中文",
  "model": "opus",
  "statusLine": { "type": "command", "command": "..." }
}
```

- 使用 DeepSeek V4 Flash/Pro 模型
- 语言设为中文
- Effort 级别 max
- 自定义 statusLine 加载 HUD 插件

---

## 7. 其他

| 项目 | 说明 |
|------|------|
| **语言** | 中文化交互 (`language: "中文"`) |
| **工具活动行** | 关闭（`showTools: false`、`showAgents: false`）减少干扰 |
| **缓存上下文** | context-cache 模块自动保存/恢复上下文窗口快照 |
| **通知音效** | Stop 和 PermissionRequest 钩子播放提示音 |

---

## 文件结构

```
~/.claude/
├── settings.json                    # 主配置
├── sounds/                          # 通知音效
└── plugins/
    └── cache/claude-hud/claude-hud/0.1.0/
        ├── src/
        │   ├── cost.ts              # 费用计算（含 CNY 支持）
        │   ├── pricing-cache.ts     # 定价缓存管理
        │   ├── pricing-fetcher.ts   # 后台定价拉取
        │   └── render/lines/
        │       ├── cache-hit-rate.ts # 缓存命中率展示
        │       └── cost.ts          # 费用展示（高亮）
        ├── dist/                    # 编译产物
        └── config.json              # HUD 插件配置
```
