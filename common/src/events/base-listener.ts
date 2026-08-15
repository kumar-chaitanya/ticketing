import { Message, Stan } from 'node-nats-streaming';
import { context, propagation } from '@opentelemetry/api';
import { Subjects } from './subjects';
import { Logger } from '../logger';

interface Event {
  subject: Subjects;
  data: any;
}

const logger = new Logger('nats');

export abstract class Listener<T extends Event> {
  abstract subject: T['subject'];
  abstract queueGroupName: string;
  abstract onMessage(data: T['data'], msg: Message): void;
  protected client: Stan;
  protected ackWait = 5 * 1000;

  constructor(client: Stan) {
    this.client = client;
  }

  subscriptionOptions() {
    return this.client
      .subscriptionOptions()
      .setDeliverAllAvailable()
      .setManualAckMode(true)
      .setAckWait(this.ackWait)
      .setDurableName(this.queueGroupName);
  }

  listen() {
    const subscription = this.client.subscribe(
      this.subject,
      this.queueGroupName,
      this.subscriptionOptions()
    );

    subscription.on('message', (msg: Message) => {
      const parsedData = this.parseMessage(msg);
      const { _traceContext, ...eventData } = parsedData;

      const extractedContext = propagation.extract(
        context.active(),
        _traceContext || {}
      );

      context.with(extractedContext, () => {
        logger.info('Message received', {
          subject: this.subject,
          queueGroupName: this.queueGroupName,
        });
        this.onMessage(eventData as T['data'], msg);
      });
    });
  }

  parseMessage(msg: Message) {
    const data = msg.getData();
    return typeof data === 'string'
      ? JSON.parse(data)
      : JSON.parse(data.toString('utf8'));
  }
}
