import { Publisher, Subjects, TicketUpdatedEvent } from '@kumar-chaitanya/common-ticketing-service';

export class TicketUpdatedPublisher extends Publisher<TicketUpdatedEvent> {
  subject: Subjects.TicketUpdated = Subjects.TicketUpdated;
}
