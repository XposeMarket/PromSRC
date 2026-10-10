/**
 * handleBrowserDesktopTool: browser and desktop automation tool handlers, extracted verbatim
 * from executeToolRaw (subagent-executor.ts) to shrink that file. Behaviour is
 * unchanged: executeToolRaw delegates these case labels here with the same
 * locals it used to close over.
 */
import type { BrowserDesktopHandlerContext } from './browser-desktop-context';
import { browserClick, browserClickAndDownload, browserClose, browserCloseTab, browserDoctor, browserDrag, browserElementWatch, browserExtractStructured, browserFill, browserGetFocusedItem, browserGetPageText, browserInspectConsole, browserInterceptNetwork, browserListTabs, browserNewTab, browserOpen, browserPressKey, browserRunJs, browserRunSmokeSteps, browserScroll, browserScrollCollect, browserScrollCollectV2, browserSelectTab, browserSetProfileTarget, browserSnapshot, browserSnapshotDelta, browserTeachVerify, browserType, browserUploadFile, browserVisionClick, browserVisionScreenshot, browserVisionType, browserWait, resolveBrowserObserveMode } from '../../browser-tools';
import { buildToolBenchmarkAggregate } from '../../tool-observations';
import { consumeFinalActionApproval } from '../../final-action-approvals.js';
import { desktopAccessibilityAction, desktopAccessibilityFindAndAct, desktopBackgroundCommand, desktopBackgroundPrepareSandbox, desktopBackgroundStatus, desktopClick, desktopClickText, desktopCloseApp, desktopDiffScreenshot, desktopDoctor, desktopDrag, desktopFindInstalledApp, desktopFindWindow, desktopFocusWindowCanonical, desktopFocusWindowVerified, desktopGetAccessibilityState, desktopGetAccessibilityTree, desktopGetClipboard, desktopGetMonitorsSummary, desktopGetProcessList, desktopGetWindowState, desktopGetWindowText, desktopLaunchApp, desktopListApps, desktopListInstalledApps, desktopListMacros, desktopListWindowsCanonical, desktopLocateText, desktopPixelWatch, desktopPressKey, desktopRecordMacro, desktopReplayMacro, desktopScreenshotWithHistory, desktopScroll, desktopSetClipboard, desktopStopMacro, desktopType, desktopTypeRaw, desktopWait, desktopWaitForChange, desktopWindowClick, desktopWindowControl, desktopWindowDrag, desktopWindowPressKey, desktopWindowScreenshot, desktopWindowScroll, desktopWindowType, getDesktopAdvisorPacketById, parseDesktopPointerMonitorArgs, parseDesktopScreenshotToolArgs, resolveCanonicalWindow, resolveDesktopActionPoint } from '../../desktop-tools';
import { executeDeliverySendScreenshot } from '../../delivery-screenshot.js';
import { executeTool, resolveBoundedToolTimeoutMs, withBoundedToolTimeout } from '../subagent-executor';

export const HANDLEBROWSERDESKTOPTOOL_TOOL_NAMES: ReadonlySet<string> = new Set(["browser_doctor","browser_set_profile_target","browser_open","browser_snapshot","browser_list_tabs","browser_select_tab","browser_new_tab","browser_close_tab","browser_click","browser_fill","browser_upload_file","browser_press_key","browser_key","browser_type","browser_wait","browser_scroll","browser_drag","browser_click_and_download","browser_close","browser_get_focused_item","browser_get_page_text","browser_send_to_telegram","browser_vision_screenshot","browser_vision_click","browser_vision_type","browser_scroll_collect","browser_scroll_collect_v2","browser_run_js","browser_intercept_network","tool_benchmark_summary","inspect_console","run_accessibility_check","browser_smoke_test","browser_element_watch","browser_snapshot_delta","browser_extract_structured","browser_teach_verify","desktop_doctor","desktop_screenshot","desktop_get_monitors","desktop_window_screenshot","desktop_find_window","desktop_focus_window","desktop_window_control","desktop_click","desktop_drag","desktop_wait","desktop_type","desktop_press_key","desktop_get_clipboard","desktop_set_clipboard","desktop_list_installed_apps","desktop_find_installed_app","desktop_launch_app","desktop_close_app","desktop_get_process_list","desktop_wait_for_change","desktop_diff_screenshot","desktop_list_apps","desktop_list_windows","desktop_get_window_state","desktop_locate_text","desktop_click_text","desktop_get_accessibility_state","desktop_accessibility_action","desktop_window_click","desktop_window_type","desktop_window_press_key","desktop_window_scroll","desktop_window_drag","desktop_get_window_text","desktop_get_accessibility_tree","desktop_pixel_watch","desktop_record_macro","desktop_stop_macro","desktop_replay_macro","desktop_list_macros","desktop_background_status","desktop_background_prepare_sandbox","desktop_background_command","desktop_scroll","desktop_type_raw","desktop_send_to_telegram","desktop_task"]);

export async function handleBrowserDesktopTool(ctx: BrowserDesktopHandlerContext): Promise<any> {
  const { name, args, workspacePath, deps, sessionId, broadcastBrowserStatus, maybeBroadcastBrowserStatus } = ctx;
  void workspacePath; void deps;
  switch (name) {
      // Browser automation tools
      case 'browser_doctor': {
        const result = await browserDoctor(sessionId);
        await broadcastBrowserStatus('browser_doctor');
        return { name, args, result, error: /\bFAIL\b/.test(result) };
      }
      case 'browser_set_profile_target': {
        const result = await browserSetProfileTarget(sessionId, args.target || 'prometheus', {
          closeExisting: args.close_existing !== false,
          profileDirectory: args.profile_directory ?? args.profileDirectory,
          inhouseProfile: args.inhouse_profile ?? args.inhouseProfile,
        });
        await broadcastBrowserStatus('browser_set_profile_target');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_open': {
        const timeoutMs = resolveBoundedToolTimeoutMs(args, 60000, 120000);
        let result: string;
        try {
          result = await withBoundedToolTimeout(browserOpen(sessionId, args.url || '', {
            observe: resolveBrowserObserveMode('browser_open', args.observe),
            target: args.target != null ? String(args.target) : (args.profile != null ? String(args.profile) : undefined),
            inhouseProfile: args.inhouse_profile ?? args.inhouseProfile,
            profileDirectory: args.profile_directory ?? args.profileDirectory,
            onPerformanceStage: deps.onPerformanceStage,
          }), timeoutMs, 'browser_open');
        } catch (err: any) {
          result = `ERROR: browser_open did not finish in time: ${err?.message || err}`;
        }
        await broadcastBrowserStatus('browser_open', {
          includeFrame: resolveBrowserObserveMode('browser_open', args.observe) === 'screenshot',
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_snapshot': {
        const result = await browserSnapshot(sessionId, { onPerformanceStage: deps.onPerformanceStage });
        await broadcastBrowserStatus('browser_snapshot');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_list_tabs': {
        const result = await browserListTabs(sessionId);
        await broadcastBrowserStatus('browser_list_tabs');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_select_tab': {
        const result = await browserSelectTab(sessionId, Number(args.index || 0));
        await broadcastBrowserStatus('browser_select_tab');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_new_tab': {
        const result = await browserNewTab(sessionId, args.url != null ? String(args.url) : undefined);
        await broadcastBrowserStatus('browser_new_tab');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_close_tab': {
        const result = await browserCloseTab(sessionId, args.index != null ? Number(args.index) : undefined);
        await broadcastBrowserStatus('browser_close_tab');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_click': {
        const finalActionApprovalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
        const hasFinalActionApproval = !!finalActionApprovalId;
        if (finalActionApprovalId) {
          const gate = consumeFinalActionApproval({ sessionId, approvalId: finalActionApprovalId, toolName: name, toolArgs: args });
          if (!gate.ok) return { name, args, result: `ERROR: ${gate.message}`, error: true };
        }
        const observeMode = resolveBrowserObserveMode('browser_click', hasFinalActionApproval ? 'snapshot' : (args.capture_after === true ? 'snapshot' : args.observe));
        const result = await browserClick(sessionId, {
          ref: args.ref != null ? Number(args.ref) : undefined,
          element: args.element != null ? String(args.element) : (args.element_name != null ? String(args.element_name) : undefined),
          selector: args.selector != null ? String(args.selector) : undefined,
        }, {
          observe: observeMode,
        });
        await maybeBroadcastBrowserStatus('browser_click', observeMode);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_fill': {
        const result = await browserFill(sessionId, {
          ref: args.ref != null ? Number(args.ref) : undefined,
          element: args.element != null ? String(args.element) : (args.element_name != null ? String(args.element_name) : undefined),
          selector: args.selector != null ? String(args.selector) : undefined,
        }, String(args.text || ''), {
          observe: resolveBrowserObserveMode('browser_fill', args.capture_after === true ? 'snapshot' : args.observe),
        });
        await broadcastBrowserStatus('browser_fill');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_upload_file': {
        const result = await browserUploadFile(sessionId, {
          ref: args.ref != null ? Number(args.ref) : undefined,
          selector: args.selector != null ? String(args.selector) : undefined,
          file_path: args.file_path != null ? String(args.file_path) : undefined,
          file_paths: Array.isArray(args.file_paths) ? args.file_paths.map((value: any) => String(value)) : undefined,
          observe: resolveBrowserObserveMode('browser_upload_file', args.observe),
        });
        await broadcastBrowserStatus('browser_upload_file');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_press_key':
      case 'browser_key': {
        const keyToolName = name === 'browser_key' ? 'browser_key' : 'browser_press_key';
        const finalActionApprovalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
        const hasFinalActionApproval = !!finalActionApprovalId;
        if (finalActionApprovalId) {
          const gate = consumeFinalActionApproval({ sessionId, approvalId: finalActionApprovalId, toolName: keyToolName, toolArgs: args });
          if (!gate.ok) return { name, args, result: `ERROR: ${gate.message}`, error: true };
        }
        const observeMode = resolveBrowserObserveMode(keyToolName, hasFinalActionApproval ? 'snapshot' : args.observe);
        const result = await browserPressKey(sessionId, String(args.key || 'Enter'), {
          observe: observeMode,
          hold_ms: args.hold_ms,
          keys: args.keys,
          sequence: args.sequence,
          tab_id: args.tab_id,
        });
        await maybeBroadcastBrowserStatus('browser_press_key', observeMode);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_type': {
        const result = await browserType(sessionId, String(args.text || ''), {
          observe: resolveBrowserObserveMode('browser_type', args.capture_after === true ? 'snapshot' : args.observe),
        });
        await broadcastBrowserStatus('browser_type');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_wait': {
        const result = await browserWait(sessionId, Number(args.ms || 2000), {
          observe: resolveBrowserObserveMode('browser_wait', args.observe),
        });
        await broadcastBrowserStatus('browser_wait');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_scroll': {
        const dir = String(args.direction || 'down').toLowerCase() === 'up' ? 'up' : 'down';
        const result = await browserScroll(sessionId, dir, Number(args.multiplier || 1), {
          observe: resolveBrowserObserveMode('browser_scroll', args.capture_after === true ? 'snapshot' : args.observe),
        });
        await broadcastBrowserStatus('browser_scroll');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_drag': {
        const result = await browserDrag(sessionId, {
          from_ref: args.from_ref != null ? Number(args.from_ref) : undefined,
          to_ref: args.to_ref != null ? Number(args.to_ref) : undefined,
          from_x: args.from_x != null ? Number(args.from_x) : undefined,
          from_y: args.from_y != null ? Number(args.from_y) : undefined,
          to_x: args.to_x != null ? Number(args.to_x) : undefined,
          to_y: args.to_y != null ? Number(args.to_y) : undefined,
          steps: args.steps != null ? Number(args.steps) : undefined,
          observe: resolveBrowserObserveMode('browser_drag', args.capture_after === true ? 'snapshot' : args.observe),
        });
        await broadcastBrowserStatus('browser_drag');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_click_and_download': {
        const result = await browserClickAndDownload(sessionId, Number(args.ref || 0), {
          timeout_ms: args.timeout_ms != null ? Number(args.timeout_ms) : undefined,
          filename_hint: args.filename_hint != null ? String(args.filename_hint) : undefined,
          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
          observe: resolveBrowserObserveMode('browser_click_and_download', args.observe),
        });
        await broadcastBrowserStatus('browser_click_and_download');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_close': {
        const result = await browserClose(sessionId);
        await broadcastBrowserStatus('browser_close');
        return { name, args, result, error: false };
      }
      case 'browser_get_focused_item': {
        const result = await browserGetFocusedItem(sessionId);
        await broadcastBrowserStatus('browser_get_focused_item');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_get_page_text': {
        const result = await browserGetPageText(sessionId, {
          element: args.element != null ? String(args.element) : (args.element_name != null ? String(args.element_name) : ''),
          query: args.query != null ? String(args.query) : '',
          maxChars: args.max_chars,
          maxLines: args.max_lines,
        });
        await broadcastBrowserStatus('browser_get_page_text');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_send_to_telegram': {
        const caption = String(args.caption || 'Browser screenshot');
        const delivered = await executeDeliverySendScreenshot({ source: 'browser_new', target: 'telegram', caption }, workspacePath, deps, sessionId);
        await broadcastBrowserStatus('browser_send_to_telegram');
        return { name, args, result: delivered.result, error: delivered.error };
      }

      // Vision fallback tools (Component 3)
      case 'browser_vision_screenshot': {
        let vshot: Awaited<ReturnType<typeof browserVisionScreenshot>> = null;
        try {
          vshot = await browserVisionScreenshot(sessionId);
        } catch (err: any) {
          // Distinguish a real capture failure (session exists, image empty/errored) from
          // "no session" so the model does not needlessly re-open the browser.
          return { name, args, result: `ERROR: Browser screenshot failed: ${err?.message || err}`, error: true };
        }
        if (!vshot) return { name, args, result: 'ERROR: No browser session. Use browser_open first.', error: true };
        await broadcastBrowserStatus('browser_vision_screenshot');
        // Return metadata text; chat.router injects the cached PNG as a user image
        // for vision-capable primaries right after this tool result.
        return {
          name, args,
          result: `Viewport screenshot captured (${vshot.width}x${vshot.height}). Vision advisor will use this to identify coordinates. Call browser_vision_click(x, y) with the coordinates returned by the advisor.`,
          error: false,
        };
      }
      case 'browser_vision_click': {
        const result = await browserVisionClick(
          sessionId,
          Number(args.x),
          Number(args.y),
          String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
          { observe: resolveBrowserObserveMode('browser_vision_click', args.observe) },
        );
        await broadcastBrowserStatus('browser_vision_click');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_vision_type': {
        const result = await browserVisionType(
          sessionId,
          Number(args.x),
          Number(args.y),
          String(args.text || ''),
          { observe: resolveBrowserObserveMode('browser_vision_type', args.observe) },
        );
        await broadcastBrowserStatus('browser_vision_type');
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Browser power tools
      case 'browser_scroll_collect': {
        const shouldUseStructuredCollect =
          !!(args.schema
          || args.schema_name
          || args.use_schema
          || args.item_root
          || args.root_name
          || args.container_name
          || args.fields
          || args.save_as);
        const result = shouldUseStructuredCollect
          ? await browserScrollCollectV2(sessionId, args || {})
          : await browserScrollCollect(sessionId, {
              scrolls: args.scrolls != null ? Number(args.scrolls) : undefined,
              direction: args.direction === 'up' ? 'up' : 'down',
              multiplier: args.multiplier != null ? Number(args.multiplier) : undefined,
              delay_ms: args.delay_ms != null ? Number(args.delay_ms) : undefined,
              stop_text: args.stop_text != null ? String(args.stop_text) : undefined,
              max_chars: args.max_chars != null ? Number(args.max_chars) : undefined,
              include_initial: args.include_initial != null ? !['false', '0', 'no'].includes(String(args.include_initial).trim().toLowerCase()) : undefined,
              max_seconds: args.max_seconds != null ? Number(args.max_seconds) : undefined,
              stop_after_no_new: args.stop_after_no_new != null ? Number(args.stop_after_no_new) : undefined,
              include_snapshots: args.include_snapshots != null ? !['false', '0', 'no'].includes(String(args.include_snapshots).trim().toLowerCase()) : undefined,
              include_structured: args.include_structured != null ? !['false', '0', 'no'].includes(String(args.include_structured).trim().toLowerCase()) : undefined,
            });
        await broadcastBrowserStatus('browser_scroll_collect');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_scroll_collect_v2': {
        const result = await browserScrollCollectV2(sessionId, args || {});
        await broadcastBrowserStatus('browser_scroll_collect_v2');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_run_js': {
        const result = await browserRunJs(sessionId, String(args.code || ''), {
          observe: resolveBrowserObserveMode('browser_run_js', args.observe),
        });
        await broadcastBrowserStatus('browser_run_js');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_intercept_network': {
        const action = String(args.action || 'read') as 'start' | 'stop' | 'read' | 'clear';
        const result = await browserInterceptNetwork(
          sessionId,
          action,
          args.url_filter != null ? String(args.url_filter) : undefined,
          args.max_entries != null ? Number(args.max_entries) : undefined,
          { includeBodies: args.include_bodies === true, bodyMaxChars: args.body_max_chars, statusMin: args.status_min, statusMax: args.status_max },
        );
        await broadcastBrowserStatus('browser_intercept_network');
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      case 'tool_benchmark_summary': {
        const aggregate = buildToolBenchmarkAggregate(sessionId, Number(args.limit || 5000));
        return { name, args, result: JSON.stringify(aggregate, null, 2), error: false };
      }
      case 'inspect_console': {
        const maxEntries = Math.max(1, Math.min(500, Number(args.max_entries || 100)));
        const action = String(args.action || 'read').toLowerCase();
        const result = await browserInspectConsole(sessionId, { action, maxEntries, sinceTs: args.since_ts, pageOnly: args.page_only !== false, urlFilter: args.url_filter, maxMessageChars: args.max_message_chars });
        await broadcastBrowserStatus('inspect_console');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'run_accessibility_check': {
        const maxResults = Math.max(1, Math.min(500, Number(args.max_results || 100)));
        const result = await browserRunJs(sessionId, `
          const findings = [];
          const add = (rule, message, selector, impact = 'moderate') => {
            if (findings.length < ${maxResults}) findings.push({ rule, impact, message, selector });
          };
          const selectorFor = (el) => {
            if (!el) return '';
            if (el.id) return '#' + CSS.escape(el.id);
            const tag = el.tagName ? el.tagName.toLowerCase() : 'element';
            const label = el.getAttribute?.('aria-label') || el.getAttribute?.('name') || el.getAttribute?.('placeholder') || '';
            return label ? tag + '[' + label.slice(0, 40) + ']' : tag;
          };
          if (!document.title || document.title.trim().length < 2) add('document-title', 'Page is missing a useful title.', 'head title', 'serious');
          if (!document.documentElement.lang) add('html-lang', 'html element is missing lang.', 'html', 'serious');
          document.querySelectorAll('img').forEach(img => {
            if (!img.hasAttribute('alt')) add('image-alt', 'Image missing alt attribute.', selectorFor(img));
          });
          document.querySelectorAll('button,input,select,textarea,[role="button"],[role="textbox"],[role="combobox"]').forEach(el => {
            const id = el.id;
            const labelledBy = el.getAttribute('aria-labelledby');
            const labelledByText = labelledBy ? labelledBy.split(/\s+/).map(ref => document.getElementById(ref)?.textContent || '').join(' ').trim() : '';
            const nativeText = ['button','a','summary','option'].includes(el.tagName.toLowerCase()) ? (el.textContent || '').trim() : '';
            const associatedLabel = (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')?.textContent) || el.closest('label')?.textContent || '';
            const nativeFallback = el.getAttribute('alt') || el.getAttribute('value') || el.getAttribute('placeholder') || '';
            const hasLabel = el.getAttribute('aria-label') || labelledByText || nativeText || associatedLabel.trim() || el.getAttribute('title') || nativeFallback;
            if (!hasLabel) add('control-label', 'Interactive control may be unlabeled.', selectorFor(el), 'serious');
          });
          const ids = new Map();
          document.querySelectorAll('[id]').forEach(el => {
            const id = el.id;
            if (ids.has(id)) add('duplicate-id', 'Duplicate id: ' + id, selectorFor(el));
            ids.set(id, true);
          });
          document.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href') || '';
            if (href === '#' || href.toLowerCase().startsWith('javascript:')) add('link-target', 'Link has weak or JavaScript href.', selectorFor(a));
            if (!a.textContent?.trim() && !a.getAttribute('aria-label')) add('link-name', 'Link has no accessible text.', selectorFor(a));
          });
          let previousLevel = 0;
          document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
            const level = Number(h.tagName.slice(1));
            if (previousLevel && level > previousLevel + 1) add('heading-order', 'Heading level jumps from h' + previousLevel + ' to h' + level + '.', selectorFor(h));
            previousLevel = level;
          });
          if (!document.querySelector('main,[role="main"]')) add('landmark-main', 'Page has no main landmark.', 'main');
          return { url: location.href, title: document.title, finding_count: findings.length, findings };
        `);
        await broadcastBrowserStatus('run_accessibility_check');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_smoke_test': {
        const url = String(args.url || '').trim();
        if (!url) return { name, args, result: 'url is required', error: true };
        await executeTool('inspect_console', { action: 'clear' }, workspacePath, deps, sessionId);
        const consoleStartedAt = Date.now();
        const openResult = await browserOpen(sessionId, url, { observe: 'compact' });
        await browserWait(sessionId, Math.max(250, Math.min(10000, Number(args.wait_ms || 1500))), { observe: 'none' });
        const snapshot = await browserSnapshot(sessionId);
        const smokeSteps = Array.isArray(args.steps) && args.steps.length
          ? await browserRunSmokeSteps(sessionId, args.steps)
          : JSON.stringify({ ok: true, executed: 0, results: [] });
        const consoleResult = await executeTool('inspect_console', { max_entries: args.max_console_entries || 50, since_ts: consoleStartedAt, page_only: true }, workspacePath, deps, sessionId);
        const a11yResult = await executeTool('run_accessibility_check', { max_results: args.max_a11y_results || 50 }, workspacePath, deps, sessionId);
        await broadcastBrowserStatus('browser_smoke_test');
        return {
          name,
          args,
          result: JSON.stringify({
            url,
            open: openResult,
            snapshot: snapshot.slice(0, 5000),
            console: consoleResult.result,
            accessibility: a11yResult.result,
            steps: JSON.parse(smokeSteps),
          }, null, 2),
          error: openResult.startsWith('ERROR') || snapshot.startsWith('ERROR') || consoleResult.error || a11yResult.error || smokeSteps.includes('"ok": false'),
        };
      }
      case 'browser_element_watch': {
        const waitFor = String(args.wait_for || 'appear') as 'appear' | 'disappear' | 'text_contains';
        const result = await browserElementWatch(
          sessionId,
          String(args.selector || ''),
          waitFor,
          args.text != null ? String(args.text) : undefined,
          args.timeout_ms != null ? Number(args.timeout_ms) : undefined,
        );
        await broadcastBrowserStatus('browser_element_watch');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_snapshot_delta': {
        const result = await browserSnapshotDelta(sessionId);
        await broadcastBrowserStatus('browser_snapshot_delta');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_extract_structured': {
        const result = await browserExtractStructured(sessionId, args.schema || args || {});
        await broadcastBrowserStatus('browser_extract_structured');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_teach_verify': {
        const result = await browserTeachVerify(sessionId, args || {});
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Desktop automation tools
      case 'desktop_doctor': {
        const result = await desktopDoctor(sessionId, {
          deep: args.deep === true,
          signal: deps.abortSignal?.signal,
          onPerformanceStage: deps.onPerformanceStage,
        });
        // The doctor report is diagnostic output: return it whole. Flagging any
        // FAIL line as a tool error made wrappers collapse the report to its
        // first lines and hide which check failed. Only a broken core (platform
        // unsupported or screenshots impossible) is a tool error.
        return { name, args, result, error: /^FAIL (Platform|Screenshot)/m.test(result) };
      }
      case 'desktop_screenshot': {
        // Use history-aware wrapper so desktop_diff_screenshot always has a prev packet
        const options = parseDesktopScreenshotToolArgs((args && typeof args === 'object') ? args as any : undefined) || {};
        options.signal = deps.abortSignal?.signal;
        const result = await desktopScreenshotWithHistory(sessionId, options);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_get_monitors': {
        const result = await desktopGetMonitorsSummary();
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_window_screenshot': {
        const result = await desktopWindowScreenshot(sessionId, {
          window_token: args.window_token == null ? undefined : String(args.window_token),
          window_id: args.window_id == null ? undefined : String(args.window_id),
          window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
          app_id: args.app_id == null ? undefined : String(args.app_id),
          title: args.title == null ? undefined : String(args.title),
          name: args.name == null ? undefined : String(args.name),
          handle: args.handle == null ? undefined : Number(args.handle),
          active: args.active === true,
          focus_first: args.focus_first == null ? undefined : args.focus_first !== false,
          padding: args.padding == null ? undefined : Number(args.padding),
          region: Array.isArray(args.region) && args.region.length === 4
            ? args.region.map(Number) as [number, number, number, number]
            : undefined,
          mode: String(args.mode || '').toLowerCase() === 'som' || args.som === true ? 'som' : 'normal',
          som: args.som === true || String(args.mode || '').toLowerCase() === 'som',
          skipOcr: args.skip_ocr === true || args.skipOcr === true,
          signal: deps.abortSignal?.signal,
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_find_window': {
        const result = await desktopFindWindow(String(args.name || args.title || args.app || args.query || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_focus_window': {
        if (args.window_token || args.window_id || args.window_handle || args.app_id || args.title) {
          const result = await desktopFocusWindowCanonical(sessionId, {
            window_token: args.window_token == null ? undefined : String(args.window_token),
            window_id: args.window_id == null ? undefined : String(args.window_id),
            window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
            app_id: args.app_id == null ? undefined : String(args.app_id),
            title: args.title == null ? undefined : String(args.title),
          }, args.include_screenshot !== false, deps.abortSignal?.signal, { skipOcr: args.skip_ocr !== false && args.skipOcr !== false });
          return { name, args, result, error: result.startsWith('ERROR') };
        }
        const verification = await desktopFocusWindowVerified(sessionId, String(args.name || ''), {
          includeScreenshot: args.include_screenshot !== false,
          skipOcr: args.skip_ocr !== false && args.skipOcr !== false,
        });
        if (!verification.ok) {
          return { name, args, result: verification.message, error: true };
        }
        return {
          name,
          args,
          result: verification.verification.summary,
          data: verification.verification,
          error: false,
        };
      }
      case 'desktop_window_control': {
        const actionRaw = String(args.action || '').toLowerCase();
        const action =
          actionRaw === 'minimize' || actionRaw === 'maximize' || actionRaw === 'restore' || actionRaw === 'close'
            ? actionRaw
            : 'restore';
        const result = await desktopWindowControl(action, {
          window_token: args.window_token == null ? undefined : String(args.window_token),
          window_id: args.window_id == null ? undefined : String(args.window_id),
          window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
          app_id: args.app_id == null ? undefined : String(args.app_id),
          title: args.title == null ? undefined : String(args.title),
          name: args.name == null ? undefined : String(args.name),
          handle: args.handle == null ? undefined : Number(args.handle),
          active: args.active === true,
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_click': {
        const clickTarget = {
          x: Number(args.x),
          y: Number(args.y),
          element: args.element == null ? undefined : Number(args.element),
          coordinate_space: args.coordinate_space as any,
          screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
          window_name: args.window_name == null ? undefined : String(args.window_name),
          window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
          ...parseDesktopPointerMonitorArgs(args),
        };
        let resolved = await resolveDesktopActionPoint(sessionId, clickTarget, 'desktop_click');

        // Auto-retry once when the failure is a stale screenshot_id: recapture the same
        // window (or full screen) and re-resolve with the fresh screenshot_id.
        if (!resolved.ok && clickTarget.screenshot_id) {
          const msg = resolved.message;
          const isStale =
            msg.includes('is stale') ||
            msg.includes('predates desktop action tracking') ||
            /is \d+s old/.test(msg);
          if (isStale) {
            const oldPacket = getDesktopAdvisorPacketById(sessionId, clickTarget.screenshot_id);
            const freshCapture = oldPacket?.targetWindow
              ? await desktopWindowScreenshot(sessionId, {
                  handle: oldPacket.targetWindow.handle,
                  name: oldPacket.targetWindow.title,
                  focus_first: true,
                }).catch(() => null)
              : await desktopScreenshotWithHistory(sessionId).catch(() => null);
            const freshIdMatch = freshCapture?.match(/Screenshot ID:\s*(ds_[^\s.]+)/);
            const freshId = freshIdMatch ? freshIdMatch[1] : null;
            if (freshId) {
              const retryResolved = await resolveDesktopActionPoint(
                sessionId,
                { ...clickTarget, screenshot_id: freshId },
                'desktop_click',
              );
              if (retryResolved.ok) {
                resolved = retryResolved;
              }
            }
          }
        }

        const finalActionApprovalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
        if (resolved.ok && finalActionApprovalId) {
          const gate = consumeFinalActionApproval({ sessionId, approvalId: finalActionApprovalId, toolName: name, toolArgs: args });
          if (!gate.ok) return { name, args, result: `ERROR: ${gate.message}`, error: true };
        }
        const hasFinalActionApproval = !!finalActionApprovalId;
        let result = !resolved.ok
          ? `ERROR: ${resolved.message}`
          : await desktopClick(
              resolved.point.x,
              resolved.point.y,
              String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
              args.double_click === true,
              undefined,
              args.modifier === 'shift' || args.modifier === 'ctrl' || args.modifier === 'alt'
                ? args.modifier
                : undefined,
              resolved.point.sourceNote,
              {
                mode: args.verify,
                coordinateSpace: resolved.point.coordinateSpace,
                allowRetryOnLikelyNoop: args.verify === 'strict',
              },
            );
        if (!result.startsWith('ERROR') && (args.capture_after === true || hasFinalActionApproval)) {
          const after = await desktopScreenshotWithHistory(sessionId, { capture: 'all' });
          result += `\n\nCapture after action:\n${after}`;
        }
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_drag': {
        const sharedTarget = {
          coordinate_space: args.coordinate_space as any,
          screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
          window_name: args.window_name == null ? undefined : String(args.window_name),
          window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
          ...parseDesktopPointerMonitorArgs(args),
        };
        const fromPoint = await resolveDesktopActionPoint(sessionId, {
          x: Number(args.from_x),
          y: Number(args.from_y),
          ...sharedTarget,
        }, 'desktop_drag.from');
        const toPoint = fromPoint.ok
          ? await resolveDesktopActionPoint(sessionId, {
              x: Number(args.to_x),
              y: Number(args.to_y),
              ...sharedTarget,
            }, 'desktop_drag.to')
          : fromPoint;
        let result = !fromPoint.ok
          ? `ERROR: ${fromPoint.message}`
          : !toPoint.ok
            ? `ERROR: ${toPoint.message}`
            : await desktopDrag(
                fromPoint.point.x,
                fromPoint.point.y,
                toPoint.point.x,
                toPoint.point.y,
                Number(args.steps || 20),
                undefined,
                `${fromPoint.point.sourceNote} -> ${toPoint.point.sourceNote}`,
                {
                  mode: args.verify,
                  coordinateSpace: fromPoint.point.coordinateSpace,
                },
              );
        if (!result.startsWith('ERROR') && args.capture_after === true) {
          const after = await desktopScreenshotWithHistory(sessionId, { capture: 'all' });
          result += `\n\nCapture after action:\n${after}`;
        }
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_wait': {
        const result = await desktopWait(Number(args.ms || 500), deps.abortSignal?.signal);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_type': {
        let result = await desktopType(String(args.text || ''));
        if (!result.startsWith('ERROR') && args.capture_after === true) {
          const after = await desktopScreenshotWithHistory(sessionId, { capture: 'all' });
          result += `\n\nCapture after action:\n${after}`;
        }
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_press_key': {
        const finalActionApprovalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
        const hasFinalActionApproval = !!finalActionApprovalId;
        if (finalActionApprovalId) {
          const gate = consumeFinalActionApproval({ sessionId, approvalId: finalActionApprovalId, toolName: name, toolArgs: args });
          if (!gate.ok) return { name, args, result: `ERROR: ${gate.message}`, error: true };
        }
        let result = await desktopPressKey(String(args.key || 'Enter'));
        if (!result.startsWith('ERROR') && hasFinalActionApproval) {
          const after = await desktopScreenshotWithHistory(sessionId, { capture: 'all' });
          result += `\n\nCapture after action:\n${after}`;
        }
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_get_clipboard': {
        const result = await desktopGetClipboard(args || {});
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_set_clipboard': {
        const result = await desktopSetClipboard(args || {});
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Phase 4: App launch / process control
      case 'desktop_list_installed_apps': {
        const result = await desktopListInstalledApps(
          String(args.filter || ''),
          Number(args.limit || 40),
          args.refresh === true,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_find_installed_app': {
        const result = await desktopFindInstalledApp(
          String(args.query || ''),
          Number(args.limit || 10),
          args.refresh === true,
          args.exact === true,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_launch_app': {
        const result = await desktopLaunchApp(
          String(args.app || ''),
          String(args.args || ''),
          Number(args.wait_ms || 6000),
          String(args.app_id || ''),
          { enableAccessibility: args.enable_accessibility === true },
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_close_app': {
        const result = await desktopCloseApp(String(args.name || args.app || args.title || args.query || ''), args.force === true);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_get_process_list': {
        const result = await desktopGetProcessList(String(args.filter || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Phase 3: Screenshot diffing
      case 'desktop_wait_for_change': {
        const result = await desktopWaitForChange(
          sessionId,
          Number(args.timeout_ms || 10000),
          Number(args.poll_ms || 800),
          deps.abortSignal?.signal,
        );
        return { name, args, result, error: false };
      }
      case 'desktop_diff_screenshot': {
        const result = await desktopDiffScreenshot(sessionId);
        return { name, args, result, error: false };
      }

      // Canonical app / window / state model (Phase 1)
      case 'desktop_list_apps': {
        const result = await desktopListApps(String(args.filter || ''), args.include_windows !== false, {
          scope: args.scope,
          compact: args.compact !== false,
          limit: args.limit,
          cursor: args.cursor,
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_list_windows': {
        const result = await desktopListWindowsCanonical({
          app_id: args.app_id == null ? undefined : String(args.app_id),
          process_name: args.process_name == null ? undefined : String(args.process_name),
          title: args.title == null ? undefined : String(args.title),
          filter: args.filter == null ? undefined : String(args.filter),
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_get_window_state': {
        const result = await desktopGetWindowState(sessionId, {
          window_token: args.window_token == null ? undefined : String(args.window_token),
          window_id: args.window_id == null ? undefined : String(args.window_id),
          window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
          app_id: args.app_id == null ? undefined : String(args.app_id),
          title: args.title == null ? undefined : String(args.title),
          include_screenshot: args.include_screenshot !== false,
          include_text: args.include_text === true,
          focus_first: args.focus_first === true,
          signal: deps.abortSignal?.signal,
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_locate_text': {
        const result = await desktopLocateText(sessionId, {
          screenshot_id: String(args.screenshot_id || ''),
          query: String(args.query || ''),
          min_confidence: args.min_confidence == null ? undefined : Number(args.min_confidence),
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_click_text': {
        const result = await desktopClickText(sessionId, {
          screenshot_id: String(args.screenshot_id || ''),
          query: String(args.query || ''),
          min_confidence: args.min_confidence == null ? undefined : Number(args.min_confidence),
          button: String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
          verify: args.verify,
        }, deps.abortSignal?.signal);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_get_accessibility_state': {
        const result = await desktopGetAccessibilityState({
          window_token: args.window_token == null ? undefined : String(args.window_token),
          window_id: args.window_id == null ? undefined : String(args.window_id),
          window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
          app_id: args.app_id == null ? undefined : String(args.app_id),
          title: args.title == null ? undefined : String(args.title),
        }, args.max_depth == null ? undefined : Number(args.max_depth), args.max_nodes == null ? undefined : Number(args.max_nodes), deps.abortSignal?.signal, { limit: args.limit, cursor: args.cursor, compact: args.compact !== false });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_accessibility_action': {
        if (args.atomic === true || (args.state_id == null && (args.element_name != null || args.automation_id != null))) {
          const result = await desktopAccessibilityFindAndAct({
            selector: { window_token: args.window_token, window_id: args.window_id, window_handle: args.window_handle, app_id: args.app_id, title: args.title },
            name: args.element_name == null ? undefined : String(args.element_name),
            automation_id: args.automation_id == null ? undefined : String(args.automation_id),
            role: args.role == null ? undefined : String(args.role),
            action: String(args.semantic_action || 'invoke') as any,
            value: args.value == null ? undefined : String(args.value),
            signal: deps.abortSignal?.signal,
          });
          return { name, args, result, error: result.startsWith('ERROR') };
        }
        const result = await desktopAccessibilityAction({
          state_id: String(args.state_id || ''),
          element_id: String(args.element_id || ''),
          action: String(args.semantic_action || '') as any,
          value: args.value == null ? undefined : String(args.value),
          signal: deps.abortSignal?.signal,
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Window-scoped input (Phase 2)
      case 'desktop_window_click': {
        const selector = {
          window_token: args.window_token == null ? undefined : String(args.window_token),
          window_id: args.window_id == null ? undefined : String(args.window_id),
          window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
          app_id: args.app_id == null ? undefined : String(args.app_id),
          title: args.title == null ? undefined : String(args.title),
        };
        const finalActionApprovalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
        if (finalActionApprovalId) {
          const gate = consumeFinalActionApproval({ sessionId, approvalId: finalActionApprovalId, toolName: name, toolArgs: args });
          if (!gate.ok) return { name, args, result: `ERROR: ${gate.message}`, error: true };
        }
        const result = await desktopWindowClick(
          selector,
          {
            x: Number(args.x),
            y: Number(args.y),
            coordinate_space: args.coordinate_space as any,
            screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
          },
          {
            button: String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
            double_click: args.double_click === true,
            modifier: args.modifier === 'shift' || args.modifier === 'ctrl' || args.modifier === 'alt' ? args.modifier : undefined,
            verify: args.verify,
            focus_first: args.focus_first !== false,
            signal: deps.abortSignal?.signal,
            dispatch: args.dispatch == null ? undefined : String(args.dispatch),
          },
          sessionId,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_window_type': {
        const result = await desktopWindowType(
          {
            window_token: args.window_token == null ? undefined : String(args.window_token),
            window_id: args.window_id == null ? undefined : String(args.window_id),
            window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
            app_id: args.app_id == null ? undefined : String(args.app_id),
            title: args.title == null ? undefined : String(args.title),
          },
          String(args.text || ''),
          args.raw === true,
          deps.abortSignal?.signal,
          { dispatch: args.dispatch == null ? undefined : String(args.dispatch), verify: args.verify == null ? undefined : String(args.verify) },
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_window_press_key': {
        const finalActionApprovalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
        if (finalActionApprovalId) {
          const gate = consumeFinalActionApproval({ sessionId, approvalId: finalActionApprovalId, toolName: name, toolArgs: args });
          if (!gate.ok) return { name, args, result: `ERROR: ${gate.message}`, error: true };
        }
        const result = await desktopWindowPressKey(
          {
            window_token: args.window_token == null ? undefined : String(args.window_token),
            window_id: args.window_id == null ? undefined : String(args.window_id),
            window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
            app_id: args.app_id == null ? undefined : String(args.app_id),
            title: args.title == null ? undefined : String(args.title),
          },
          String(args.key || 'Enter'),
          deps.abortSignal?.signal,
          { dispatch: args.dispatch == null ? undefined : String(args.dispatch), verify: args.verify == null ? undefined : String(args.verify) },
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_window_scroll': {
        const dir = String(args.direction || 'down').toLowerCase();
        const result = await desktopWindowScroll(
          {
            window_token: args.window_token == null ? undefined : String(args.window_token),
            window_id: args.window_id == null ? undefined : String(args.window_id),
            window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
            app_id: args.app_id == null ? undefined : String(args.app_id),
            title: args.title == null ? undefined : String(args.title),
          },
          {
            direction: (dir === 'up' || dir === 'left' || dir === 'right' ? dir : 'down') as 'up' | 'down' | 'left' | 'right',
            amount: args.amount == null ? undefined : Number(args.amount),
            x: args.x == null ? undefined : Number(args.x),
            y: args.y == null ? undefined : Number(args.y),
            coordinate_space: args.coordinate_space as any,
            screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
            focus_first: args.focus_first !== false,
            dispatch: args.dispatch == null ? undefined : String(args.dispatch),
            verify: args.verify == null ? undefined : String(args.verify),
          },
          sessionId,
          deps.abortSignal?.signal,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_window_drag': {
        const result = await desktopWindowDrag(
          {
            window_token: args.window_token == null ? undefined : String(args.window_token),
            window_id: args.window_id == null ? undefined : String(args.window_id),
            window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
            app_id: args.app_id == null ? undefined : String(args.app_id),
            title: args.title == null ? undefined : String(args.title),
          },
          {
            from_x: Number(args.from_x),
            from_y: Number(args.from_y),
            to_x: Number(args.to_x),
            to_y: Number(args.to_y),
            steps: args.steps == null ? undefined : Number(args.steps),
            coordinate_space: args.coordinate_space as any,
            screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
            focus_first: args.focus_first !== false,
            dispatch: args.dispatch == null ? undefined : String(args.dispatch),
          },
          sessionId,
          deps.abortSignal?.signal,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Previously-orphaned tools now wired into the chat/subagent dispatch
      case 'desktop_get_window_text': {
        let windowName = args.window_name == null ? undefined : String(args.window_name);
        if (args.window_token || args.window_id || args.window_handle || args.app_id || args.title) {
          const resolved = await resolveCanonicalWindow({
            window_token: args.window_token == null ? undefined : String(args.window_token),
            window_id: args.window_id == null ? undefined : String(args.window_id),
            window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
            app_id: args.app_id == null ? undefined : String(args.app_id),
            title: args.title == null ? undefined : String(args.title),
          });
          if (!resolved.ok) return { name, args, result: `ERROR: [${resolved.code}] ${resolved.message}`, error: true };
          windowName = resolved.window.title;
        }
        const result = await desktopGetWindowText(windowName, {
          query: args.query == null ? undefined : String(args.query),
          max_chars: args.max_chars == null ? undefined : Number(args.max_chars),
          max_lines: args.max_lines == null ? undefined : Number(args.max_lines),
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_get_accessibility_tree': {
        let windowName = args.window_name == null ? undefined : String(args.window_name);
        if (args.window_token || args.window_id || args.window_handle || args.app_id || args.title) {
          const resolved = await resolveCanonicalWindow({
            window_token: args.window_token == null ? undefined : String(args.window_token),
            window_id: args.window_id == null ? undefined : String(args.window_id),
            window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
            app_id: args.app_id == null ? undefined : String(args.app_id),
            title: args.title == null ? undefined : String(args.title),
          });
          if (!resolved.ok) return { name, args, result: `ERROR: [${resolved.code}] ${resolved.message}`, error: true };
          windowName = resolved.window.title;
        }
        const result = await desktopGetAccessibilityTree(
          windowName,
          args.max_depth == null ? undefined : Number(args.max_depth),
          args.max_nodes == null ? undefined : Number(args.max_nodes),
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_pixel_watch': {
        const result = await desktopPixelWatch(
          Number(args.x),
          Number(args.y),
          args.target_color == null ? undefined : String(args.target_color),
          args.timeout_ms == null ? undefined : Number(args.timeout_ms),
          args.poll_ms == null ? undefined : Number(args.poll_ms),
          deps.abortSignal?.signal,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_record_macro': {
        const result = desktopRecordMacro(String(args.name || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_stop_macro': {
        const result = desktopStopMacro(args.name == null ? undefined : String(args.name));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_replay_macro': {
        const result = await desktopReplayMacro(
          String(args.name || ''),
          args.speed_multiplier == null ? undefined : Number(args.speed_multiplier),
          deps.abortSignal?.signal,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_list_macros': {
        const result = desktopListMacros();
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_background_status': {
        const result = await desktopBackgroundStatus();
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_background_prepare_sandbox': {
        const result = await desktopBackgroundPrepareSandbox({
          launch: args.launch === true,
          networking: args.networking,
          vgpu: args.vgpu,
          memory_mb: args.memory_mb == null ? undefined : Number(args.memory_mb),
          session_id: sessionId,
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_background_command': {
        const result = await desktopBackgroundCommand({
          action: args.action,
          window_id: args.window_id == null ? undefined : String(args.window_id),
          title: args.title == null ? undefined : String(args.title),
          x: args.x == null ? undefined : Number(args.x),
          y: args.y == null ? undefined : Number(args.y),
          text: args.text == null ? undefined : String(args.text),
          key: args.key == null ? undefined : String(args.key),
          command: args.command == null ? undefined : String(args.command),
          ms: args.ms == null ? undefined : Number(args.ms),
          timeout_ms: args.timeout_ms == null ? undefined : Number(args.timeout_ms),
          include_screenshot: args.include_screenshot !== false,
          include_text: args.include_text === true,
          max_depth: args.max_depth == null ? undefined : Number(args.max_depth),
          max_nodes: args.max_nodes == null ? undefined : Number(args.max_nodes),
          session_id: sessionId,
          signal: deps.abortSignal?.signal,
        } as any);
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Mouse wheel scroll
      case 'desktop_scroll': {
        const dir = String(args.direction || 'down').toLowerCase();
        const horizontal = String(args.axis || '').toLowerCase() === 'horizontal' || dir === 'left' || dir === 'right';
        const hasTargetingArgs =
          args.x !== undefined ||
          args.y !== undefined ||
          args.coordinate_space !== undefined ||
          args.screenshot_id !== undefined ||
          args.window_name !== undefined ||
          args.window_handle !== undefined ||
          args.monitor_relative === true ||
          args.monitor_relative === 'true';
        let result: string;
        if (hasTargetingArgs) {
          if (args.x === undefined || args.y === undefined) {
            result = 'ERROR: desktop_scroll coordinate targeting requires both x and y.';
          } else {
            const resolved = await resolveDesktopActionPoint(sessionId, {
              x: Number(args.x),
              y: Number(args.y),
              coordinate_space: args.coordinate_space as any,
              screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
              window_name: args.window_name == null ? undefined : String(args.window_name),
              window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
              ...parseDesktopPointerMonitorArgs(args),
            }, 'desktop_scroll');
            result = !resolved.ok
              ? `ERROR: ${resolved.message}`
              : await desktopScroll(
                  dir === 'up' || dir === 'left' ? (dir as 'up' | 'left') : (dir === 'right' ? 'right' : 'down'),
                  Number(args.amount || 3),
                  resolved.point.x,
                  resolved.point.y,
                  horizontal,
                  undefined,
                  resolved.point.sourceNote,
                  {
                    mode: args.verify,
                    coordinateSpace: resolved.point.coordinateSpace,
                  },
                );
          }
        } else {
          result = await desktopScroll(
            dir === 'up' || dir === 'left' ? (dir as 'up' | 'left') : (dir === 'right' ? 'right' : 'down'),
            Number(args.amount || 3),
            undefined,
            undefined,
            horizontal,
            undefined,
            undefined,
            {
              mode: args.verify,
            },
          );
        }
        if (!result.startsWith('ERROR') && args.capture_after === true) {
          const after = await desktopScreenshotWithHistory(sessionId, { capture: 'all' });
          result += `\n\nCapture after action:\n${after}`;
        }
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Raw key-by-key typing fallback (for apps that block clipboard paste)
      case 'desktop_type_raw': {
        const result = await desktopTypeRaw(String(args.text || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Send last screenshot to Telegram
      case 'desktop_send_to_telegram': {
        const caption = String(args.caption || 'Desktop screenshot');
        const delivered = await executeDeliverySendScreenshot({ source: 'desktop_new', target: 'telegram', caption }, workspacePath, deps, sessionId);
        return { name, args, result: delivered.result, error: delivered.error };
      }

      // Phase 5: Structured desktop task runner (removed — module deleted)
      case 'desktop_task': {
        return { name, args, result: 'ERROR: desktop_task is not available (desktop-task-runner module was removed).', error: true };
      }
      default:
        return undefined;
  }
}
