import type { FusionOutput, SourceBreakdown } from '@/src/lib/fusion-engine/types';

function topWeightedSources(items: SourceBreakdown[], n = 2) {
  return [...items].sort((a, b) => b.finalWeight - a.finalWeight).slice(0, n);
}

function biasDescription(item: SourceBreakdown) {
  const drift = item.adjustedPredictedMaxTemp - item.rawPredictedMaxTemp;
  if (Math.abs(drift) < 0.15) return '校准后变化较小';
  if (drift > 0) return '历史上偏冷，已上修';
  return '历史上偏热，已下修';
}

export function buildFusionExplanation(
  output: FusionOutput,
  scenarioLabel: 'stable_sunny' | 'suppressed_heating' | 'neutral'
) {
  const tops = topWeightedSources(output.sourceBreakdown, 2);
  const topText = tops
    .map((t) => `${t.sourceName}(权重${(t.finalWeight * 100).toFixed(1)}%，时段系数${(t.regimeScore ?? 1).toFixed(2)}，${biasDescription(t)})`)
    .join('、');

  const warmSources = output.sourceBreakdown.filter((s) => s.adjustedPredictedMaxTemp > output.fusedTemp + 0.6).map((s) => s.sourceName);
  const coolSources = output.sourceBreakdown.filter((s) => s.adjustedPredictedMaxTemp < output.fusedTemp - 0.6).map((s) => s.sourceName);

  const dominantOutcome = [...output.outcomeProbabilities].sort((a, b) => b.probability - a.probability)[0];

  const scenarioText =
    scenarioLabel === 'stable_sunny'
      ? '当前场景偏稳定升温（低云量、低降水、短时仍在升温）'
      : scenarioLabel === 'suppressed_heating'
        ? '当前场景偏压温（云量/降水/升温动能至少一项不利）'
        : '当前场景中性';

  const warmText = warmSources.length ? `偏热来源：${warmSources.join('、')}` : '无明显偏热来源';
  const coolText = coolSources.length ? `偏冷来源：${coolSources.join('、')}` : '无明显偏冷来源';

  return `${scenarioText}。高权重来源主要是：${topText}。${warmText}；${coolText}。融合结果为 ${output.fusedTemp.toFixed(1)}°C，分布峰值在 ${dominantOutcome.label}（概率 ${(dominantOutcome.probability * 100).toFixed(1)}%）。`;
}
