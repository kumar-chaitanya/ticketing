import { Logger } from '@kumar-chaitanya/common-ticketing-service';

export const logger = new Logger(process.env.OTEL_SERVICE_NAME || 'tickets');
