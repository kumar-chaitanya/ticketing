import { Message } from 'node-nats-streaming';
import { Listener, OrderCreatedEvent, Subjects } from '@kumar-chaitanya/common-ticketing-service';
import { queueGroupName } from './queue-group-name';
import { Order } from '../../models/order';
import { logger } from '../../logger';

export class OrderCreatedListener extends Listener<OrderCreatedEvent> {
  subject: Subjects.OrderCreated = Subjects.OrderCreated;
  queueGroupName = queueGroupName;

  async onMessage(data: OrderCreatedEvent['data'], msg: Message) {
    const order = Order.build({
      id: data.id,
      price: data.ticket.price,
      status: data.status,
      userId: data.userId,
      version: data.version,
    });
    await order.save();

    logger.info('Order created in payments service', { orderId: order.id });

    msg.ack();
  }
}
