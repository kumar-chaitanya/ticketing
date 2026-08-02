import {
  Subjects,
  Publisher,
  ExpirationCompleteEvent,
} from '@sgticketing/common';

export class ExpirationCompletePublisher extends Publisher<ExpirationCompleteEvent> {
  subject: Subjects.ExpirationComplete = Subjects.ExpirationComplete;
}
