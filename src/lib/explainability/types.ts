export type CertaintyType = 'structural' | 'model' | 'mixed';

export type CertaintyReason =
  | 'narrow_truncation_window'
  | 'tight_upside_cap'
  | 'observed_floor_active'
  | 'high_source_consensus';

/**
 * CertaintySummary v1 (stable contract)
 *
 * Contract goal:
 * - Explain *why* a high probability is reasonable (or not) from an explainability perspective.
 * - Keep explanation concerns separate from trading-rule concerns.
 *
 * Boundary (important):
 * - This object is EXPLAINABILITY output only.
 * - It MUST NOT be used as a hard gate/trigger for BUY/WATCH/PASS.
 * - Trading decisions are still produced by the trading engine/rule chain.
 *
 * Field usage:
 * - Page display fields:
 *   - summaryZh
 *   - summaryEn
 *   - certaintyType
 * - Debug / analysis fields:
 *   - isStructuralCertainty
 *   - structuralReasons
 *   - widthFromL
 */
export type CertaintySummary = {
  /**
   * Whether high confidence is primarily explained by structural constraints
   * (e.g., narrow truncation window, tight upside cap).
   * Intended for debug/analysis labeling.
   */
  isStructuralCertainty: boolean;
  /**
   * Categorical certainty label for grouping and quick interpretation.
   * Used by page display and debug output.
   */
  certaintyType: CertaintyType;
  /**
   * Machine-readable structural reason tags.
   * Primary use is debug/analysis (including stability scripts).
   */
  structuralReasons: CertaintyReason[];
  /**
   * Human-readable Chinese explanation for direct page display.
   */
  summaryZh: string;
  /**
   * Human-readable English explanation for direct page display.
   */
  summaryEn: string;
  /**
   * Truncation interval width (U - L) if both bounds exist; null otherwise.
   * Debug/analysis only.
   */
  widthFromL: number | null;
};
