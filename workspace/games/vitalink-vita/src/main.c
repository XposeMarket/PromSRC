#include <psp2/ctrl.h>
#include <psp2/io/fcntl.h>
#include <psp2/kernel/processmgr.h>
#include <psp2/kernel/threadmgr.h>
#include <stdio.h>
#include <string.h>
#include <vita2d.h>
#include "bt_adapter.h"

#define LOG_PATH "ux0:data/vitalink-probe-report.txt"

static VitaLinkProbe probes[12];
static size_t probe_count;
static vita2d_pgf *font;
static int renderer_init_result;
static int font_load_result;

static void draw_text(int x, int y, unsigned int color, float scale, const char *value) {
  if (font && value) vita2d_pgf_draw_text(font, x, y, color, scale, value);
}

static void export_report(void) {
  SceUID fd = sceIoOpen(LOG_PATH, SCE_O_WRONLY | SCE_O_CREAT | SCE_O_TRUNC, 0666);
  if (fd < 0) return;

  char head[320];
  int head_len = snprintf(head, sizeof(head),
    "VitaLink Gate 1 Bluetooth capability report\n"
    "Status: software-only diagnostic; no Bluetooth role was activated.\n"
    "Renderer: vita2d\nRenderer init: 0x%08X\nDefault PGF font: 0x%08X\n\n",
    (unsigned)renderer_init_result, (unsigned)font_load_result);
  if (head_len > 0) sceIoWrite(fd, head, (SceSize)head_len);

  for (size_t i = 0; i < probe_count; ++i) {
    char line[320];
    int n = snprintf(line, sizeof(line), "%s: %s\n  %s\n",
      probes[i].name, vitalink_probe_state_name(probes[i].state), probes[i].detail);
    if (n > 0) sceIoWrite(fd, line, (SceSize)n);
  }
  sceIoClose(fd);
}

int main(void) {
  probe_count = vitalink_collect_bluetooth_probes(probes, sizeof(probes) / sizeof(probes[0]));

  renderer_init_result = vita2d_init();
  vita2d_set_clear_color(0xFF101720);
  font = vita2d_load_default_pgf();
  font_load_result = font ? 0 : -1;
  export_report();

  SceCtrlData pad = {0};
  unsigned int previous_buttons = 0;
  int offset = 0;

  while (1) {
    sceCtrlPeekBufferPositive(0, &pad, 1);
    const unsigned int pressed = pad.buttons & ~previous_buttons;
    previous_buttons = pad.buttons;

    if (pressed & SCE_CTRL_START) break;
    if (pressed & SCE_CTRL_CROSS) export_report();
    if (pressed & SCE_CTRL_DOWN) offset = 42;
    if (pressed & SCE_CTRL_UP) offset = 0;

    vita2d_start_drawing();
    vita2d_clear_screen();
    draw_text(32, 42, 0xFFFFFFFF, 1.0f, "VITALINK / GATE 1 BLUETOOTH PROBE");
    draw_text(32, 70, 0xFFB8C4D0, 0.8f, "SAFE SOFTWARE PROBE - RADIO UNCHANGED");

    for (size_t i = 0; i < probe_count && i < 9; ++i) {
      const int y = 116 + (int)i * 42 - offset;
      draw_text(32, y, 0xFFE0E8F0, 0.75f, probes[i].name);
      draw_text(420, y, 0xFF78D8FF, 0.75f, vitalink_probe_state_name(probes[i].state));
    }

    draw_text(32, 490, 0xFF9DB3C7, 0.72f, "X: SAVE REPORT   UP/DOWN: SCROLL   START: EXIT");
    draw_text(32, 520, 0xFF9DB3C7, 0.68f, LOG_PATH);
    vita2d_end_drawing();
    vita2d_swap_buffers();
  }

  if (font) vita2d_free_pgf(font);
  vita2d_fini();
  sceKernelExitProcess(0);
  return 0;
}
