/** Attach immediately after starting a request. Request success is not commit. */
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), {
      once: true,
    })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed')),
      { once: true },
    )
  })
}

/** Attach when creating the transaction, before awaiting any requests. */
export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      transaction.removeEventListener('complete', complete)
      transaction.removeEventListener('abort', abort)
    }
    const complete = () => {
      cleanup()
      resolve()
    }
    const abort = () => {
      cleanup()
      reject(
        transaction.error ??
          new DOMException('Transaction aborted', 'AbortError'),
      )
    }
    transaction.addEventListener('complete', complete, { once: true })
    transaction.addEventListener('abort', abort, { once: true })
  })
}
