import client from 'prom-client';
import { Request, Response, NextFunction } from 'express';

export class Metrics {
  private static instance: Metrics;
  private httpRequestDuration: client.Histogram<string>;
  private httpRequestsTotal: client.Counter<string>;

  private constructor() {
    client.collectDefaultMetrics();

    this.httpRequestDuration = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    });

    this.httpRequestsTotal = new client.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });
  }

  static getInstance() {
    if (!Metrics.instance) {
      Metrics.instance = new Metrics();
    }
    return Metrics.instance;
  }

  middleware = (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/metrics') {
      return next();
    }

    const end = this.httpRequestDuration.startTimer();

    res.on('finish', () => {
      const route = req.route?.path || req.path;
      const labels = {
        method: req.method,
        route,
        status_code: res.statusCode.toString(),
      };
      end(labels);
      this.httpRequestsTotal.inc(labels);
    });

    next();
  };

  endpoint = async (_req: Request, res: Response) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  };
}
