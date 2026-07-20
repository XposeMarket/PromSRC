#pragma once
#include <stddef.h>

typedef enum VitaLinkProbeState {
  VITALINK_UNSUPPORTED = 0,
  VITALINK_PUBLIC_AVAILABLE = 1,
  VITALINK_ADAPTER_NOT_LINKED = 2
} VitaLinkProbeState;

typedef struct VitaLinkProbe {
  const char *name;
  VitaLinkProbeState state;
  const char *detail;
} VitaLinkProbe;

size_t vitalink_collect_bluetooth_probes(VitaLinkProbe *out, size_t capacity);
const char *vitalink_probe_state_name(VitaLinkProbeState state);
