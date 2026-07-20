#include <psp2kern/bt.h>
#include <psp2kern/io/fcntl.h>
#include <psp2kern/io/stat.h>
#include <psp2kern/kernel/modulemgr.h>
#include <psp2kern/kernel/threadmgr.h>

#define ROOT_MARKER "ur0:data/vitalink-gate2-r11-start.txt"
#define LOG_DIR     "ur0:data/vitalink"
#define LOG_PATH    LOG_DIR "/kernel-probe-r11.txt"
#define START_DELAY_US 30000000
#define OBSERVE_INTERVAL_US 100000
#define OBSERVE_COUNT 900
#define MAX_CALLBACK_RECORDS 256

typedef struct CallbackRecord {
  unsigned int sequence;
  unsigned int tick;
  int notify_id;
  int notify_count;
  int notify_arg;
  unsigned int common;
  int last_error;
  int configuration;
} CallbackRecord;

static volatile int cleanup_attempted = 0;
static volatile int callback_registered = 0;
static volatile int callback_count = 0;
static volatile unsigned int observation_tick = 0;
static SceUID callback_uid = -1;
static CallbackRecord callback_records[MAX_CALLBACK_RECORDS];

static void write_literal(SceUID fd, const char *text, SceSize length) {
  if (fd >= 0) ksceIoWrite(fd, text, length);
}

#define WRITE_LITERAL(fd, text) write_literal((fd), (text), sizeof(text) - 1)

static void write_hex32(SceUID fd, unsigned int value) {
  static const char digits[] = "0123456789abcdef";
  char text[10];
  int shift;
  int i;
  text[0] = '0';
  text[1] = 'x';
  for (i = 0, shift = 28; i < 8; ++i, shift -= 4) {
    text[2 + i] = digits[(value >> shift) & 0x0f];
  }
  write_literal(fd, text, sizeof(text));
}

static int bt_notification_callback(int notify_id, int notify_count,
                                    int notify_arg, void *common) {
  int slot = callback_count;
  if (slot < MAX_CALLBACK_RECORDS) {
    callback_records[slot].sequence = (unsigned int)slot;
    callback_records[slot].tick = observation_tick;
    callback_records[slot].notify_id = notify_id;
    callback_records[slot].notify_count = notify_count;
    callback_records[slot].notify_arg = notify_arg;
    callback_records[slot].common = (unsigned int)common;
    callback_records[slot].last_error = ksceBtGetLastError();
    callback_records[slot].configuration = ksceBtGetConfiguration();
  }
  callback_count = slot + 1;
  return 0;
}

static void flush_callback_records(SceUID fd) {
  int total = callback_count;
  int stored = total;
  int i;
  if (stored > MAX_CALLBACK_RECORDS) stored = MAX_CALLBACK_RECORDS;
  WRITE_LITERAL(fd, "callback-total=");
  write_hex32(fd, (unsigned int)total);
  WRITE_LITERAL(fd, " stored=");
  write_hex32(fd, (unsigned int)stored);
  WRITE_LITERAL(fd, " overflow=");
  write_hex32(fd, (unsigned int)(total > MAX_CALLBACK_RECORDS));
  WRITE_LITERAL(fd, "\n");
  for (i = 0; i < stored; ++i) {
    const CallbackRecord *record = &callback_records[i];
    WRITE_LITERAL(fd, "callback sequence=");
    write_hex32(fd, record->sequence);
    WRITE_LITERAL(fd, " tick100ms=");
    write_hex32(fd, record->tick);
    WRITE_LITERAL(fd, " notify-id=");
    write_hex32(fd, (unsigned int)record->notify_id);
    WRITE_LITERAL(fd, " notify-count=");
    write_hex32(fd, (unsigned int)record->notify_count);
    WRITE_LITERAL(fd, " notify-arg=");
    write_hex32(fd, (unsigned int)record->notify_arg);
    WRITE_LITERAL(fd, " common=");
    write_hex32(fd, record->common);
    WRITE_LITERAL(fd, " error=");
    write_hex32(fd, (unsigned int)record->last_error);
    WRITE_LITERAL(fd, " configuration=");
    write_hex32(fd, (unsigned int)record->configuration);
    WRITE_LITERAL(fd, "\n");
  }
}

static void cleanup_bluetooth_observer(void) {
  if (!cleanup_attempted) {
    ksceBtSetInquiryScan(0);
    if (callback_registered && callback_uid >= 0) {
      ksceBtUnregisterCallback(callback_uid);
      callback_registered = 0;
    }
    if (callback_uid >= 0) {
      ksceKernelDeleteCallback(callback_uid);
      callback_uid = -1;
    }
    cleanup_attempted = 1;
  }
}

static int observer_thread(SceSize args, void *argp) {
  SceUID fd;
  int create_result;
  int register_result = -1;
  int enable_result;
  unsigned int tick;
  (void)args;
  (void)argp;

  ksceKernelDelayThread(START_DELAY_US);
  fd = ksceIoOpen(LOG_PATH, SCE_O_WRONLY | SCE_O_CREAT | SCE_O_TRUNC, 0666);

  callback_uid = ksceKernelCreateCallback("VitaLinkR11BtNotify", 0,
                                         bt_notification_callback, 0);
  create_result = callback_uid;
  if (callback_uid >= 0) {
    register_result = ksceBtRegisterCallback(callback_uid, 0,
                                             0xffffffff, 0xffffffff);
    if (register_result >= 0) callback_registered = 1;
  }
  enable_result = ksceBtSetInquiryScan(1);

  if (fd >= 0) {
    WRITE_LITERAL(fd, "VitaLink Gate 2 callback-notification observer R11\n");
    WRITE_LITERAL(fd, "scope=bounded inquiry visibility plus callback notification metadata only\n");
    WRITE_LITERAL(fd, "forbidden=ksceBtReadEvent,pairing-replies,connect,delete,SDP,HID,L2CAP,configuration-writes\n");
    WRITE_LITERAL(fd, "warning=no event payload is consumed; Sony Settings retains native confirmation ownership\n");
    WRITE_LITERAL(fd, "ksceKernelCreateCallback=");
    write_hex32(fd, (unsigned int)create_result);
    WRITE_LITERAL(fd, " ksceBtRegisterCallback=");
    write_hex32(fd, (unsigned int)register_result);
    WRITE_LITERAL(fd, " ksceBtSetInquiryScan(1)=");
    write_hex32(fd, (unsigned int)enable_result);
    WRITE_LITERAL(fd, " initial-error=");
    write_hex32(fd, (unsigned int)ksceBtGetLastError());
    WRITE_LITERAL(fd, " initial-configuration=");
    write_hex32(fd, (unsigned int)ksceBtGetConfiguration());
    WRITE_LITERAL(fd, "\n");
  }

  if (enable_result >= 0) {
    for (tick = 1; tick <= OBSERVE_COUNT; ++tick) {
      observation_tick = tick;
      ksceKernelDelayThreadCB(OBSERVE_INTERVAL_US);
    }
  }

  {
    int disable_result = ksceBtSetInquiryScan(0);
    int unregister_result = -1;
    if (callback_registered && callback_uid >= 0) {
      unregister_result = ksceBtUnregisterCallback(callback_uid);
      callback_registered = 0;
    }
    if (fd >= 0) {
      WRITE_LITERAL(fd, "ksceBtSetInquiryScan(0)=");
      write_hex32(fd, (unsigned int)disable_result);
      WRITE_LITERAL(fd, " ksceBtUnregisterCallback=");
      write_hex32(fd, (unsigned int)unregister_result);
      WRITE_LITERAL(fd, " final-error=");
      write_hex32(fd, (unsigned int)ksceBtGetLastError());
      WRITE_LITERAL(fd, " final-configuration=");
      write_hex32(fd, (unsigned int)ksceBtGetConfiguration());
      WRITE_LITERAL(fd, "\n");
      flush_callback_records(fd);
      WRITE_LITERAL(fd, "stage=cleanup-and-callback-notification-observation-complete\n");
      ksceIoClose(fd);
    }
    if (callback_uid >= 0) {
      ksceKernelDeleteCallback(callback_uid);
      callback_uid = -1;
    }
    cleanup_attempted = 1;
  }
  return 0;
}

int module_start(SceSize args, void *argp) {
  SceUID fd;
  SceUID thread_id;
  (void)args;
  (void)argp;
  ksceIoMkdir(LOG_DIR, 0777);
  fd = ksceIoOpen(ROOT_MARKER, SCE_O_WRONLY | SCE_O_CREAT | SCE_O_TRUNC, 0666);
  if (fd >= 0) {
    WRITE_LITERAL(fd,
      "VitaLink Gate 2 callback-notification observer R11\n"
      "stage=module_start-entered\n"
      "schedule=register-after-30s-observe-90s-at-100ms-cleanup\n"
      "active-calls=callback-register-inquiry-enable-disable-unregister\n"
      "event-read-and-pairing-replies=not-used\n");
    ksceIoClose(fd);
  }
  thread_id = ksceKernelCreateThread("VitaLinkR11Observer", observer_thread,
                                     0x60, 0x6000, 0, 0, 0);
  if (thread_id >= 0) ksceKernelStartThread(thread_id, 0, 0);
  return SCE_KERNEL_START_SUCCESS;
}

int module_stop(SceSize args, void *argp) {
  (void)args;
  (void)argp;
  cleanup_bluetooth_observer();
  return SCE_KERNEL_STOP_SUCCESS;
}

int _start(SceSize args, void *argp) __attribute__((weak, alias("module_start")));
