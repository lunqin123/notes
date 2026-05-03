import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as https from 'node:https';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getHudPluginDir } from './claude-config-dir.js';

const CACHE_FILENAME = 'pricing-cache.json';
const CHANGE_FILENAME = 'price-change.json';
const FETCH_LOCK_FILENAME = '.pricing-fetching';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // 24h 缓存有效期
const FETCH_LOCK_TTL_MS = 5 * 60 * 1000;     // 5min 锁避免并发
const CHANGE_NOTIFY_TTL_MS = 60 * 60 * 1000; // 价格变化通知保留 1 小时
const CNY_PER_USD = 7.2;

export interface CachedModelPricing {
  inputCnyPerMillion: number;
  outputCnyPerMillion: number;
  cacheHitCnyPerMillion: number;
}

export interface CachedPricing {
  fetchedAt: number;
  source: 'hardcoded' | 'web';
  models: Record<string, CachedModelPricing>;
}

// 硬编码默认定价（官网拉取失败时的回退）
// 覆盖主流国产模型：DeepSeek、通义千问、智谱、月之暗面、百川、零一万物、MiniMax、阶跃星辰
const HARDCODED_PRICING: CachedPricing = {
  fetchedAt: 0,
  source: 'hardcoded',
  models: {
    // DeepSeek
    'deepseek-v4-flash': { inputCnyPerMillion: 1, outputCnyPerMillion: 2, cacheHitCnyPerMillion: 0.02 },
    'deepseek-v4-pro': { inputCnyPerMillion: 3, outputCnyPerMillion: 6, cacheHitCnyPerMillion: 0.025 },
    // 通义千问 (阿里巴巴)
    'qwen-turbo': { inputCnyPerMillion: 0.5, outputCnyPerMillion: 1, cacheHitCnyPerMillion: 0.05 },
    'qwen-plus': { inputCnyPerMillion: 2.2, outputCnyPerMillion: 6.6, cacheHitCnyPerMillion: 0.22 },
    'qwen-max': { inputCnyPerMillion: 8, outputCnyPerMillion: 24, cacheHitCnyPerMillion: 0.8 },
    // 智谱 GLM
    'glm-4-flash': { inputCnyPerMillion: 0.5, outputCnyPerMillion: 1, cacheHitCnyPerMillion: 0.05 },
    'glm-4': { inputCnyPerMillion: 4.8, outputCnyPerMillion: 14.4, cacheHitCnyPerMillion: 0.48 },
    'glm-5': { inputCnyPerMillion: 4, outputCnyPerMillion: 12, cacheHitCnyPerMillion: 0.4 },
    // 月之暗面 Kimi
    'kimi-small': { inputCnyPerMillion: 1, outputCnyPerMillion: 2, cacheHitCnyPerMillion: 0.1 },
    'kimi-k2.5': { inputCnyPerMillion: 6, outputCnyPerMillion: 12, cacheHitCnyPerMillion: 0.6 },
    // 百川智能
    'baichuan2-turbo': { inputCnyPerMillion: 8, outputCnyPerMillion: 8, cacheHitCnyPerMillion: 0.8 },
    'baichuan3-turbo': { inputCnyPerMillion: 12, outputCnyPerMillion: 12, cacheHitCnyPerMillion: 1.2 },
    // 零一万物 Yi
    'yi-medium': { inputCnyPerMillion: 2.5, outputCnyPerMillion: 2.5, cacheHitCnyPerMillion: 0.25 },
    'yi-large': { inputCnyPerMillion: 20, outputCnyPerMillion: 20, cacheHitCnyPerMillion: 2 },
    // MiniMax
    'minimax-lite': { inputCnyPerMillion: 0.8, outputCnyPerMillion: 1.5, cacheHitCnyPerMillion: 0.08 },
    'minimax-m2.5': { inputCnyPerMillion: 2.2, outputCnyPerMillion: 17.5, cacheHitCnyPerMillion: 0.22 },
    // 阶跃星辰 Step
    'step-3.5-flash': { inputCnyPerMillion: 0.73, outputCnyPerMillion: 2.19, cacheHitCnyPerMillion: 0.073 },
    'step-3': { inputCnyPerMillion: 1.54, outputCnyPerMillion: 4.16, cacheHitCnyPerMillion: 0.154 },
  },
};

function getCacheDir(homeDir: string): string {
  const dir = path.join(getHudPluginDir(homeDir), 'pricing-cache');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

function getCachePath(homeDir: string): string {
  return path.join(getCacheDir(homeDir), CACHE_FILENAME);
}

function getLockPath(homeDir: string): string {
  return path.join(getCacheDir(homeDir), FETCH_LOCK_FILENAME);
}

function readCache(homeDir: string): CachedPricing | null {
  try {
    const content = fs.readFileSync(getCachePath(homeDir), 'utf8');
    const parsed = JSON.parse(content) as CachedPricing;
    if (parsed.models && typeof parsed.fetchedAt === 'number') {
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function writeCache(homeDir: string, data: CachedPricing): void {
  try {
    fs.writeFileSync(getCachePath(homeDir), JSON.stringify(data, null, 2), 'utf8');
  } catch { /* ignore */ }
}

function isCacheFresh(cache: CachedPricing): boolean {
  return cache.fetchedAt > 0 && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS;
}

function canAcquireLock(homeDir: string): boolean {
  const lockPath = getLockPath(homeDir);
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs < FETCH_LOCK_TTL_MS) {
      return false; // Lock still valid
    }
  } catch { /* no lock file */ }
  try {
    fs.writeFileSync(lockPath, String(Date.now()));
    return true;
  } catch { return false; }
}

/**
 * 从 DeepSeek 定价页面提取最新定价。
 * 返回 null 表示拉取失败。
 */
export function fetchLatestPricing(): Promise<CachedPricing | null> {
  return new Promise((resolve) => {
    const url = new URL('https://api-docs.deepseek.com/zh-cn/quick_start/pricing/');
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        const parsed = parsePricingPage(data);
        resolve(parsed);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * 解析 DeepSeek 定价页面的 HTML，提取模型定价。
 *
 * 页面中包含定价表格，格式如下:
 * | deepseek-v4-flash | 1元 | 2元 | 0.02元 |
 * | deepseek-v4-pro   | 3元 | 6元 | 0.025元 |
 */
function parsePricingPage(html: string): CachedPricing | null {
  const models: Record<string, CachedModelPricing> = {};
  let foundAny = false;

  // 查找定价表格行: 匹配 | 模型名 | 输入价 | 输出价 | 缓存价 | 这类模式
  const rowPattern = /\|\s*(deepseek-v4-\w+)\s*\|\s*([\d.]+)\s*元[^|]*\|\s*([\d.]+)\s*元[^|]*\|\s*([\d.]+)\s*元/g;
  let match: RegExpExecArray | null;

  while ((match = rowPattern.exec(html)) !== null) {
    const [, modelName, inputPrice, outputPrice, cacheHitPrice] = match;
    models[modelName] = {
      inputCnyPerMillion: parseFloat(inputPrice),
      outputCnyPerMillion: parseFloat(outputPrice),
      cacheHitCnyPerMillion: parseFloat(cacheHitPrice),
    };
    foundAny = true;
  }

  if (!foundAny) return null;

  return {
    fetchedAt: Date.now(),
    source: 'web',
    models,
  };
}

/**
 * 获取当前最新定价：
 * 1. 优先读缓存（24h内有效）
 * 2. 缓存过期时返回硬编码默认值，并在后台触发异步拉取
 * 3. 后台拉取完成后写入缓存，下次 HUD 渲染时自动使用新定价
 */
export function getPricing(homeDir: string = os.homedir()): CachedPricing {
  const cached = readCache(homeDir);
  if (cached && isCacheFresh(cached)) {
    return cached;
  }

  // 缓存过期或缺席 — 异步触发后台拉取（不阻塞当前渲染）
  if (canAcquireLock(homeDir)) {
    triggerBackgroundFetch(homeDir);
  }

  return cached ?? HARDCODED_PRICING;
}

/**
 * 将缓存定价转换为 cost.ts 所需的 ModelPricing（USD 格式）
 */
export function cachedToModelPricing(
  modelName: string,
  pricing: CachedPricing,
): { inputUsdPerMillion: number; outputUsdPerMillion: number; cacheReadMultiplier: number; cacheWriteMultiplier: number } | null {
  const modelKey = findModelKey(modelName, pricing.models);
  if (!modelKey) return null;

  const m = pricing.models[modelKey];
  const inputUsd = m.inputCnyPerMillion / CNY_PER_USD;
  const outputUsd = m.outputCnyPerMillion / CNY_PER_USD;
  const cacheReadMul = m.cacheHitCnyPerMillion / m.inputCnyPerMillion;
  const cacheWriteMul = 1.0; // DeepSeek 不额外收取缓存写入费

  return { inputUsdPerMillion: inputUsd, outputUsdPerMillion: outputUsd, cacheReadMultiplier: cacheReadMul, cacheWriteMultiplier: cacheWriteMul };
}

function findModelKey(modelName: string, models: Record<string, unknown>): string | null {
  const lower = modelName.toLowerCase();
  // Exact match first
  if (models[lower]) return lower;
  // Fuzzy match: e.g. "deepseek-v4-flash[1m]" matches "deepseek-v4-flash"
  for (const key of Object.keys(models)) {
    if (lower.startsWith(key) || key.startsWith(lower)) return key;
  }
  return null;
}

/**
 * 启动子进程在后台拉取最新定价（不阻塞当前 HUD 渲染）
 */
function triggerBackgroundFetch(homeDir: string): void {
  const scriptPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'pricing-fetcher.js',
  );

  if (!fs.existsSync(scriptPath)) return;

  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, CLAUDE_HUD_HOME: homeDir },
  });
  child.unref();
}

/** 获取最近的价格变化通知（1 小时内有效） */
export interface PriceChangeNotification {
  detectedAt: number;
  summary: string;
}

export function getRecentPriceChange(homeDir: string = os.homedir()): PriceChangeNotification | null {
  try {
    const changePath = path.join(getCacheDir(homeDir), CHANGE_FILENAME);
    if (!fs.existsSync(changePath)) return null;

    const raw = fs.readFileSync(changePath, 'utf8');
    const data = JSON.parse(raw);
    if (typeof data.detectedAt !== 'number' || !data.summary) return null;

    // 超过 1 小时的通知不再展示
    if (Date.now() - data.detectedAt > CHANGE_NOTIFY_TTL_MS) return null;

    return { detectedAt: data.detectedAt, summary: data.summary };
  } catch {
    return null;
  }
}
