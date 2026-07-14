#include <psp2common/net.h>
#include <psp2kern/ctrl.h>
#include <psp2kern/kernel/modulemgr.h>
#include <psp2kern/kernel/threadmgr.h>
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

  while (running) {
    int sock = ksceNetSocket("prom_vita_input", SCE_NET_AF_INET,
                             SCE_NET_SOCK_DGRAM, SCE_NET_IPPROTO_UDP);
    if (sock < 0) {
      ksceKernelDelayThread(1000 * 1000);
      continue;
    }

    SceNetSockaddrIn address;
    memset(&address, 0, sizeof(address));
    address.sin_len = sizeof(address);
    address.sin_family = SCE_NET_AF_INET;
    address.sin_port = ksceNetHtons(INPUT_PORT);
    address.sin_addr.s_addr = SCE_NET_INADDR_ANY;

    if (ksceNetBind(sock, (const SceNetSockaddr *)&address, sizeof(address)) < 0) {
      ksceNetClose(sock);
      ksceKernelDelayThread(1000 * 1000);
      continue;
    }

    uint32_t last_sequence = 0;
    while (running) {
      InputPacket packet;
      SceNetSockaddrIn sender;
      unsigned int sender_len = sizeof(sender);
      memset(&sender, 0, sizeof(sender));
      int received = ksceNetRecvfrom(sock, &packet, sizeof(packet),
                                     SCE_NET_MSG_DONTWAIT,
                                     (SceNetSockaddr *)&sender, &sender_len);
      if (received == (int)sizeof(packet) &&
          packet.magic == PACKET_MAGIC &&
          packet.version == PACKET_VERSION &&
          packet.size == sizeof(packet) &&
          packet.checksum == fnv_checksum(&packet, sizeof(packet)) &&
          packet.sequence != last_sequence) {
        int button_result = 0;
        int analog_result = 0;
        last_sequence = packet.sequence;
        apply_input(&packet, &button_result, &analog_result);

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
        ksceNetSendto(sock, &ack, sizeof(ack), 0,
                      (const SceNetSockaddr *)&sender, sender_len);
      }
      ksceKernelDelayThread(5 * 1000);
    }
    ksceNetClose(sock);
  }

  release_input();
  return 0;
}

int module_start(SceSize args, void *argp) {
  (void)args;
  (void)argp;
  running = 1;
  worker_uid = ksceKernelCreateThread("prom_vita_input_thread", input_thread,
                                      0x40, 0x1000, 0, 0x10000, 0);
  if (worker_uid < 0) return SCE_KERNEL_START_FAILED;
  if (ksceKernelStartThread(worker_uid, 0, 0) < 0) return SCE_KERNEL_START_FAILED;
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
