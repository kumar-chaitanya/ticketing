import { Publisher, Subjects, TicketCreatedEvent } from '@kumar-chaitanya/common-ticketing-service';

export class TicketCreatedPublisher extends Publisher<TicketCreatedEvent> {
  subject: Subjects.TicketCreated = Subjects.TicketCreated;
}
