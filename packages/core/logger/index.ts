import * as path from 'path';
import * as winston from 'winston';
import { DebugTransport } from './debug-transport';

function createLogger(name: string, options?: any): winston.Logger {
  if (!winston.loggers.has(name)) {
    const debugTransport = new DebugTransport(options, name);
    winston.loggers.add(name, {
      transports: [debugTransport],
    });

    winston.loggers.get(name).on('error', (err: any) => {
      if (err.code === 'ENOENT') {
        let msg = err;
        if (path.dirname(err.path) === '.') {
          msg = 'Error from logger (winston) while trying to use a file to store logs:';
        } else {
          msg = 'Error from logger (winston) while trying to use a file to store logs, if the directory "'
            + err.path + '" does not exists please create it:';
        }
        // make the error intentionally more visible to get the attention of the user
        console.error('------------------------');
        console.error(msg, err);
        console.error('------------------------');
      }
    });
  } else {
    // remove all transports and add default Debug transport
    winston.loggers.get(name).clear();
    winston.loggers.get(name).add(new DebugTransport(options, name));
  }

  return winston.loggers.get(name);
}

export {
  createLogger,
  DebugTransport
};
