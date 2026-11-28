import type { CodingAttachment } from "./coding-protocol";
import type { CodingSdkUserMessage } from "./coding-sdk";

export interface HeldMessage {
  id: string;
  uuid: string;
  text: string;
  attachments: CodingAttachment[];
  createdAt: string;
}

export interface InputItem {
  message: CodingSdkUserMessage;
  taken: boolean;
}

export class InputQueue {
  private readonly items: InputItem[] = [];
  private waiter: ((item: InputItem | undefined) => void) | undefined;
  private closed = false;

  push(item: InputItem): void {
    if (this.closed) return;
    const waiter = this.waiter;
    this.waiter = undefined;
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  remove(item: InputItem): boolean {
    const index = this.items.indexOf(item);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  close(): void {
    this.closed = true;
    this.items.length = 0;
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.(undefined);
  }

  private next(): Promise<InputItem | undefined> {
    if (this.closed) return Promise.resolve(undefined);
    const item = this.items.shift();
    if (item) return Promise.resolve(item);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  async *iterate(): AsyncGenerator<CodingSdkUserMessage> {
    while (!this.closed) {
      // eslint-disable-next-line react-doctor/async-await-in-loop
      const item = await this.next();
      if (!item) return;
      item.taken = true;
      yield item.message;
    }
  }
}
