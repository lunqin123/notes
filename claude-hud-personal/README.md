# Claude HUD — 个人设置 v1

基于 [claude-hud](https://github.com/jarrodwatts/claude-hud) 的定制版本，增加了国产模型定价、人民币费用显示、缓存命中率监控等功能。

## 修改的文件

| 文件 | 改动说明 |
|------|---------|
| `src/cost.ts` | 费用计算 + CNY 支持 + DeepSeek 及国产模型定价 + 跳过原生费用 |
| `src/pricing-cache.ts` | 定价缓存系统 + 18 款国产模型默认定价 + 价格变化检测 |
| `src/pricing-fetcher.ts` | 后台拉取 DeepSeek 官网定价 + 新旧价格比对通知 |
| `src/config.ts` | 新增 `costCurrency`、`showCacheHitRate`、`cacheHitRate` 元素 |
| `src/render/lines/cost.ts` | 费用展示（¥ 高亮 + 价格变化通知） |
| `src/render/lines/cache-hit-rate.ts` | **新文件** — 缓存命中率展示（3位小数） |
| `src/render/lines/index.ts` | 导出 cache-hit-rate |
| `src/render/index.ts` | 接入 cacheHitRate 元素渲染 |
| `src/render/session-line.ts` | compact 模式下的缓存命中率 + CNY 费用 |
| `src/i18n/en.ts` | 新增 `label.cacheHitRate` |
| `src/i18n/zh.ts` | 新增 `label.cacheHitRate` |
| `src/i18n/types.ts` | 新增 `label.cacheHitRate` |

## HUD 配置

`~/.claude/plugins/claude-hud/config.json`:

```json
{
  "language": "en",
  "lineLayout": "expanded",
  "showSeparators": false,
  "display": {
    "showTools": false,
    "showAgents": false,
    "showTodos": false,
    "showProject": true,
    "showConfigCounts": true,
    "showTokenBreakdown": true,
    "showSpeed": true,
    "showUsage": true,
    "showDuration": true,
    "showSessionName": true,
    "showSessionTokens": true,
    "showCost": true
  },
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": false,
    "showFileStats": false
  }
}
```

## 安装位置

`~/.claude/plugins/cache/claude-hud/claude-hud/0.1.0/`

1. 将 `src/` 文件覆盖到插件源目录
2. 执行 `npm run build` 编译
3. 确保 `~/.claude/settings.json` 中 `statusLine` 指向该版本
