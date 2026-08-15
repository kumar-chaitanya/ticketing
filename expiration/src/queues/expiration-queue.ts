import Queue from 'bull';
import { context, propagation, trace } from '@opentelemetry/api';
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

  const linkedCtx = propagation.extract(context.active(), _traceContext || {});
  const linkedSpan = trace.getSpan(linkedCtx);
  const links = linkedSpan ? [{ context: linkedSpan.spanContext() }] : [];

  const tracer = trace.getTracer('expiration');
  const span = tracer.startSpan('process order expiration', { links });

  try {
    await context.with(trace.setSpan(context.active(), span), async () => {
      logger.info('Processing order expiration job', { orderId });

      await new ExpirationCompletePublisher(natsWrapper.client).publish({
        orderId,
      });
    });
  } finally {
    span.end();
  }
});

export { expirationQueue };
