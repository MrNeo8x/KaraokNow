import { Injectable } from '@nestjs/common';

interface RequestMetric {
  count: number;
  durationSeconds: number;
}

@Injectable()
export class RequestMetricsService {
  private readonly requests = new Map<string, RequestMetric>();

  observe(method: string, statusCode: number, durationSeconds: number): void {
    const key = `${method.toUpperCase()}|${statusCode}`;
    const metric = this.requests.get(key) ?? { count: 0, durationSeconds: 0 };
    metric.count += 1;
    metric.durationSeconds += durationSeconds;
    this.requests.set(key, metric);
  }

  renderPrometheus(): string {
    const lines = [
      '# HELP karaokenow_http_requests_total Completed HTTP requests by method and status.',
      '# TYPE karaokenow_http_requests_total counter'
    ];
    for (const [key, metric] of [...this.requests.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const [method, status] = key.split('|');
      lines.push(`karaokenow_http_requests_total{method="${method}",status="${status}"} ${metric.count}`);
    }
    lines.push(
      '# HELP karaokenow_http_request_duration_seconds_sum Sum of completed HTTP request durations.',
      '# TYPE karaokenow_http_request_duration_seconds_sum counter'
    );
    for (const [key, metric] of [...this.requests.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const [method, status] = key.split('|');
      lines.push(`karaokenow_http_request_duration_seconds_sum{method="${method}",status="${status}"} ${metric.durationSeconds.toFixed(6)}`);
    }
    return `${lines.join('\n')}\n`;
  }
}
