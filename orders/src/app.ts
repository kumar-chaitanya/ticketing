import express, { Request, Response } from 'express';
import 'express-async-errors';
import { json } from 'body-parser';
import cookieSession from 'cookie-session';
import {
  errorHandler,
  NotFoundError,
  currentUser,
  Metrics,
  requestLogger,
} from '@kumar-chaitanya/common-ticketing-service';
import { deleteOrderRouter } from './routes/delete';
import { indexOrderRouter } from './routes/index';
import { newOrderRouter } from './routes/new';
import { showOrderRouter } from './routes/show';
import { logger } from './logger';

const metrics = Metrics.getInstance();

const app = express();
app.set('trust proxy', true);

app.get('/metrics', metrics.endpoint);

app.use(json());
app.use(
  cookieSession({
    signed: false,
    secure: process.env.NODE_ENV !== 'test',
  })
);
app.use(requestLogger(logger));
app.use(metrics.middleware);
app.use(currentUser);

app.use(deleteOrderRouter);
app.use(indexOrderRouter);
app.use(newOrderRouter);
app.use(showOrderRouter);

app.all('*', async (req: Request, res: Response) => {
  throw new NotFoundError();
});

app.use(errorHandler(logger));

export { app };
