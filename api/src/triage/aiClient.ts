import type { Config } from '../config.js';

export interface Entity { type: string; value: string; span: [number, number]; source: string }

export interface AnalyzeResult {
  category: string;
  categoryProbs: Record<string, number>;
  needsHumanTriage: boolean;
  topKeywords: string[];
  entities: Entity[];
  severityHits: number;
  embedding: number[];
  modelVersion: string;
}

export interface AiClient {
  analyze(text: string): Promise<AnalyzeResult>;
  scoreAnomalies(family: AnomalyFamily, rows: AnomalyRow[]): Promise<AnomalyResult[]>;
}

export class HttpAiClient implements AiClient {
  constructor(private cfg: Config) {}

  async analyze(text: string): Promise<AnalyzeResult> {
    const r = await fetch(new URL('/analyze', this.cfg.AI_SERVICE_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ai-secret': this.cfg.AI_SHARED_SECRET },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`AI service ${r.status}`);
    return (await r.json()) as AnalyzeResult;
  }

  scoreAnomalies(family: AnomalyFamily, rows: AnomalyRow[]) {
    return scoreAnomaliesHttp(this.cfg, family, rows);
  }
}

export type AnomalyFamily = 'lifecycle' | 'access' | 'sensor';
export interface AnomalyRow { subject: string; day: string; features: Record<string, number> }
export interface AnomalyReason { feature: string; value: number; baseline: number; z: number; basis: string }
export interface AnomalyResult { subject: string; day: string; score: number; anomalous: boolean; explanation: AnomalyReason[] }

export async function scoreAnomaliesHttp(cfg: Config, family: AnomalyFamily, rows: AnomalyRow[]): Promise<AnomalyResult[]> {
  const r = await fetch(new URL('/anomaly/score', cfg.AI_SERVICE_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ai-secret': cfg.AI_SHARED_SECRET },
    body: JSON.stringify({ family, rows }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`AI service ${r.status}`);
  return ((await r.json()) as { results: AnomalyResult[] }).results;
}
