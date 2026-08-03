import { Subjects, Publisher, OrderCancelledEvent } from '@kumar-chaitanya/common-ticketing-service';

export class OrderCancelledPublisher extends Publisher<OrderCancelledEvent> {
  subject: Subjects.OrderCancelled = Subjects.OrderCancelled;
}
