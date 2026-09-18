/** Tiny assertion recorder shared by the test harness. */

const results = [];

/**
 * Record and print one check.
 * @param {string} name
 * @param {boolean} pass
 * @param {string} [detail]
 */
export function check(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` -- ${detail}` : ''}`);
}

/** Print the summary and return the number of failures (for process.exit). */
export function report() {
  const failed = results.filter((r) => !r.pass);
  console.log('\n========================================');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
  }
  console.log('========================================');
  return failed.length;
}

export { results };