import type { ConfirmChannel, Options, Message } from "amqplib";
import { randomUUID } from "node:crypto";

/** A broker confirm alone does not prove that a queue accepted the publication. */
export function publishConfirmed(
  channel: ConfirmChannel,
  exchange: string,
  route: string,
  body: Buffer,
  options: Options.Publish = {},
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const publication = randomUUID();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.off("return", returned);
      channel.off("close", closed);
      error ? reject(error) : resolve();
    };
    const returned = (message: Message) => {
      if (message.properties.headers?.["x-publication-id"] === publication)
        finish(new Error("Publication has no route"));
    };
    const closed = () => finish(new Error("Publisher channel closed"));
    const timer = setTimeout(
      () => finish(new Error("Publisher confirm timed out")),
      timeoutMs,
    );
    channel.on("return", returned);
    channel.on("close", closed);
    try {
      channel.publish(
        exchange,
        route,
        body,
        {
          ...options,
          persistent: true,
          mandatory: true,
          headers: { ...options.headers, "x-publication-id": publication },
        },
        (error) => finish(error ?? undefined),
      );
    } catch (error) {
      finish(error as Error);
    }
  });
}
