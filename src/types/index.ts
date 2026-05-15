
export type SamplingMethod = 'StopOrGo' | 'MUS' | 'Attribute' | 'Random' | 'FixedRandom' | 'Cluster' | 'CVS' | 'Benford' | 'Pareto' | 'Percentile' | 'Grubbs' | 'RiskAssessment';
export type CVSSubMethod = 'MeanPerUnit' | 'Difference' | 'Ratio';
export type AnomalyMethod = 'ModifiedZ' | 'None';
export type Language = 'en' | 'ua';
export type Currency = 'UAH' | 'USD' | 'EUR';

export interface GlobalSettings {
  region: 'ua' | 'us' | 'eu'; // ua = Kyiv, us = US, eu = Generic EU
  dateFormat: 'dd.mm.yyyy' | 'mm/dd/yyyy' | 'yyyy-mm-dd';
  numberSeparator: 'space_comma' | 'comma_dot' | 'dot_comma'; // 1 000,00 vs 1,000.00 vs 1.000,00
  language: Language;
  currency: Currency;
}

export interface ColumnIndices {
  id: number;
  date: number;
  amount: number;
}

export interface TransactionItem {
  id: string | number;
  amount: number;
  date: string; // Stored strictly as YYYY-MM-DD
  originalRow: any[];
  // For sampling results
  isKeyItem?: boolean;
  isSampled?: boolean;
  cumulativeValue?: number; // For MUS
}

export interface GoogleConfig {
  clientId: string;
  apiKey: string;
}

export interface SamplingConfig {
  method: SamplingMethod;
  cvsSubMethod?: CVSSubMethod;
  anomalyMethod: AnomalyMethod;
  confidenceLevel: 70 | 80 | 90 | 95 | 99;
  tolerableMisstatement: number; // Performance Materiality
  expectedMisstatement: number; // Amount (for CVS)
  expectedErrorRate?: number; // Percent 0-10 (for MUS)
  
  // Attribute Sampling specific
  tolerableDeviationRate?: number; // TDR (3-20%)
  expectedDeviationRate?: number; // EDR (0-4%)
  
  clearlyTrivialThreshold: number; // Items below this are ignored
  riskFactor: 'High' | 'Moderate' | 'Low';
  numberOfClusters?: number;
  seed?: number; // For reproducibility
  
  // New Params for additional methods
  fixedSampleSize?: number; // For Fixed Random
  percentileCount?: number; // e.g. 5 for Top 5% / Bottom 5%
  paretoCoverage?: number; // e.g. 80 for Pareto
  grubbsAlpha?: number; // e.g. 0.05
  stopOrGoInitialSize?: number; // Stage 1
  stopOrGoExpansionSize?: number; // Stage 2
  benfordSampleSize?: number; // Sample size for Benford anomalies
  isolationTrees?: number; // For Isolation Forest (Legacy/Removed, kept in interface just in case or can be removed)

  // Risk Assessment Specific
  riskClosingDays?: number;
  riskRandomCount?: number;
  riskWeekend?: boolean;
  riskHoliday?: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  totalValue: number;
  itemCount: number;
  negativeCount: number;
  zeroCount: number; // New: Track zero value items
  duplicateCount: number; // New: Track duplicate IDs
}

export interface SampledItem extends TransactionItem {
  bookValue: number;
  auditedValue: number | ''; 
  difference: number;
  tainting: number;
  selectionReason?: string; // Generalized reason
  clusterId?: number;
  anomalyScore?: number; // For Isolation Forest / Grubbs G-Score
  comments?: string; // Auditor comments
}

export interface ClusterMeta {
  id: number;
  min: number;
  max: number;
  count: number;
  centroid: number;
}

// New Interface for Benford Analysis Details
export interface DigitStat {
  digit: number;
  count: number;
  actualProp: number;
  expectedProp: number;
  diffProp: number;
  zScore: number;
  isAnomaly: boolean; // Z > 1.96
  direction: 'over' | 'under';
}

export interface BenfordStats {
  digits: DigitStat[];
  mad: number;
  madInterpretation: 'Close' | 'Acceptable' | 'Marginal' | 'Nonconformity';
  chiSquare: number;
  isChiSqSignificant: boolean; // > 15.507
}

export interface SamplingResult {
  populationSize: number;
  populationValue: number;
  trivialCount: number;
  trivialValue: number;
  areTrivialExcluded: boolean;
  sampleSize: number;
  sampleValue: number;
  samplingInterval: number;
  keyItems: SampledItem[];
  samplingItems: SampledItem[];
  excludedItems?: TransactionItem[]; // Items below CTT
  projectedMisstatement: number;
  upperMisstatementBound: number;
  statisticalStats?: {
    mean: number;
    stdDev: number;
    threshold: number;
    median?: number;
    mad?: number;
  };
  clusters?: ClusterMeta[];
  benfordStats?: BenfordStats;
}

export interface ProjectState {
  version: string;
  timestamp: string;
  settings: GlobalSettings;
  config: SamplingConfig;
  population: TransactionItem[];
  results: SamplingResult | null;
  sourceHeaders: string[];
  columnIndices: ColumnIndices;
}

/**
 * Елемент генеральної сукупності
 */
export interface PopulationItem {
  id: string;
  bookValue: number;      // Облікова вартість
  auditValue?: number;    // Аудиторська вартість (після перевірки)
  description?: string;
  stratum?: string;       // Для стратифікованої вибірки
}

/**
 * Параметри вибірки
 */
export interface SamplingParams {
  population: PopulationItem[];
  tolerableMisstatement: number; // PM - Допустиме викривлення
  confidenceLevel: number;       // Рівень довіри (0.90, 0.95, 0.99)
  expectedError?: number;        // Очікувана помилка
  seed?: number;                 // Seed для відтворюваності
}

/**
 * Типи методів вибірки
 */
export type SamplingMethodType =
  | 'MUS'
  | 'RANDOM'
  | 'ATTRIBUTE'
  | 'STOP_OR_GO'
  | 'CVS'
  | 'CLUSTER'
  | 'BENFORD'
  | 'PARETO'
  | 'PERCENTILE';

/**
 * Аудиторський слід
 */
export interface AuditTrailEntry {
  id: string;
  timestamp: Date;
  action: string;
  method: SamplingMethodType;
  parameters: Record<string, unknown>;
  result: unknown;
  userId?: string;
}