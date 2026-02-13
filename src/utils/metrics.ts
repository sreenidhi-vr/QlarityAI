/**
 * Metrics and Telemetry System
 * Provides simple in-memory counters and duration tracking for monitoring
 * the unified orchestrator across Slack and Teams platforms
 */

export interface MetricLabels {
  [key: string]: string;
}

export interface CounterMetric {
  name: string;
  value: number;
  labels: MetricLabels;
  lastUpdated: number;
}

export interface DurationMetric {
  name: string;
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  labels: MetricLabels;
  lastUpdated: number;
}

export interface MetricsSnapshot {
  counters: CounterMetric[];
  durations: DurationMetric[];
  timestamp: number;
  uptime: number;
}

class MetricsCollector {
  private counters: Map<string, CounterMetric> = new Map();
  private durations: Map<string, DurationMetric> = new Map();
  private startTime: number = Date.now();

  /**
   * Increment a counter metric
   */
  incrementCounter(metric: string, labels: MetricLabels = {}): void {
    const key = this.createKey(metric, labels);
    const existing = this.counters.get(key);

    if (existing) {
      existing.value += 1;
      existing.lastUpdated = Date.now();
    } else {
      this.counters.set(key, {
        name: metric,
        value: 1,
        labels,
        lastUpdated: Date.now()
      });
    }

    console.debug('[Metrics] Counter incremented', {
      metric,
      labels,
      newValue: this.counters.get(key)?.value
    });
  }

  /**
   * Record a duration metric
   */
  recordDuration(metric: string, durationMs: number, labels: MetricLabels = {}): void {
    const key = this.createKey(metric, labels);
    const existing = this.durations.get(key);

    if (existing) {
      existing.count += 1;
      existing.totalMs += durationMs;
      existing.avgMs = existing.totalMs / existing.count;
      existing.minMs = Math.min(existing.minMs, durationMs);
      existing.maxMs = Math.max(existing.maxMs, durationMs);
      existing.lastUpdated = Date.now();
    } else {
      this.durations.set(key, {
        name: metric,
        count: 1,
        totalMs: durationMs,
        avgMs: durationMs,
        minMs: durationMs,
        maxMs: durationMs,
        labels,
        lastUpdated: Date.now()
      });
    }

    console.debug('[Metrics] Duration recorded', {
      metric,
      labels,
      durationMs,
      avgMs: this.durations.get(key)?.avgMs
    });
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): MetricsSnapshot {
    return {
      counters: Array.from(this.counters.values()),
      durations: Array.from(this.durations.values()),
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime
    };
  }

  /**
   * Get counter value
   */
  getCounter(metric: string, labels: MetricLabels = {}): number {
    const key = this.createKey(metric, labels);
    return this.counters.get(key)?.value || 0;
  }

  /**
   * Get duration stats
   */
  getDuration(metric: string, labels: MetricLabels = {}): DurationMetric | null {
    const key = this.createKey(metric, labels);
    return this.durations.get(key) || null;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.durations.clear();
    this.startTime = Date.now();
    console.log('[Metrics] All metrics reset');
  }

  /**
   * Clean up old metrics (older than specified age)
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    let cleanedCounters = 0;
    let cleanedDurations = 0;

    // Clean counters
    for (const [key, metric] of this.counters.entries()) {
      if (metric.lastUpdated < cutoff) {
        this.counters.delete(key);
        cleanedCounters++;
      }
    }

    // Clean durations
    for (const [key, metric] of this.durations.entries()) {
      if (metric.lastUpdated < cutoff) {
        this.durations.delete(key);
        cleanedDurations++;
      }
    }

    console.log('[Metrics] Cleanup completed', {
      cleanedCounters,
      cleanedDurations,
      maxAgeHours: maxAgeMs / (60 * 60 * 1000)
    });
  }

  /**
   * Create unique key for metric with labels
   */
  private createKey(metric: string, labels: MetricLabels): string {
    const labelString = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
    
    return labelString ? `${metric}{${labelString}}` : metric;
  }

  /**
   * Get metrics summary for logging
   */
  getSummary(): {
    totalCounters: number;
    totalDurations: number;
    topCounters: Array<{ name: string; value: number; labels: MetricLabels }>;
    topDurations: Array<{ name: string; avgMs: number; count: number; labels: MetricLabels }>;
  } {
    const counters = Array.from(this.counters.values());
    const durations = Array.from(this.durations.values());

    // Sort and get top metrics
    const topCounters = counters
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map(c => ({ name: c.name, value: c.value, labels: c.labels }));

    const topDurations = durations
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(d => ({ name: d.name, avgMs: d.avgMs, count: d.count, labels: d.labels }));

    return {
      totalCounters: counters.length,
      totalDurations: durations.length,
      topCounters,
      topDurations
    };
  }
}

// Global metrics instance
export const metrics = new MetricsCollector();

// Predefined metric names for consistency
export const MetricNames = {
  // Orchestrator metrics
  ORCHESTRATOR_CALLS_TOTAL: 'orchestrator_calls_total',
  ORCHESTRATOR_SUCCESS_TOTAL: 'orchestrator_success_total',
  ORCHESTRATOR_ERROR_TOTAL: 'orchestrator_error_total',
  RAG_PROCESSING_DURATION_MS: 'rag_processing_duration_ms',
  
  // Platform metrics
  SLACK_EVENTS_TOTAL: 'slack_events_total',
  SLACK_COMMANDS_TOTAL: 'slack_commands_total',
  SLACK_ACTIONS_TOTAL: 'slack_actions_total',
  SLACK_DELIVERY_TOTAL: 'slack_delivery_total',
  SLACK_DELIVERY_DURATION_MS: 'slack_delivery_duration_ms',
  
  TEAMS_ACTIVITIES_TOTAL: 'teams_activities_total',
  TEAMS_DELIVERY_TOTAL: 'teams_delivery_total',
  TEAMS_DELIVERY_DURATION_MS: 'teams_delivery_duration_ms',
  
  // Validation metrics
  VALIDATION_FAILURES_TOTAL: 'validation_failures_total',
  FOLLOWUP_MODAL_OPENS_TOTAL: 'followup_modal_opens_total',
  
  // Error metrics
  RATE_LIMIT_HITS_TOTAL: 'rate_limit_hits_total',
  AUTH_FAILURES_TOTAL: 'auth_failures_total'
} as const;

// Helper function to start timing
export function startTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}

// Middleware helper for automatic duration tracking
export function withMetrics<T extends (...args: any[]) => any>(
  fn: T,
  metricName: string,
  labels: MetricLabels = {}
): T {
  return ((...args: any[]) => {
    const timer = startTimer();
    
    try {
      const result = fn(...args);
      
      // Handle async functions
      if (result && typeof result.then === 'function') {
        return result
          .then((value: any) => {
            metrics.recordDuration(metricName, timer(), { ...labels, status: 'success' });
            return value;
          })
          .catch((error: any) => {
            metrics.recordDuration(metricName, timer(), { ...labels, status: 'error' });
            throw error;
          });
      } else {
        // Sync function
        metrics.recordDuration(metricName, timer(), { ...labels, status: 'success' });
        return result;
      }
    } catch (error) {
      metrics.recordDuration(metricName, timer(), { ...labels, status: 'error' });
      throw error;
    }
  }) as T;
}

// Auto-cleanup old metrics every hour
setInterval(() => {
  metrics.cleanup();
}, 60 * 60 * 1000);

// Log metrics summary every 5 minutes in development
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    const summary = metrics.getSummary();
    if (summary.totalCounters > 0 || summary.totalDurations > 0) {
      console.log('[Metrics] Summary', summary);
    }
  }, 5 * 60 * 1000);
}

export default metrics;