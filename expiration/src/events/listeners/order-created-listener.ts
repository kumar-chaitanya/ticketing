import { Listener, OrderCreatedEvent, Subjects } from '@kumar-chaitanya/common-ticketing-service';
import { Message } from 'node-nats-streaming';
import { context, propagation } from '@opentelemetry/api';
import { queueGroupName } from './queue-group-name';
import { expirationQueue } from '../../queues/expiration-queue';
import { logger } from '../../logger';

export class OrderCreatedListener extends Listener<OrderCreatedEvent> {
  subject: Subjects.OrderCreated = Subjects.OrderCreated;
  queueGroupName = queueGroupName;

  async onMessage(data: OrderCreatedEvent['data'], msg: Message) {
    const delay = new Date(data.expiresAt).getTime() - new Date().getTime();
    logger.info('Scheduling order expiration', {
      orderId: data.id,
      delayMs: delay,
    });

    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);

    await expirationQueue.add(
      {
        orderId: data.id,
        _traceContext: carrier,
      },
      {
        delay,
      }
    );

    msg.ack();
  }
}
