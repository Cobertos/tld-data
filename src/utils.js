import chalk from 'chalk';

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
