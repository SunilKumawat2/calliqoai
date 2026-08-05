/**
 * Prometheus-compatible Metrics Collector
 */
export class MetricsCollector {
  private static instance: MetricsCollector | null = null;
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) MetricsCollector.instance = new MetricsCollector();
    return MetricsCollector.instance;
  }

  incrementCounter(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) || 0) + value);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  recordHistogram(name: string, value: number): void {
    const values = this.histograms.get(name) || [];
    values.push(value);
    if (values.length > 1000) values.shift();
    this.histograms.set(name, values);
  }

  // Track voice engine specific metrics
  trackCallStart(): void { this.incrementCounter('ve_calls_total'); this.setGauge('ve_active_calls', (this.gauges.get('ve_active_calls') || 0) + 1); }
  trackCallEnd(durationMs: number): void { this.setGauge('ve_active_calls', Math.max(0, (this.gauges.get('ve_active_calls') || 0) - 1)); this.recordHistogram('ve_call_duration_ms', durationMs); }
  trackSttLatency(ms: number): void { this.recordHistogram('ve_stt_latency_ms', ms); }
  trackLlmLatency(ms: number): void { this.recordHistogram('ve_llm_latency_ms', ms); }
  trackTtsLatency(ms: number): void { this.recordHistogram('ve_tts_latency_ms', ms); }
  trackError(type: string): void { this.incrementCounter(`ve_errors_total_${type}`); }

  /** Prometheus text format */
  toPrometheusFormat(): string {
    const lines: string[] = [];
    for (const [name, value] of this.counters) lines.push(`# TYPE ${name} counter\n${name} ${value}`);
    for (const [name, value] of this.gauges) lines.push(`# TYPE ${name} gauge\n${name} ${value}`);
    for (const [name, values] of this.histograms) {
      if (values.length === 0) continue;
      const sum = values.reduce((a, b) => a + b, 0);
      const avg = sum / values.length;
      const p50 = this.percentile(values, 0.5);
      const p95 = this.percentile(values, 0.95);
      const p99 = this.percentile(values, 0.99);
      lines.push(`# TYPE ${name} summary\n${name}{quantile="0.5"} ${p50}\n${name}{quantile="0.95"} ${p95}\n${name}{quantile="0.99"} ${p99}\n${name}_sum ${sum}\n${name}_count ${values.length}\n${name}_avg ${avg.toFixed(2)}`);
    }
    return lines.join('\n\n');
  }

  getSnapshot(): Record<string, any> {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histogramSummaries: Object.fromEntries(
        Array.from(this.histograms.entries()).map(([k, v]) => [k, { count: v.length, avg: v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : 0, p95: this.percentile(v, 0.95) }])
      ),
    };
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }
}
