import { runProbabilityEngine } from '@/src/lib/probability-engine';

function main() {
  const output = runProbabilityEngine({
    mu: 13,
    sigma: 1.4,
    minTemp: 8,
    maxTemp: 20,
    minContinuous: 12,
    maxContinuous: 14,
    binLabels: ['<=11°C', '12°C', '13°C', '14°C', '15°C', '>=16°C']
  });
  console.log(JSON.stringify(output.debugSummary, null, 2));
}

main();

