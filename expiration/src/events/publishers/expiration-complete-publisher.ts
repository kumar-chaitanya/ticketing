import {
  Subjects,
  Publisher,
  ExpirationCompleteEvent,
} from '@kumar-chaitanya/common-ticketing-service';

export class ExpirationCompletePublisher extends Publisher<ExpirationCompleteEvent> {
  subject: Subjects.ExpirationComplete = Subjects.ExpirationComplete;
}
