import type { RenderContext } from '../../types.js';
import { resolveSessionCost, formatUsd, formatCny } from '../../cost.js';
import { getRecentPriceChange } from '../../pricing-cache.js';
import { t } from '../../i18n/index.js';
import { label, cyan, yellow } from '../colors.js';

export function renderCostEstimate(ctx: RenderContext): string | null {
  const priceChange = getRecentPriceChange();

  if (ctx.config?.display?.showCost !== true) {
    // 即使关闭费用显示，价格变化通知仍然显示
    return priceChange ? yellow(`📢 ${priceChange.summary}`) : null;
  }

  const cost = resolveSessionCost(ctx.stdin, ctx.transcript.sessionTokens);
  if (!cost) {
    return priceChange ? yellow(`📢 ${priceChange.summary}`) : null;
  }

  const currency = ctx.config?.display?.costCurrency ?? 'cny';
  const labelKey = cost.source === 'native' ? 'label.cost' : 'label.estimatedCost';

  let costStr: string;
  if (currency === 'usd') {
    costStr = formatUsd(cost.totalUsd);
  } else if (currency === 'both') {
    costStr = `${formatCny(cost.totalCny)} (${formatUsd(cost.totalUsd)})`;
  } else {
    costStr = formatCny(cost.totalCny);
  }

  let result = `${label(t(labelKey), ctx.config?.colors)} ${cyan(costStr)}`;

  // 检查最近的价格变化（1小时内），有变化时追加通知
  if (priceChange) {
    result += ` ${yellow(`📢 ${priceChange.summary}`)}`;
  }

  return result;
}
