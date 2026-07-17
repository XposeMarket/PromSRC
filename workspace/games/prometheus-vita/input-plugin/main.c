#include <psp2common/net.h>
#include <psp2kern/ctrl.h>
#include <psp2kern/display.h>
#include <psp2kern/kernel/cpu.h>
#include <psp2kern/kernel/modulemgr.h>
#include <psp2kern/kernel/sysclib.h>
#include <psp2kern/kernel/threadmgr.h>
#include <psp2kern/kernel/sysmem/data_transfers.h>
#include <psp2kern/io/fcntl.h>
#include <psp2kern/netps.h>
#include <stdint.h>
#include <string.h>

#define INPUT_PORT 18791
#define PACKET_MAGIC 0x50495650u /* PVIP */
#define PACKET_VERSION 2
#define HOLD_SAMPLES 12
#define ACK_MAGIC 0x4B415650u /* PVAK */
#define ACK_VERSION 1
#define ACK_STATUS_APPLIED 1u
#define LOG_PATH "ur0:data/prometheus_vita_input.log"

#pragma pack(push, 1)
typedef struct InputPacket {
  uint32_t magic;
  uint16_t version;
  uint16_t size;
  uint32_t sequence;
  uint32_t buttons;
  uint8_t lx;
  uint8_t ly;
  uint8_t rx;
  uint8_t ry;
  uint32_t checksum;
} InputPacket;

typedef struct AckPacket {
  uint32_t magic;
  uint16_t version;
  uint16_t size;
  uint32_t sequence;
  uint32_t status;
  int32_t button_result;
  int32_t analog_result;
  uint32_t checksum;
} AckPacket;
#pragma pack(pop)

static volatile int running = 0;
static SceUID worker_uid = -1;
#define CAPTURE_WIDTH 240
#define CAPTURE_HEIGHT 136
static uint16_t capture_pixels[CAPTURE_WIDTH * CAPTURE_HEIGHT];
static uint32_t capture_row[960];

/* Narrow syscall surface used by the SceShell Wi-Fi companion. Only scalar
   controller state crosses the user/kernel boundary. */
int promVitaSetButtons(uint32_t buttons, uint32_t samples) {
  return ksceCtrlSetButtonEmulation(0, 0, buttons, buttons, samples);
}

int promVitaSetAnalog(uint32_t lx, uint32_t ly, uint32_t rx, uint32_t ry,
                      uint32_t samples) {
  return ksceCtrlSetAnalogEmulation(0, 0, (uint8_t)lx, (uint8_t)ly,
                                    (uint8_t)rx, (uint8_t)ry,
                                    (uint8_t)lx, (uint8_t)ly,
                                    (uint8_t)rx, (uint8_t)ry, samples);
}

int promVitaCaptureFrame(void *user_dst, uint32_t capacity) {
  if (!user_dst || capacity < sizeof(capture_pixels)) return -1;
  uint32_t state; int result = 0; ENTER_SYSCALL(state);
  SceDisplayFrameBufInfo info; memset(&info, 0, sizeof(info)); info.size = sizeof(info);
  int head = ksceDisplayGetPrimaryHead();
  result = ksceDisplayGetProcFrameBufInternal(-1, head, 0, &info);
  if (result < 0 || info.paddr == 0)
    result = ksceDisplayGetProcFrameBufInternal(-1, head, 1, &info);
  if (result < 0 || !info.framebuf.base || info.framebuf.width > 960 || info.framebuf.height == 0) goto done;
  for (int y = 0; y < CAPTURE_HEIGHT; ++y) {
    unsigned int sy = (unsigned int)y * info.framebuf.height / CAPTURE_HEIGHT;
    uintptr_t source = (uintptr_t)info.framebuf.base + sy * info.framebuf.pitch * 4;
    result = ksceKernelMemcpyUserToKernelForPid(info.pid, capture_row, (const void *)source,
                                                info.framebuf.width * 4);
    if (result < 0) goto done;
    for (int x = 0; x < CAPTURE_WIDTH; ++x) {
      unsigned int sx = (unsigned int)x * info.framebuf.width / CAPTURE_WIDTH;
      uint32_t pixel = capture_row[sx];
      uint16_t r = (pixel & 0xFF) >> 3;
      uint16_t g = ((pixel >> 8) & 0xFF) >> 2;
      uint16_t b = ((pixel >> 16) & 0xFF) >> 3;
      capture_pixels[y * CAPTURE_WIDTH + x] = (uint16_t)((r << 11) | (g << 5) | b);
    }
  }
  result = ksceKernelMemcpyKernelToUser(user_dst, capture_pixels,
                                        sizeof(capture_pixels));
  if (result >= 0) result = sizeof(capture_pixels);
done:
  EXIT_SYSCALL(state); return result;
}

static void log_status(const char *stage, int value) {
  char line[128];
  int length = snprintf(line, sizeof(line), "%s 0x%08X\n", stage,
                        (unsigned int)value);
  SceUID fd = ksceIoOpen(LOG_PATH, SCE_O_WRONLY | SCE_O_CREAT | SCE_O_APPEND,
                         0666);
  if (fd >= 0) {
    if (length > 0) ksceIoWrite(fd, line, (SceSize)length);
    ksceIoClose(fd);
  }
}

static uint32_t fnv_checksum(const void *value, unsigned int size) {
  const uint8_t *bytes = (const uint8_t *)value;
  uint32_t hash = 2166136261u;
  unsigned int i;
  for (i = 0; i < size - sizeof(uint32_t); ++i) {
    hash ^= bytes[i];
    hash *= 16777619u;
  }
  return hash;
}

static void release_input(void) {
  ksceCtrlSetButtonEmulation(0, 0, 0, 0, 1);
  ksceCtrlSetAnalogEmulation(0, 0, 0x80, 0x80, 0x80, 0x80,
                            0x80, 0x80, 0x80, 0x80, 1);
}

static void apply_input(const InputPacket *p, int *button_result,
                        int *analog_result) {
  *button_result = ksceCtrlSetButtonEmulation(
      0, 0, p->buttons, p->buttons, HOLD_SAMPLES);
  *analog_result = ksceCtrlSetAnalogEmulation(
      0, 0, p->lx, p->ly, p->rx, p->ry,
      p->lx, p->ly, p->rx, p->ry, HOLD_SAMPLES);
}

static int input_thread(SceSize args, void *argp) {
  (void)args;
  (void)argp;

  /* Kernel plugins start long before Wi-Fi and ux0 are guaranteed ready. */
  ksceKernelDelayThread(15 * 1000 * 1000);
  log_status("thread-ready", 0);
  while (running) {
    int sock = ksceNetSocket("prom_vita_input", SCE_NET_AF_INET,
                             SCE_NET_SOCK_DGRAM, SCE_NET_IPPROTO_UDP);
    if (sock < 0) {
      log_status("socket-failed", sock);
      ksceKernelDelayThread(1000 * 1000);
      continue;
    }
    log_status("socket-open", sock);

    SceNetSockaddrIn address;
    memset(&address, 0, sizeof(address));
    address.sin_len = sizeof(address);
    address.sin_family = SCE_NET_AF_INET;
    address.sin_port = ksceNetHtons(INPUT_PORT);
    address.sin_addr.s_addr = SCE_NET_INADDR_ANY;

    int bind_result = ksceNetBind(sock, (const SceNetSockaddr *)&address,
                                  sizeof(address));
    if (bind_result < 0) {
      log_status("bind-failed", bind_result);
      ksceNetClose(sock);
      ksceKernelDelayThread(1000 * 1000);
      continue;
    }
    log_status("listening-18791", bind_result);

    uint32_t last_sequence = 0;
    int idle_polls = 0;
    while (running) {
      InputPacket packet;
      SceNetSockaddrIn sender;
      unsigned int sender_len = sizeof(sender);
      memset(&sender, 0, sizeof(sender));
      int received = ksceNetRecvfrom(sock, &packet, sizeof(packet),
                                     SCE_NET_MSG_DONTWAIT,
                                     (SceNetSockaddr *)&sender, &sender_len);
      if (received > 0) log_status("packet-received", received);
      if (received > 0 && received != (int)sizeof(packet))
        log_status("bad-packet-size", received);
      if (received == (int)sizeof(packet) && packet.magic != PACKET_MAGIC)
        log_status("bad-magic", (int)packet.magic);
      else if (received == (int)sizeof(packet) && packet.version != PACKET_VERSION)
        log_status("bad-version", (int)packet.version);
      else if (received == (int)sizeof(packet) && packet.size != sizeof(packet))
        log_status("bad-declared-size", (int)packet.size);
      else if (received == (int)sizeof(packet) &&
               packet.checksum != fnv_checksum(&packet, sizeof(packet)))
        log_status("bad-checksum", (int)packet.checksum);
      else if (received == (int)sizeof(packet) && packet.sequence == last_sequence)
        log_status("duplicate-sequence", (int)packet.sequence);
      else if (received == (int)sizeof(packet)) {
        int button_result = 0;
        int analog_result = 0;
        last_sequence = packet.sequence;
        apply_input(&packet, &button_result, &analog_result);
        log_status("packet-applied", button_result);

        AckPacket ack;
        memset(&ack, 0, sizeof(ack));
        ack.magic = ACK_MAGIC;
        ack.version = ACK_VERSION;
        ack.size = sizeof(ack);
        ack.sequence = packet.sequence;
        ack.status = ACK_STATUS_APPLIED;
        ack.button_result = button_result;
        ack.analog_result = analog_result;
        ack.checksum = fnv_checksum(&ack, sizeof(ack));
        int send_result = ksceNetSendto(sock, &ack, sizeof(ack), 0,
                                        (const SceNetSockaddr *)&sender,
                                        sender_len);
        if (send_result < 0) log_status("ack-failed", send_result);
        idle_polls = 0;
      }
      ksceKernelDelayThread(5 * 1000);
      if (received <= 0 && ++idle_polls >= 3000) {
        log_status("listener-recycle", received);
        break;
      }
    }
    ksceNetClose(sock);
  }

  release_input();
  return 0;
}

int module_start(SceSize args, void *argp) {
  (void)args;
  (void)argp;
  running = 0;
  worker_uid = -1;
  log_status("syscall-bridge-ready", 0);
  return SCE_KERNEL_START_SUCCESS;
}

int module_stop(SceSize args, void *argp) {
  (void)args;
  (void)argp;
  running = 0;
  if (worker_uid >= 0) {
    ksceKernelWaitThreadEnd(worker_uid, 0, 0);
    ksceKernelDeleteThread(worker_uid);
    worker_uid = -1;
  }
  release_input();
  return SCE_KERNEL_STOP_SUCCESS;
}

void _start() __attribute__((weak, alias("module_start")));
