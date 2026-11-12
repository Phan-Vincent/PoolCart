/** Serialize writes; a rejected write must not poison later retries. */
export function createWriteQueue() {
  let tail: Promise<void> = Promise.resolve();
  return (write: () => Promise<void>): Promise<void> => {
    const result = tail.then(write);
    tail = result.catch(() => undefined);
    return result;
  };
}
