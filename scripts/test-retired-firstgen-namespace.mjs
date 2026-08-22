import { spawnSync } from 'node:child_process';

const forbidden = ['local', 'claw'].join('');
const roots = ['Dockerfile', 'src', 'web-ui', 'generated/public-web-ui', 'scripts', 'docs', '.github'];
const result = spawnSync('git', ['grep', '-n', '-i', forbidden, '--', ...roots], { encoding: 'utf8' });
if (result.status === 0) {
  console.error('Retired first-generation Prometheus namespace found in active product files:\n' + result.stdout);
  process.exit(1);
}
if (result.status !== 1) {
  console.error(result.stderr || 'git grep failed');
  process.exit(result.status || 2);
}
console.log('retired first-generation namespace regression passed');
