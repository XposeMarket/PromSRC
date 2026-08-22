import { execFile } from 'child_process';
import { promisify } from 'util';
import type { DesktopCanonicalKey, DesktopModifier, DesktopMouseButton } from './desktop-backend.js';
import { DesktopBackgroundDeliveryUnsupportedError, type DesktopDeliveryTarget } from './desktop-cowork-delivery.js';

const execFileAsync = promisify(execFile);

function positiveInt(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function requireHwnd(target: DesktopDeliveryTarget): number {
  const hwnd = positiveInt(target.windowHandle);
  if (!hwnd) throw new DesktopBackgroundDeliveryUnsupportedError('Windows background coordinate delivery requires an exact HWND.');
  return hwnd;
}

async function invokeWin32Background(scriptBody: string, target: DesktopDeliveryTarget): Promise<void> {
  const hwnd = requireHwnd(target);
  const expectedPid = positiveInt(target.pid);
  const script = `
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PmCowork {
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
 [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr hWnd, ref POINT point);
 [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@
$h=[IntPtr]${hwnd}
if(-not [PmCowork]::IsWindow($h)){ throw 'Target HWND is no longer valid.' }
[uint32]$actualPid=0
[void][PmCowork]::GetWindowThreadProcessId($h,[ref]$actualPid)
${expectedPid ? `if($actualPid -ne ${expectedPid}){ throw 'Target HWND no longer belongs to the expected PID.' }` : ''}
${scriptBody}
`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 256 * 1024,
  });
}

function clientPointScript(x: number, y: number): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new DesktopBackgroundDeliveryUnsupportedError('Background pointer delivery requires finite screen coordinates.');
  return `$p=New-Object PmCowork+POINT; $p.X=${Math.round(x)}; $p.Y=${Math.round(y)}; if(-not [PmCowork]::ScreenToClient($h,[ref]$p)){ throw 'ScreenToClient failed.' }; $lp=[IntPtr](($p.Y -shl 16) -bor ($p.X -band 0xffff))`;
}

function modifierMask(modifiers: DesktopModifier[]): number {
  let mask = 0;
  if (modifiers.includes('shift')) mask |= 0x0004;
  if (modifiers.includes('ctrl')) mask |= 0x0008;
  if (modifiers.includes('alt') || modifiers.includes('cmd')) throw new DesktopBackgroundDeliveryUnsupportedError('Alt/Cmd modified pointer input requires foreground compatibility delivery on Windows.');
  return mask;
}

export async function win32BackgroundClick(input: { target: DesktopDeliveryTarget; x: number; y: number; button: DesktopMouseButton; repeat: number; modifiers: DesktopModifier[] }): Promise<void> {
  const right = input.button === 'right';
  const down = right ? 0x0204 : 0x0201;
  const up = right ? 0x0205 : 0x0202;
  const buttonMask = right ? 0x0002 : 0x0001;
  const keys = modifierMask(input.modifiers) | buttonMask;
  const repeat = Math.max(1, Math.min(3, Math.floor(input.repeat || 1)));
  await invokeWin32Background(`${clientPointScript(input.x, input.y)}; 1..${repeat} | ForEach-Object { [void][PmCowork]::PostMessage($h,${down},[IntPtr]${keys},$lp); Start-Sleep -Milliseconds 18; [void][PmCowork]::PostMessage($h,${up},[IntPtr]0,$lp); Start-Sleep -Milliseconds 55 }`, input.target);
}

export async function win32BackgroundScroll(input: { target: DesktopDeliveryTarget; x: number; y: number; deltaX: number; deltaY: number }): Promise<void> {
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) throw new DesktopBackgroundDeliveryUnsupportedError('Windows background scroll requires a target screen point.');
  const body: string[] = [];
  body.push(`$lp=[IntPtr]((${Math.round(input.y)} -shl 16) -bor (${Math.round(input.x)} -band 0xffff))`);
  if (input.deltaY) body.push(`$wp=[IntPtr]((${Math.round(input.deltaY)} -band 0xffff) -shl 16); [void][PmCowork]::PostMessage($h,0x020A,$wp,$lp)`);
  if (input.deltaX) body.push(`$wp=[IntPtr]((${Math.round(input.deltaX)} -band 0xffff) -shl 16); [void][PmCowork]::PostMessage($h,0x020E,$wp,$lp)`);
  await invokeWin32Background(body.join('; '), input.target);
}

export async function win32BackgroundDrag(input: { target: DesktopDeliveryTarget; fromX: number; fromY: number; toX: number; toY: number; steps: number }): Promise<void> {
  const steps = Math.max(2, Math.min(60, Math.floor(input.steps || 20)));
  const lines: string[] = [clientPointScript(input.fromX, input.fromY), '[void][PmCowork]::PostMessage($h,0x0201,[IntPtr]1,$lp)'];
  for (let i = 1; i <= steps; i++) {
    const x = input.fromX + (input.toX - input.fromX) * i / steps;
    const y = input.fromY + (input.toY - input.fromY) * i / steps;
    lines.push(clientPointScript(x, y), '[void][PmCowork]::PostMessage($h,0x0200,[IntPtr]1,$lp)', 'Start-Sleep -Milliseconds 8');
  }
  lines.push('[void][PmCowork]::PostMessage($h,0x0202,[IntPtr]0,$lp)');
  await invokeWin32Background(lines.join('; '), input.target);
}

export async function win32BackgroundTypeText(input: { target: DesktopDeliveryTarget; text: string }): Promise<void> {
  const units = Array.from(String(input.text || '')).flatMap((ch) => {
    const encoded = Buffer.from(ch, 'utf16le');
    const values: number[] = [];
    for (let i = 0; i + 1 < encoded.length; i += 2) values.push(encoded.readUInt16LE(i));
    return values;
  });
  const payload = units.map((unit) => `[void][PmCowork]::PostMessage($h,0x0102,[IntPtr]${unit},[IntPtr]1)`).join('; ');
  await invokeWin32Background(payload || '$null=$h', input.target);
}

const VK: Record<string, number> = {
  enter: 0x0d, return: 0x0d, tab: 0x09, escape: 0x1b, esc: 0x1b, backspace: 0x08, delete: 0x2e,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, space: 0x20,
};
function vkFor(key: string): number {
  const normalized = String(key || '').toLowerCase();
  if (VK[normalized]) return VK[normalized];
  if (/^[a-z0-9]$/.test(normalized)) return normalized.toUpperCase().charCodeAt(0);
  const fn = normalized.match(/^f([1-9]|1[0-2])$/); if (fn) return 0x6f + Number(fn[1]);
  throw new DesktopBackgroundDeliveryUnsupportedError(`Windows background key delivery does not map key "${key}".`);
}

export async function win32BackgroundPressKey(input: { target: DesktopDeliveryTarget; key: DesktopCanonicalKey }): Promise<void> {
  if (input.key.modifiers.includes('alt') || input.key.modifiers.includes('cmd')) throw new DesktopBackgroundDeliveryUnsupportedError('Alt/Cmd chords require foreground compatibility delivery on Windows.');
  const main = vkFor(input.key.key);
  const mods = input.key.modifiers.map((m) => m === 'shift' ? 0x10 : m === 'ctrl' ? 0x11 : 0).filter(Boolean);
  const lines: string[] = [];
  for (const vk of mods) lines.push(`[void][PmCowork]::PostMessage($h,0x0100,[IntPtr]${vk},[IntPtr]1)`);
  lines.push(`[void][PmCowork]::PostMessage($h,0x0100,[IntPtr]${main},[IntPtr]1)`, `[void][PmCowork]::PostMessage($h,0x0101,[IntPtr]${main},[IntPtr]0xC0000001)`);
  for (const vk of mods.reverse()) lines.push(`[void][PmCowork]::PostMessage($h,0x0101,[IntPtr]${vk},[IntPtr]0xC0000001)`);
  await invokeWin32Background(lines.join('; '), input.target);
}
