import type { SessionTokenUsage, StdinData } from './types.js';
import { isBedrockModelId, isVertexModelId } from './stdin.js';
import { getPricing, cachedToModelPricing } from './pricing-cache.js';

type ModelPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadMultiplier?: number;   // default 0.1 (Anthropic)
  cacheWriteMultiplier?: number;  // default 1.25 (Anthropic)
};

export interface SessionCostEstimate {
  totalUsd: number;
  inputUsd: number;
  cacheCreationUsd: number;
  cacheReadUsd: number;
  outputUsd: number;
}

export interface SessionCostDisplay {
  totalUsd: number;
  totalCny: number;
  source: 'native' | 'estimate';
}

const TOKENS_PER_MILLION = 1_000_000;
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

// Approximate USD to CNY exchange rate (~6.75 as of 2026-05)
// Updated periodically; consider fetching from an API for auto-updates
export const CNY_PER_USD = 6.75;

// Patterns are tried in order; the first match wins. Families with more specific
// model lines (Haiku 4.x differs from Haiku 3.5) must come before any broader
// fallback patterns to avoid silent under-pricing.
const ANTHROPIC_MODEL_PRICING: Array<{ pattern: RegExp; pricing: ModelPricing }> = [
  { pattern: /\bopus 4(?: \d+)?\b/i, pricing: { inputUsdPerMillion: 15, outputUsdPerMillion: 75 } },
  { pattern: /\bsonnet 4(?: \d+)?\b/i, pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 } },
  { pattern: /\bsonnet 3 7\b/i, pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 } },
  { pattern: /\bsonnet 3 5\b/i, pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 } },
  { pattern: /\bhaiku 4(?: \d+)?\b/i, pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 5 } },
  { pattern: /\bhaiku 3 5\b/i, pricing: { inputUsdPerMillion: 0.8, outputUsdPerMillion: 4 } },
  // Enterprise plan aliases (e.g. opusplan, sonnetplan, haikuplan)
  { pattern: /\bopusplan\b/i, pricing: { inputUsdPerMillion: 15, outputUsdPerMillion: 75 } },
  { pattern: /\bsonnetplan\b/i, pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 } },
  { pattern: /\bhaikuplan\b/i, pricing: { inputUsdPerMillion: 0.8, outputUsdPerMillion: 4 } },
];

function normalizeModelName(modelName: string): string {
  return modelName
    .toLowerCase()
    .replace(/^claude\s+/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchAnthropicPricing(modelName: string): ModelPricing | null {
  const normalized = normalizeModelName(modelName);
  for (const entry of ANTHROPIC_MODEL_PRICING) {
    if (entry.pattern.test(normalized)) {
      return entry.pricing;
    }
  }
  return null;
}

function calculateUsd(tokens: number, usdPerMillion: number): number {
  return (tokens * usdPerMillion) / TOKENS_PER_MILLION;
}

function getAnthropicPricing(stdin: StdinData): ModelPricing | null {
  const candidates = [
    stdin.model?.display_name?.trim(),
    stdin.model?.id?.trim(),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    // 优先从缓存定价获取（覆盖 DeepSeek / Qwen / GLM / Kimi 等国产模型）
    const cached = getPricing();
    const cachedPricing = cachedToModelPricing(candidate, cached);
    if (cachedPricing) {
      return cachedPricing;
    }

    const pricing = matchAnthropicPricing(candidate);
    if (pricing) {
      return pricing;
    }
  }

  return null;
}

export function estimateSessionCost(
  stdin: StdinData,
  sessionTokens: SessionTokenUsage | undefined,
): SessionCostEstimate | null {
  if (!sessionTokens) {
    return null;
  }

  if (isBedrockModelId(stdin.model?.id)) {
    return null;
  }

  if (isVertexModelId(stdin.model?.id)) {
    return null;
  }

  const pricing = getAnthropicPricing(stdin);
  if (!pricing) {
    return null;
  }

  const totalTokens = sessionTokens.inputTokens
    + sessionTokens.cacheCreationTokens
    + sessionTokens.cacheReadTokens
    + sessionTokens.outputTokens;
  if (totalTokens === 0) {
    return null;
  }

  const cacheReadMul = pricing.cacheReadMultiplier ?? CACHE_READ_MULTIPLIER;
  const cacheWriteMul = pricing.cacheWriteMultiplier ?? CACHE_WRITE_MULTIPLIER;

  // API 的 input_tokens 已包含 cache_creation_input_tokens 和 cache_read_input_tokens，
  // 减去缓存部分避免重复计费：inputTokens = 纯输入 + 缓存写入 + 缓存读取
  const regularInputTokens = Math.max(0,
    sessionTokens.inputTokens - sessionTokens.cacheCreationTokens - sessionTokens.cacheReadTokens,
  );
  const inputUsd = calculateUsd(regularInputTokens, pricing.inputUsdPerMillion);
  const cacheCreationUsd = calculateUsd(sessionTokens.cacheCreationTokens, pricing.inputUsdPerMillion * cacheWriteMul);
  const cacheReadUsd = calculateUsd(sessionTokens.cacheReadTokens, pricing.inputUsdPerMillion * cacheReadMul);
  const outputUsd = calculateUsd(sessionTokens.outputTokens, pricing.outputUsdPerMillion);

  return {
    totalUsd: inputUsd + cacheCreationUsd + cacheReadUsd + outputUsd,
    inputUsd,
    cacheCreationUsd,
    cacheReadUsd,
    outputUsd,
  };
}

function getNativeCostUsd(stdin: StdinData): number | null {
  const nativeCost = stdin.cost?.total_cost_usd;
  if (typeof nativeCost !== 'number' || !Number.isFinite(nativeCost)) {
    return null;
  }

  if (isBedrockModelId(stdin.model?.id)) {
    return null;
  }

  if (isVertexModelId(stdin.model?.id)) {
    return null;
  }

  // Skip native cost for third-party API providers (DeepSeek / Qwen / GLM / Kimi 等)
  // since Claude Code's internal cost estimate uses Anthropic pricing which is way off
  const modelId = stdin.model?.id?.toLowerCase() ?? '';
  const knownThirdParty = ['deepseek', 'qwen', 'glm', 'kimi', 'baichuan', 'yi-', 'minimax', 'step-'];
  if (knownThirdParty.some(prefix => modelId.includes(prefix))) {
    return null;
  }

  return nativeCost;
}

export function resolveSessionCost(
  stdin: StdinData,
  sessionTokens: SessionTokenUsage | undefined,
): SessionCostDisplay | null {
  const nativeCostUsd = getNativeCostUsd(stdin);
  if (nativeCostUsd !== null) {
    return {
      totalUsd: nativeCostUsd,
      totalCny: nativeCostUsd * CNY_PER_USD,
      source: 'native',
    };
  }

  const estimate = estimateSessionCost(stdin, sessionTokens);
  if (!estimate) {
    return null;
  }

  return {
    totalUsd: estimate.totalUsd,
    totalCny: estimate.totalUsd * CNY_PER_USD,
    source: 'estimate',
  };
}

export function formatUsd(amount: number): string {
  if (amount >= 1) {
    return `$${amount.toFixed(2)}`;
  }
  if (amount >= 0.1) {
    return `$${amount.toFixed(3)}`;
  }
  return `$${amount.toFixed(4)}`;
}

export function formatCny(amount: number): string {
  if (amount >= 1) {
    return `¥${amount.toFixed(2)}`;
  }
  if (amount >= 0.01) {
    return `¥${amount.toFixed(2)}`;
  }
  if (amount >= 0.0001) {
    return `¥${amount.toFixed(4)}`;
  }
  return `< ¥0.0001`;
}
