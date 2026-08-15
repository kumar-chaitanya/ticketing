import Queue from 'bull';
import { context, propagation } from '@opentelemetry/api';
import { ExpirationCompletePublisher } from '../events/publishers/expiration-complete-publisher';
import { natsWrapper } from '../nats-wrapper';
import { logger } from '../logger';

interface Payload {
  orderId: string;
  _traceContext?: Record<string, string>;
}

const expirationQueue = new Queue<Payload>('order:expiration', {
  redis: {
    host: process.env.REDIS_HOST,
  },
});

expirationQueue.process(async (job) => {
  const { orderId, _traceContext } = job.data;
  const parentCtx = propagation.extract(context.active(), _traceContext || {});

  await context.with(parentCtx, async () => {
    logger.info('Processing order expiration job', { orderId });

    await new ExpirationCompletePublisher(natsWrapper.client).publish({
      orderId,
    });
  });
});

export { expirationQueue };
