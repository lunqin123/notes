# Claude HUD — 个人定制版

基于 [claude-hud](https://github.com/jarrodwatts/claude-hud) 的深度定制版本，专为使用国产模型（DeepSeek / 通义千问 / 智谱 / Kimi 等）的 Claude Code 用户设计。

## 功能特色

- **国产模型定价支持** — 内置 18 款国产模型定价（DeepSeek、Qwen、GLM、Kimi、百川、Yi、MiniMax、Step）
- **人民币费用显示** — HUD 费用以 ¥ 为单位实时显示，支持 USD/CNY/双币种切换
- **自动定价拉取** — 后台自动从 DeepSeek 官网拉取最新定价，价格变化时在 HUD 中通知
- **缓存命中率** — 实时显示 Prompt Cache 命中率（精确到小数点后 3 位）
- **多策略定价解析** — 应对官网页面格式变化，Markdown 表格 / HTML 表格 / 宽松正则三重兜底
- **缓存计费修正** — 修复上游 `input_tokens` 包含缓存 token 导致的重复计费问题
- **汇率更新** — 支持按当前汇率换算 USD/CNY

## 修改说明

| 文件 | 改动 |
|------|------|
| `src/cost.ts` | 新增人民币费用计算；修复缓存 token 双重计费；更新汇率（7.2→6.75） |
| `src/pricing-cache.ts` | 18 款国产模型硬编码定价；三重策略定价页解析器；价格变化检测与通知 |
| `src/pricing-fetcher.ts` | 后台子进程拉取 DeepSeek 官网定价；新旧价格比对并生成通知 |
| `src/config.ts` | 新增 `costCurrency`（`usd`/`cny`/`both`）、`showCacheHitRate` 等配置项 |
| `src/render/lines/cost.ts` | 费用渲染行（¥ 高亮 + 价格变化通知） |
| `src/render/lines/cache-hit-rate.ts` | 缓存命中率渲染（分母修正为 `input_tokens`，避免低估） |
| `src/render/lines/index.ts` | 导出 cache-hit-rate |
| `src/render/index.ts` | 接入 cacheHitRate 元素渲染 |
| `src/render/session-line.ts` | compact 模式下集成缓存命中率 + 人民币费用 |
| `src/i18n/en.ts` `zh.ts` `types.ts` | 新增 i18n 词条 |

## 安装

### 前置要求

- Claude Code 已安装
- Node.js 18+

### 步骤

```bash
# 1. 克隆或复制 src/ 到插件目录
cp -r src/* ~/.claude/plugins/cache/claude-hud/claude-hud/0.1.0/src/

# 2. 进入插件目录并编译
cd ~/.claude/plugins/cache/claude-hud/claude-hud/0.1.0
npm ci
npm run build

# 3. 配置 settings.json
# 编辑 ~/.claude/settings.json，确保 statusLine 指向已编译的 HUD 入口
```

## 配置

编辑 `~/.claude/plugins/claude-hud/config.json`（或复制本项目根目录的 `config.json`）：

```json
{
  "language": "en",
  "lineLayout": "expanded",
  "showSeparators": false,
  "display": {
    "showCost": true,
    "costCurrency": "cny",
    "showCacheHitRate": true,
    "showSessionTokens": true,
    "showSpeed": true,
    // ... 其他显示选项
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `showCost` | boolean | `false` | 显示费用估算 |
| `costCurrency` | `"usd"` / `"cny"` / `"both"` | `"cny"` | 费用显示币种 |
| `showCacheHitRate` | boolean | `true` | 显示缓存命中率 |

## 费用计算细节

HUD 从 Claude Code 转录文件中累计每一轮对话的 token 用量并估算费用：

```
费用 = regularInput × 输入单价
     + cacheCreation × 输入单价 × cacheWriteMul
     + cacheRead × 输入单价 × cacheReadMul
     + output × 输出单价
```

> **注意**：Anthropic API 的 `input_tokens` 已包含 `cache_creation_input_tokens` 和 `cache_read_input_tokens`。本定制版已修正上游的重复计费 bug，减去缓存部分后再计算纯输入费用。

对于 DeepSeek 等国产模型，Claude Code 自身的费用估算（基于 Anthropic 定价）不准确，本定制版使用硬编码或从官网拉取的最新定价进行计算。

## 文件结构

```
src/
├── cost.ts            # 费用计算核心（USD + CNY 双币种）
├── pricing-cache.ts   # 定价缓存系统 + 多策略 HTML 解析
├── pricing-fetcher.ts # 后台定价拉取 + 价格变更通知
├── config.ts          # 配置加载与校验
├── render/
│   ├── index.ts       # 渲染入口
│   ├── session-line.ts  # compact 模式主行
│   └── lines/
│       ├── cost.ts        # 费用渲染行
│       └── cache-hit-rate.ts  # 缓存命中率渲染行
└── i18n/              # 国际化（中/英）
```

## 内置定价模型

- **DeepSeek**: V4-Flash (`¥1/¥2/¥0.02`)、V4-Pro (`¥3/¥6/¥0.025` 限时优惠)
- **通义千问**: Turbo、Plus、Max
- **智谱**: GLM-4-Flash、GLM-4、GLM-5
- **月之暗面**: Kimi-Small、Kimi-K2.5
- **百川**: Baichuan2/3-Turbo
- **零一万物**: Yi-Medium、Yi-Large
- **MiniMax**: Lite、M2.5
- **阶跃星辰**: Step-3.5-Flash、Step-3

> 定价可能随厂商调整而变化。DeepSeek 定价会通过后台拉取自动更新，其余模型需要手动更新硬编码值。
