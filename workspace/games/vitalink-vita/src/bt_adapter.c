#include "bt_adapter.h"

/*
 * VitaSDK exposes no public Bluetooth Classic server/peripheral API. Do not
 * guess NIDs: each capability is deliberately reported as unsupported until a
 * separately reviewed adapter is backed by a documented import and hardware
 * evidence. Keeping this file as the only adapter boundary prevents accidental
 * linkage to reverse-engineered/private symbols in the diagnostic VPK.
 */
static const VitaLinkProbe kProbes[] = {
  {"Bluetooth user module/library", VITALINK_ADAPTER_NOT_LINKED,
   "No public VitaSDK Bluetooth module import is linked by this app."},
  {"Classic HID peripheral role", VITALINK_UNSUPPORTED,
   "No public VitaSDK API for Classic HID device/peripheral mode."},
  {"Discoverability / inquiry scan", VITALINK_UNSUPPORTED,
   "No documented public adapter exposes discoverability controls."},
  {"Connectable / page scan", VITALINK_UNSUPPORTED,
   "No documented public adapter exposes page-scan controls."},
  {"Local Bluetooth identity", VITALINK_UNSUPPORTED,
   "No documented public API returns the local Bluetooth address/name."},
  {"Local Class of Device", VITALINK_UNSUPPORTED,
   "No documented public API gets or sets Bluetooth Class of Device."},
  {"Local SDP service registration", VITALINK_UNSUPPORTED,
   "No public VitaSDK SDP server registration API is available."},
  {"Classic L2CAP server socket", VITALINK_UNSUPPORTED,
   "VitaSDK SceNet is IP networking; no public Bluetooth L2CAP listener API."},
};

size_t vitalink_collect_bluetooth_probes(VitaLinkProbe *out, size_t capacity) {
  size_t count = sizeof(kProbes) / sizeof(kProbes[0]);
  if (out) {
    size_t copy = capacity < count ? capacity : count;
    for (size_t i = 0; i < copy; ++i) out[i] = kProbes[i];
  }
  return count;
}

const char *vitalink_probe_state_name(VitaLinkProbeState state) {
  switch (state) {
    case VITALINK_PUBLIC_AVAILABLE: return "PUBLIC API AVAILABLE";
    case VITALINK_ADAPTER_NOT_LINKED: return "NOT LINKED / NO PUBLIC IMPORT";
    default: return "UNSUPPORTED (HONEST)";
  }
}
