import { Stan } from 'node-nats-streaming';
import { context, propagation } from '@opentelemetry/api';
import { Subjects } from './subjects';
import { Logger } from '../logger';

interface Event {
  subject: Subjects;
  data: any;
}

const logger = new Logger('nats');

export abstract class Publisher<T extends Event> {
  abstract subject: T['subject'];
  protected client: Stan;

  constructor(client: Stan) {
    this.client = client;
  }

  publish(data: T['data']): Promise<void> {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);

    const dataWithTrace = { ...data, _traceContext: carrier };

    return new Promise((resolve, reject) => {
      this.client.publish(this.subject, JSON.stringify(dataWithTrace), (err) => {
        if (err) {
          return reject(err);
        }
        logger.info('Event published', { subject: this.subject });
        resolve();
      });
    });
  }
}
