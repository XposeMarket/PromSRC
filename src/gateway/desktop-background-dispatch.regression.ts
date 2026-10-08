// Regression: background dispatch is the default for window-scoped desktop input,
// never steals focus or the cursor, and reports BACKGROUND_UNAVAILABLE honestly.
//
// Pure-logic checks always run. The live checks (Windows + helper v6) open a
// throwaway Notepad-free target: a hidden-from-focus WinForms-free classic
// window is not available everywhere, so we use the Run-free approach of
// spawning `notepad.exe` only when PROM_BG_LIVE=1.
import assert from 'assert';
import { spawn } from 'child_process';
import {
  normalizeDesktopDispatch,
  defaultDesktopDispatch,
  parseKeyCombo,
  backgroundUnavailableHint,
  backgroundHelper,
} from './desktop-background-dispatch';

async function main() {
  assert.strictEqual(normalizeDesktopDispatch('background'), 'background');
  assert.strictEqual(normalizeDesktopDispatch('FG'), 'foreground');
  assert.strictEqual(normalizeDesktopDispatch(''), undefined);
  assert.strictEqual(defaultDesktopDispatch({} as any), 'background');
  assert.strictEqual(defaultDesktopDispatch({ PROMETHEUS_DESKTOP_DISPATCH: 'foreground' } as any), 'foreground');

  assert.deepStrictEqual(parseKeyCombo('Ctrl+Shift+S'), { key: 'S', ctrl: true, shift: true, alt: false, win: false });
  assert.deepStrictEqual(parseKeyCombo('Enter'), { key: 'Enter', ctrl: false, shift: false, alt: false, win: false });
  assert.strictEqual(parseKeyCombo('Win+D').win, true);
  assert.strictEqual(parseKeyCombo('Ctrl++').key, '+');
  assert.match(backgroundUnavailableHint('web_content'), /browser tools/);
  assert.match(backgroundUnavailableHint('drag'), /foreground/);
  console.log('PASS dispatch logic');

  if (process.platform !== 'win32' || process.env.PROM_BG_LIVE !== '1') {
    console.log('SKIP live background checks (set PROM_BG_LIVE=1 on Windows)');
    return;
  }
  const helper = await backgroundHelper();
  assert.ok(helper, 'helper protocol v6 required for live checks');
  const before = await helper!.userInputState();
  // Classic Win32 target: a WinForms form (real EDIT + BUTTON HWNDs) that writes
  // its state to a file so we can assert the effect, not just the return value.
  const title = `PromBgTest-${process.pid}`;
  const stateFile = `${process.env.TEMP || '.'}\\${title}.txt`;
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object Windows.Forms.Form; $f.Text = '${title}'; $f.Width = 420; $f.Height = 220; $f.ShowInTaskbar = $true
$f.StartPosition = 'Manual'; $f.Left = 40; $f.Top = 40
$t = New-Object Windows.Forms.TextBox; $t.Left = 10; $t.Top = 10; $t.Width = 380; $f.Controls.Add($t)
$b = New-Object Windows.Forms.Button; $b.Text = 'Mark'; $b.Left = 10; $b.Top = 50; $b.Width = 120; $b.Height = 40; $f.Controls.Add($b)
$script:clicks = 0
$b.Add_Click({ $script:clicks++; [IO.File]::WriteAllText('${stateFile}', "clicks=$script:clicks;text=" + $t.Text) })
$t.Add_TextChanged({ [IO.File]::WriteAllText('${stateFile}', "clicks=$script:clicks;text=" + $t.Text) })
$f.Add_Shown({ $t.Focus() })
[void]$f.ShowDialog()`;
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { stdio: 'ignore', windowsHide: false });
  const fs = await import('fs');
  const readState = () => { try { return fs.readFileSync(stateFile, 'utf8'); } catch { return ''; } };
  try {
    let target: any = null;
    for (let i = 0; i < 80 && !target; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const windows = await helper!.listWindows();
      target = windows.find((w: any) => String(w.title || '') === title) || null;
    }
    assert.ok(target, 'test window appeared');
    const handle = Number(target.handle);
    // The new form takes focus when it opens; give the user their window back.
    await new Promise((r) => setTimeout(r, 500));
    if (before.foreground && before.foreground !== handle) await helper!.focusWindow(before.foreground).catch(() => false);
    await new Promise((r) => setTimeout(r, 400));
    const pre = await helper!.userInputState();
    assert.notStrictEqual(pre.foreground, handle, 'test window is in the background');

    const typed = await helper!.backgroundType(handle, 'prom background ok');
    await new Promise((r) => setTimeout(r, 300));
    const afterType = readState();
    const left = Number(target.left) + 10 + 60;
    const top = Number(target.top);
    // Button sits at client (10..130, 50..90); find its screen point via window bounds + caption.
    const clientOffsetY = Math.max(0, Number(target.height) - 220) + 31;
    const click = await helper!.backgroundClick(handle, left + 8, top + clientOffsetY + 70, { overlay: true });
    await new Promise((r) => setTimeout(r, 400));
    const afterClick = readState();
    const key = await helper!.backgroundKey(handle, 'end');
    const combo = await helper!.backgroundKey(handle, 's', { ctrl: true });
    const post = await helper!.userInputState();
    console.log(JSON.stringify({ typed, afterType, click, afterClick, key, combo, pre, post }));

    assert.ok(typed.ok, 'background type succeeded');
    assert.match(afterType, /text=prom background ok/, 'posted characters landed in the EDIT control');
    assert.ok(click.ok, 'background click succeeded');
    assert.match(afterClick, /clicks=1/, 'button handler ran from background click');
    assert.strictEqual(combo.ok, false);
    assert.strictEqual(combo.backgroundUnavailable, true);
    assert.strictEqual(combo.reason, 'modifier_combo');
    assert.strictEqual(post.foreground, pre.foreground, 'foreground window unchanged by background input');
    assert.deepStrictEqual(post.cursor, pre.cursor, 'cursor unchanged by background input');
    console.log('PASS live: focus and cursor untouched');
  } finally {
    try { process.kill(child.pid!); } catch {}
  }
}

// The persistent native helper child keeps the event loop alive; exit explicitly.
main().then(() => process.exit(0)).catch((error) => {
  console.error('FAIL', error);
  process.exit(1);
});
