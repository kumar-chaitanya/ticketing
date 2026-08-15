import {
  Subjects,
  Listener,
  PaymentCreatedEvent,
  OrderStatus,
} from '@kumar-chaitanya/common-ticketing-service';
import { Message } from 'node-nats-streaming';
import { queueGroupName } from './queue-group-name';
import { Order } from '../../models/order';
import { logger } from '../../logger';

export class PaymentCreatedListener extends Listener<PaymentCreatedEvent> {
  subject: Subjects.PaymentCreated = Subjects.PaymentCreated;
  queueGroupName = queueGroupName;

  async onMessage(data: PaymentCreatedEvent['data'], msg: Message) {
    const order = await Order.findById(data.orderId);

    if (!order) {
      throw new Error('Order not found');
    }

    order.set({
      status: OrderStatus.Complete,
    });
    await order.save();

    logger.info('Order marked complete after payment', {
      orderId: order.id,
      paymentId: data.id,
    });

    msg.ack();
  }
}
