import { Publisher, OrderCreatedEvent, Subjects } from '@kumar-chaitanya/common-ticketing-service';

export class OrderCreatedPublisher extends Publisher<OrderCreatedEvent> {
  subject: Subjects.OrderCreated = Subjects.OrderCreated;
}
