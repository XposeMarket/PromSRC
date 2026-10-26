/** Administrator CLI. Use through workspace_run so ordinary command policy applies. */
async function main() {
  const args = process.argv.slice(2);
  const action = args[0] || 'status';
  const { readRetentionPolicy, writeRetentionPolicy, retentionPass } = await import('../src/gateway/maintenance/retention-runtime');
  if (action === 'status') return { policy: await readRetentionPolicy() };
  if (action === 'dry-run') return retentionPass(true);
  if (action === 'prune') {
    if (!args.includes('--confirm')) throw new Error('Review dry-run first; prune requires --confirm and enabled policy');
    return retentionPass(false);
  }
  if (action === 'enable' || action === 'disable') return { policy: await writeRetentionPolicy({ ...await readRetentionPolicy(), enabled: action === 'enable' }) };
  if (action === 'configure') {
    if (!args[1]) throw new Error('configure requires a JSON policy patch');
    return { policy: await writeRetentionPolicy({ ...await readRetentionPolicy(), ...JSON.parse(args[1]) }) };
  }
  throw new Error('Usage: observation-retention status|dry-run|enable|disable|configure <JSON>|prune --confirm');
}
main().then(value => { console.log(JSON.stringify(value, null, 2)); process.exit(0); }, error => { console.error(error.message); process.exit(1); });
