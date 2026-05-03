/**
 * DeepSeek 定价后台拉取脚本。
 * 由 pricing-cache.ts 通过 child_process.spawn 在后台启动，
 * 完成 HTTP 请求并将最新定价写入缓存文件，供下次 HUD 渲染使用。
 * 如果价格发生变化，同时写入 price-change.json 以触发通知。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getHudPluginDir } from './claude-config-dir.js';
import { fetchLatestPricing } from './pricing-cache.js';
import type { CachedModelPricing } from './pricing-cache.js';

const CACHE_FILENAME = 'pricing-cache.json';
const CHANGE_FILENAME = 'price-change.json';
const FETCH_LOCK_FILENAME = '.pricing-fetching';

interface PriceChangeEntry {
  model: string;
  field: string;
  oldValue: number;
  newValue: number;
}

interface PriceChangeNotification {
  detectedAt: number;
  changes: PriceChangeEntry[];
  summary: string;
}

function getCacheDir(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), 'pricing-cache');
}

function getCachePath(homeDir: string): string {
  return path.join(getCacheDir(homeDir), CACHE_FILENAME);
}

function getChangePath(homeDir: string): string {
  return path.join(getCacheDir(homeDir), CHANGE_FILENAME);
}

function getLockPath(homeDir: string): string {
  return path.join(getCacheDir(homeDir), FETCH_LOCK_FILENAME);
}

function releaseLock(homeDir: string): void {
  try { fs.unlinkSync(getLockPath(homeDir)); } catch { /* ignore */ }
}

/** 比较新旧定价，返回所有变化项 */
function diffPricing(
  oldModels: Record<string, CachedModelPricing>,
  newModels: Record<string, CachedModelPricing>,
): PriceChangeEntry[] {
  const changes: PriceChangeEntry[] = [];
  const allKeys = new Set([...Object.keys(oldModels), ...Object.keys(newModels)]);

  for (const key of allKeys) {
    const old = oldModels[key];
    const cur = newModels[key];
    if (!old && cur) {
      changes.push({ model: key, field: '新增', oldValue: 0, newValue: cur.inputCnyPerMillion });
    } else if (old && !cur) {
      changes.push({ model: key, field: '下架', oldValue: old.inputCnyPerMillion, newValue: 0 });
    } else if (old && cur) {
      if (old.inputCnyPerMillion !== cur.inputCnyPerMillion) {
        changes.push({ model: key, field: '输入', oldValue: old.inputCnyPerMillion, newValue: cur.inputCnyPerMillion });
      }
      if (old.outputCnyPerMillion !== cur.outputCnyPerMillion) {
        changes.push({ model: key, field: '输出', oldValue: old.outputCnyPerMillion, newValue: cur.outputCnyPerMillion });
      }
      if (old.cacheHitCnyPerMillion !== cur.cacheHitCnyPerMillion) {
        changes.push({ model: key, field: '缓存', oldValue: old.cacheHitCnyPerMillion, newValue: cur.cacheHitCnyPerMillion });
      }
    }
  }

  return changes;
}

/** 将变化列表转为简短摘要 */
function summarizeChanges(changes: PriceChangeEntry[]): string {
  const lines: string[] = [];
  for (const c of changes) {
    const arrow = c.newValue > c.oldValue ? '↑' : '↓';
    const pct = c.oldValue > 0 ? Math.round((c.newValue - c.oldValue) / c.oldValue * 100) : 0;
    const modelShort = c.model.replace('deepseek-', '');
    lines.push(`${modelShort} ${c.field}: ¥${c.oldValue}→¥${c.newValue} ${arrow}${Math.abs(pct)}%`);
  }
  return lines.join('; ');
}

async function main(): Promise<void> {
  const homeDir = process.env.CLAUDE_HUD_HOME || os.homedir();

  // 读取旧缓存
  let oldModels: Record<string, CachedModelPricing> = {};
  try {
    const oldRaw = fs.readFileSync(getCachePath(homeDir), 'utf8');
    const oldParsed = JSON.parse(oldRaw);
    if (oldParsed.models) oldModels = oldParsed.models;
  } catch { /* first fetch, no old data */ }

  const result = await fetchLatestPricing();
  if (result) {
    const cacheDir = getCacheDir(homeDir);
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch { /* ignore */ }

    // 比较价格变化
    if (Object.keys(oldModels).length > 0) {
      const changes = diffPricing(oldModels, result.models);
      if (changes.length > 0) {
        const notification: PriceChangeNotification = {
          detectedAt: Date.now(),
          changes,
          summary: summarizeChanges(changes),
        };
        fs.writeFileSync(getChangePath(homeDir), JSON.stringify(notification, null, 2), 'utf8');
      }
    }

    // 写入新缓存
    fs.writeFileSync(getCachePath(homeDir), JSON.stringify(result, null, 2), 'utf8');
  }

  releaseLock(homeDir);
  process.exit(0);
}

main().catch(() => process.exit(1));
