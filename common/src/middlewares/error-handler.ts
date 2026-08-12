import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { CustomError } from '../errors/custom-error';
import { Logger } from '../logger';

export const errorHandler = (logger: Logger): ErrorRequestHandler => {
  return (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (err instanceof CustomError) {
      logger.warn(err.message, { err, statusCode: err.statusCode });
      return res.status(err.statusCode).send({ errors: err.serializeErrors() });
    }

    logger.error('Unhandled error', { err });

    res.status(400).send({
      errors: [{ message: 'Something went wrong' }]
    });
  };
};
