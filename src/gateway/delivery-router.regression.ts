import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-delivery-router-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;

  try {
    const { deliverToTargets } = await import('./delivery-router');
    const sessionId = 'mobile_delivery_reconnect_regression';
    const sessionPath = path.join(root, '.prometheus', 'sessions', `${sessionId}.json`);
    const attachmentPath = path.join(root, 'proof.txt');
    fs.writeFileSync(attachmentPath, 'durable attachment', 'utf-8');
    const events: any[] = [];

    const textResult = await deliverToTargets({
      sessionId,
      target: 'mobile',
      text: 'Delivery that must survive reconnect',
      attachmentPath,
      fileName: 'proof.txt',
      mimeType: 'text/plain',
      source: 'delivery_send',
    }, { broadcastWS: (event) => events.push(event) });

    assert.equal(textResult.ok, true);
    await new Promise<void>((resolve) => setTimeout(resolve, 650));
    let history = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')).history;
    assert.equal(history.length, 1);
    assert.equal(history[0].messageKind, 'delivery');
    assert.equal(history[0].content, 'Delivery that must survive reconnect');
    assert.equal(history[0].files?.[0]?.path, attachmentPath);
    assert.deepEqual(history[0].canvasFiles, [attachmentPath]);
    assert.equal(events[0]?.type, 'delivery_notification');

    const screenshotResult = await deliverToTargets({
      sessionId,
      target: 'mobile',
      text: 'Fresh screenshot',
      imageBase64: Buffer.from('fake-png').toString('base64'),
      mimeType: 'image/png',
      fileName: 'desktop-screenshot.png',
      source: 'delivery_send_screenshot',
    }, { broadcastWS: (event) => events.push(event) });

    assert.equal(screenshotResult.ok, true);
    await new Promise<void>((resolve) => setTimeout(resolve, 650));
    history = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')).history;
    const screenshot = history.at(-1);
    const frozenPath = String(screenshot?.files?.[0]?.path || '');
    assert.equal(screenshot?.content, 'Fresh screenshot');
    assert.match(frozenPath.replace(/\\/g, '/'), /\.prometheus\/deliveries\/mobile_delivery_reconnect_regression\/.+\.png$/);
    assert.equal(fs.readFileSync(frozenPath, 'utf-8'), 'fake-png');

    const batchId = 'batch-reconnect-proof';
    for (const [batchIndex, name] of ['one.txt', 'two.txt'].entries()) {
      const filePath = path.join(root, name);
      fs.writeFileSync(filePath, name, 'utf-8');
      await deliverToTargets({
        sessionId,
        target: 'mobile',
        text: 'Two files ready',
        attachmentPath: filePath,
        fileName: name,
        mimeType: 'text/plain',
        source: 'delivery_send',
        batchId,
        batchIndex,
        batchCount: 2,
      }, { broadcastWS: (event) => events.push(event) });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 650));

    const stored = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    assert.equal(stored.history.length, 3);
    assert.equal(stored.history[0].files[0].path, attachmentPath);
    assert.equal(stored.history[1].files[0].path, frozenPath);
    assert.equal(stored.history[2].deliveryBatchId, batchId);
    assert.deepEqual(stored.history[2].files.map((file: any) => file.fileName), ['one.txt', 'two.txt']);
    console.log('delivery router reconnect regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
