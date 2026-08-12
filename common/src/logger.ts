import pino, { Logger as PinoLogger } from 'pino';

export class Logger {
  private readonly pino: PinoLogger;

  constructor(service: string) {
    this.pino = pino({
      level: process.env.LOG_LEVEL || 'info',
      base: { service },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  get instance() {
    return this.pino;
  }

  info(msg: string, obj?: object) {
    if (obj) {
      this.pino.info(obj, msg);
    } else {
      this.pino.info(msg);
    }
  }

  warn(msg: string, obj?: object) {
    if (obj) {
      this.pino.warn(obj, msg);
    } else {
      this.pino.warn(msg);
    }
  }

  error(msg: string, obj?: object) {
    if (obj) {
      this.pino.error(obj, msg);
    } else {
      this.pino.error(msg);
    }
  }

  debug(msg: string, obj?: object) {
    if (obj) {
      this.pino.debug(obj, msg);
    } else {
      this.pino.debug(msg);
    }
  }
}
