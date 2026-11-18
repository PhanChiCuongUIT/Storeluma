// Mounted only by the messaging tests; never copied into the application image.
// Run the real Finance entry point, intercepting only the selected AMQP boundary.
import amqp from 'amqplib';
import { writeSync } from 'node:fs';

const mode = process.env.FAULT_MODE;
const target = process.env.FAULT_TARGET;
if (process.env.SERVICE_NAME !== 'finance' || !target ||
    !['before-ack', 'after-confirm', 'drop-confirm', 'observe'].includes(mode)) {
  throw new Error('Invalid messaging test configuration');
}
let fired = false;
const matches = (body) => {
  const event = JSON.parse(body.toString());
  return [event.id, event.eventId, event.siteId, event.aggregateId].includes(target);
};
const mark = (boundary, event) => writeSync(1, JSON.stringify({
  faultBoundary: boundary, eventId: event.eventId ?? event.id,
}) + '\n');
const crash = (boundary, event) => {
  mark(boundary, event);
  process.kill(process.pid, 'SIGKILL');
};
const connect = amqp.connect.bind(amqp);
amqp.connect = async (...args) => {
  const connection = await connect(...args);
  const create = connection.createConfirmChannel.bind(connection);
  connection.createConfirmChannel = async () => {
    const channel = await create();
    const ack = channel.ack.bind(channel);
    channel.ack = (message, ...rest) => {
      if (matches(message.content)) {
        const event = JSON.parse(message.content.toString());
        if (mode === 'before-ack') crash('before-ack', event);
        if (mode === 'observe') mark('ack', event);
      }
      return ack(message, ...rest);
    };
    const publish = channel.publish.bind(channel);
    channel.publish = (exchange, route, content, options, callback) =>
      publish(exchange, route, content, options, (error, ...rest) => {
        if (!error && !fired && route === 'register.ready' && matches(content)) {
          fired = true;
          const event = JSON.parse(content.toString());
          if (mode === 'after-confirm') crash('after-confirm', event);
          if (mode === 'drop-confirm') {
            mark('confirm-dropped', event);
            return; // Broker accepted it; the publisher never receives this confirm.
          }
        }
        callback(error, ...rest);
      });
    return channel;
  };
  return connection;
};
await import('/app/dist/services/finance/main.js');
