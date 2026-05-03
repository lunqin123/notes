import type { RenderContext } from '../../types.js';
import { t } from '../../i18n/index.js';
import { label, getContextColor, RESET } from '../colors.js';

/**
 * Calculate the prompt cache hit rate from session token usage.
 *
 * Cache hit rate = cache_read_tokens / (input_tokens + cache_creation_tokens + cache_read_tokens)
 * This measures what percentage of the prompt (input) was served from cache.
 * Output tokens are excluded since they are never cached.
 */
function calcCacheHitRate(ctx: RenderContext): number | null {
  const tokens = ctx.transcript.sessionTokens;
  if (!tokens) {
    return null;
  }

  const denominator = tokens.inputTokens + tokens.cacheCreationTokens + tokens.cacheReadTokens;
  if (denominator === 0) {
    return null;
  }

  // Keep 3 decimal places for precision
  return Math.round((tokens.cacheReadTokens / denominator) * 100_000) / 1000;
}

export function renderCacheHitRateLine(
  ctx: RenderContext,
  _alignLabels = false,
): string | null {
  const display = ctx.config?.display;
  if (display?.showCacheHitRate === false) {
    return null;
  }

  const hitRate = calcCacheHitRate(ctx);
  if (hitRate === null) {
    // No token data yet — show nothing instead of "Cache --%"
    return null;
  }

  const colors = ctx.config?.colors;
  // Use context color to visually gauge the rate
  const color = getContextColor(hitRate, colors);

  return `${label(t('label.cacheHitRate'), colors)} ${color}${hitRate.toFixed(3)}%${RESET}`;
}
