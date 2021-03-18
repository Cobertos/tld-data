import chalk from 'chalk';
import nodeFetch from 'node-fetch';
import fetchRetry from 'fetch-retry';

// A custom version of fetch() that retries 3 times at 1000ms on network errors
// and 500 errors
const _fetch = fetchRetry(nodeFetch); // 3 retries, 1000ms delays by default
const fetch = (...args) => {
  args[1] = Object.assign({}, {
    ...{
      // RetryOn error codes 500-511
      retryOn: new Array(12).fill().map((_, i)=>i+500)
    },
    ...args[1]
  });
  return _fetch(...args);
};
export { fetch };

export function diffArrayUnordered(actual, expected) {
  // In actual but not expected
  return actual
    .filter(i => !expected.includes(i))
    .map(i => `+${chalk.green(i)}`)
    .join(', ') + '; ' +
  // In expected by not actual
  expected
    .filter(i => !actual.includes(i))
    .map(i => `-${chalk.red(i)}`)
    .join(', ');
}

export function mapReduceToObj(arr, obj) {
  return arr
    .map(_ => ({ [_]: obj }))
    .reduce(Object.assign, {});
}

export function arrayPrototypeUnique() {
  return Array.from(new Set(this));
};

/**Assertion helper, custom message and error type
 */
export function _assert(condition, message = "Assertion Error", error = Error) {
  if (!condition) {
    throw new error(message);
  }
}
