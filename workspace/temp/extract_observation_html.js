const fs = require('fs');
const input = process.argv[2];
const output = process.argv[3];
const raw = fs.readFileSync(input, 'utf8').split(/\r?\n/);
const lines = [];
for (const line of raw) {
  const match = line.match(/^\d+: (.*)$/);
  if (match) lines.push(match[1]);
}
fs.writeFileSync(output, lines.join('\n') + '\n');
console.log(`extracted ${lines.length} lines to ${output}`);
