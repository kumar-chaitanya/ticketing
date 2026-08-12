import { Request, Response, NextFunction, RequestHandler } from 'express';
import { Logger } from '../logger';

export function requestLogger(logger: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/metrics') {
      return next();
    }

    const start = Date.now();

    res.on('finish', () => {
      logger.info('request completed', {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        responseTime: Date.now() - start,
      });
    });

    next();
  };
}
