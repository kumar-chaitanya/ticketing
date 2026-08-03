import { Subjects, Publisher, PaymentCreatedEvent } from '@kumar-chaitanya/common-ticketing-service';

export class PaymentCreatedPublisher extends Publisher<PaymentCreatedEvent> {
  subject: Subjects.PaymentCreated = Subjects.PaymentCreated;
}
