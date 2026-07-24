#include <vitaGL.h>
#include <psp2/ctrl.h>
#include <psp2/touch.h>
#include <psp2/kernel/processmgr.h>
#include <psp2/kernel/threadmgr.h>
#include <psp2/io/dirent.h>
#include <psp2/io/fcntl.h>
#include <psp2/io/stat.h>
#include <psp2/net/net.h>
#include <psp2/net/netctl.h>
#include <psp2/sysmodule.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <jpeglib.h>

namespace {
constexpr float PI = 3.14159265358979323846f;
constexpr float ROAD_HALF = 6.0f;
// The city is intentionally larger than the driveable district so the drift
// complex has grass/approach space and aircraft do not immediately outrun sky.
constexpr float CITY_WORLD_MIN_X=-520.0f,CITY_WORLD_MAX_X=720.0f;
constexpr float CITY_WORLD_MIN_Z=-480.0f,CITY_WORLD_MAX_Z=620.0f;
constexpr float PLANE_SAFE_WORLD_RADIUS=2400.0f;
constexpr float PLANE_CEILING=420.0f;
constexpr int MAX_TRACK_SAMPLES = 1400;
constexpr int FIGURE8_SAMPLES = 360;
constexpr int MAX_SEGMENTS = 64;
constexpr int TRACK_SLOT_COUNT = 6;
constexpr int WIFI_CONTROL_PORT = 18792;
constexpr uint64_t REMOTE_INPUT_TIMEOUT_US = 400000;
// Streaming is deliberately opt-in. A full-frame readback plus JPEG encode in
// the render loop can stall VitaGL, so normal local/remote control stays smooth.
constexpr bool ENABLE_REMOTE_FRAME_STREAM = false;
constexpr uint64_t STREAM_FRAME_INTERVAL_US = 1000000;
constexpr int STREAM_WIDTH = 160;
constexpr int STREAM_HEIGHT = 90;
constexpr int STREAM_CHUNK_BYTES = 1100;

struct Vec2 { float x, z; };
struct TrackSegment { int type; float length; float degrees; float radius; };
struct CarState {
  float x = 0.0f;
  float z = 0.0f;
  float yaw = 0.0f;
  float vx = 0.0f;
  float vz = 0.0f;
  float score = 0.0f;
  float combo = 1.0f;
  float driftLock = 0.0f;
  float bodyRoll = 0.0f;
  float bodyPitch = 0.0f;
  float yawRate = 0.0f;
  float steerAngle = 0.0f;
  float rearGripBlend = 1.0f;
};

CarState car;
Vec2 track[MAX_TRACK_SAMPLES];
int trackSampleCount = FIGURE8_SAMPLES;
bool trackClosed = true;
TrackSegment segments[MAX_SEGMENTS];
int segmentCount = 0;
float cameraYaw = 0.0f;
float cameraOrbit = 0.0f;
int cameraMode = 0;
float cameraAvoidanceAngle = 0.0f;
float cameraAvoidanceTarget = 0.0f;
float cameraDistanceScale = 1.0f;
float carGroundHeight=0.0f;
float carTerrainPitch=0.0f,carTerrainRoll=0.0f;
float carAirOffset=0.0f,carAirVelocity=0.0f;
float personGroundHeight=0.0f;
bool carOnHighway=false,personOnHighway=false;
int cameraStraightClearFrames = 0;
bool running = true;
enum class GameMode { Menu, Driving, BuildTrack, Customize, Settings };
enum class DriveEnvironment { Figure8, CustomTrack, City };
enum class PlayerControlMode { Vehicle, OnFoot, Aircraft };
enum class WeaponType { RocketLauncher, MachineGun };
GameMode gameMode = GameMode::Menu;
DriveEnvironment driveEnvironment = DriveEnvironment::Figure8;
PlayerControlMode playerControlMode=PlayerControlMode::Vehicle;
int menuSelection = 0;
constexpr float DEFAULT_STEERING_ANGLE_DEGREES=0.58f*180.0f/PI;
float steeringAngleDegrees=DEFAULT_STEERING_ANGLE_DEGREES;
float cityGroundHeightAt(float x,float z);
int builderSelection = 0;
constexpr int BUILDER_OPTION_COUNT = 11;
int straightChoice = 1;
int turnAngleChoice = 3;
int turnRadiusChoice = 1;
float builderCameraX = 0.0f;
float builderCameraZ = -15.0f;
float builderCameraTargetX = 0.0f;
float builderCameraTargetZ = 0.0f;
char builderStatus[40] = "BUILD YOUR TRACK";
int currentTrackSlot = 0;
int overwriteArmedSlot = -1;
constexpr const char* LEGACY_TRACK_SAVE_PATH = "ux0:data/figure8-drift/track.dat";
constexpr const char* STEERING_SETTINGS_PATH = "ux0:data/figure8-drift/steering.dat";
constexpr const char* CUSTOMIZATION_PATH = "ux0:data/figure8-drift/customization.dat";

struct ColorOption { const char*name;float r,g,b; };
constexpr ColorOption BODY_COLORS[]={
  {"RED",.91f,.055f,.025f},{"BLUE",.055f,.24f,.88f},{"GREEN",.055f,.62f,.20f},
  {"WHITE",.88f,.90f,.92f},{"BLACK",.075f,.082f,.09f},{"YELLOW",.94f,.68f,.035f},
  {"PURPLE",.50f,.10f,.70f},{"ORANGE",.96f,.28f,.025f}
};
constexpr ColorOption STRIPE_COLORS[]={
  {"BLACK",.035f,.038f,.045f},{"WHITE",.92f,.94f,.96f},{"GOLD",.92f,.58f,.06f},
  {"BLUE",.04f,.22f,.82f},{"RED",.88f,.035f,.02f}
};
constexpr const char* CAR_STYLE_NAMES[]={"SPORT COUPE","RALLY HATCH","STREET MUSCLE"};
constexpr const char* WHEEL_STYLE_NAMES[]={"SIX SPOKE","MESH","FIVE SPOKE"};
int selectedCarStyle=0,selectedBodyColor=0,selectedStripeColor=0,selectedWheelStyle=0;
int customizeSelection=0;
constexpr int CUSTOMIZE_OPTION_COUNT=5;

struct PersonState {
  float x=0,z=0,y=0,verticalVelocity=0,bodyYaw=0,viewYaw=0,viewPitch=0,walkPhase=0;
  int cameraMode=0; // 0 third person, 1 first person
  bool grounded=true;
};
PersonState person;
WeaponType selectedWeapon=WeaponType::RocketLauncher;
float machineGunCooldown=0.0f,muzzleFlashTimer=0.0f;

// Low-poly airport aircraft: fixed storage, no runtime allocation, and a
// deliberately bounded flight model tailored to the Vita input cadence.
struct PlaneState {
  float x=470.0f,y=0.0f,z=170.0f,yaw=0.0f,pitch=0.0f,roll=0.0f;
  float speed=0.0f,health=100.0f,respawn=0.0f,throttle=0.0f;
  // World velocity survives pilot exit; all fields are fixed-size POD for Vita.
  float vx=0.0f,vy=0.0f,vz=0.0f;
  bool active=true,airborne=false,crashed=false;
};
PlaneState plane;
constexpr float AIRPORT_X=470.0f,AIRPORT_RUNWAY_Z0=92.0f,AIRPORT_RUNWAY_Z1=292.0f,AIRPORT_RUNWAY_HALF=15.0f;
constexpr bool ENABLE_REAR_MIRROR=true; // single kill switch for hardware regression triage


struct CityBuilding { float x, z, width, depth, height, r, g, b; };
constexpr CityBuilding CITY_BUILDINGS[] = {
  {-36,-36,15,14,13,.72f,.38f,.24f},{-21,-36,13,16,19,.34f,.55f,.72f},
  {-36,-21,17,12,10,.76f,.69f,.48f},{-21,-21,12,12,15,.58f,.36f,.64f},
  { 21,-36,13,14,12,.70f,.58f,.32f},{ 36,-36,15,16,21,.30f,.52f,.66f},
  { 21,-21,12,12,17,.72f,.34f,.30f},{ 36,-21,16,12,11,.46f,.65f,.39f},
  {-36, 21,15,12,18,.34f,.52f,.70f},{-21, 21,13,13,11,.78f,.48f,.28f},
  {-36, 36,16,15,14,.54f,.38f,.65f},{-21, 36,12,15,20,.65f,.66f,.38f},
  { 21, 21,12,12,10,.74f,.42f,.30f},{ 36, 21,16,13,17,.38f,.62f,.55f},
  { 21, 36,13,15,20,.30f,.48f,.68f},{ 36, 36,15,15,12,.73f,.64f,.43f},
  {-78,-26,20,25,16,.58f,.43f,.31f},{-78, 27,20,25,22,.32f,.49f,.61f},
  { 78,-27,20,24,19,.62f,.35f,.30f},{ 78, 27,20,24,14,.43f,.61f,.36f},
  {-26,-78,24,20,12,.70f,.57f,.36f},{ 26,-78,24,20,18,.33f,.51f,.67f},
  {-27, 78,24,20,21,.60f,.37f,.58f},{ 27, 78,24,20,13,.74f,.46f,.29f},
  {-135,-82,24,30,18,.35f,.52f,.67f},{-135,-28,24,25,12,.72f,.44f,.28f},
  {-135, 28,24,25,22,.48f,.36f,.63f},{-135, 82,24,30,15,.68f,.62f,.39f},
  { 135,-82,24,30,14,.61f,.37f,.31f},{ 135,-28,24,25,21,.32f,.56f,.59f},
  { 135, 28,24,25,16,.75f,.54f,.31f},{ 135, 82,24,30,24,.37f,.49f,.70f},
  {-82,-135,30,24,13,.64f,.39f,.58f},{-28,-135,25,24,20,.31f,.53f,.67f},
  { 28,-135,25,24,17,.72f,.46f,.29f},{ 82,-135,30,24,23,.45f,.62f,.42f},
  {-82, 135,30,24,22,.34f,.50f,.68f},{-28, 135,25,24,15,.76f,.61f,.34f},
  { 28, 135,25,24,19,.59f,.38f,.62f},{ 82, 135,30,24,12,.68f,.45f,.30f},
  // West-side residential neighborhood: small detached homes and corner shops.
  {-290,-92,18,15,8,.72f,.63f,.48f},{-242,-92,16,14,7,.58f,.70f,.76f},
  {-290,-32,17,14,7,.76f,.53f,.48f},{-242,-32,18,15,9,.52f,.66f,.52f},
  {-290, 32,16,14,8,.68f,.58f,.76f},{-242, 32,17,15,7,.78f,.69f,.48f},
  {-290, 92,18,15,9,.52f,.63f,.75f},{-242, 92,16,14,8,.72f,.52f,.55f},
  {-337,-90,14,13,7,.66f,.70f,.58f},{-337, 88,15,13,8,.58f,.62f,.75f},
  // East-side mixed district: warehouses, apartments, and roadside businesses.
  {230,-90,20,18,10,.62f,.43f,.31f},{290,-90,20,18,13,.35f,.54f,.68f},
  {350,-90,22,19,11,.68f,.55f,.35f},
  {230,-30,19,17,12,.72f,.43f,.34f},{290,-30,20,16,9,.48f,.65f,.43f},
  {350,-30,22,18,16,.42f,.48f,.70f},
  {290,90,20,18,12,.52f,.67f,.58f},{350,90,22,18,14,.38f,.56f,.70f},
  // Warehouses beyond the eastern bridge make the highway part of the city,
  // rather than an outer wall around it.
  {428,-78,18,38,7,.42f,.46f,.48f},{475,-78,30,42,12,.36f,.42f,.47f},{516,-78,12,42,10,.48f,.43f,.34f},
  {428, 78,18,38,7,.40f,.45f,.42f},{475, 78,30,42,14,.44f,.39f,.48f},{516, 78,12,42,11,.38f,.47f,.52f},
  {140,145,14,18,10,.78f,.76f,.69f}, // park landmark church footprint
};
constexpr int CITY_BUILDING_COUNT=sizeof(CITY_BUILDINGS)/sizeof(CITY_BUILDINGS[0]);
// Four-by-four facade panels fit exactly into each building's 64-bit mask.
// They are substantially smaller than the original three-by-three chunks.
constexpr int BUILDING_DAMAGE_COLS=4,BUILDING_DAMAGE_ROWS=4,BUILDING_DAMAGE_SIDES=4;
uint64_t buildingDamage[CITY_BUILDING_COUNT]{};

constexpr int MAX_ROCKETS=24,MAX_BULLETS=72,MAX_EXPLOSION_PARTICLES=144,MAX_EXPLOSION_BLASTS=10;
struct Rocket {float x,y,z,vx,vy,vz,yaw,pitch,life;bool active;};
struct Bullet {float x,y,z,vx,vy,vz,life;bool active;};
struct ExplosionParticle {float x,y,z,vx,vy,vz,life,maxLife,size,r,g,b;bool active;};
struct ExplosionBlast {float x,y,z,life,maxLife;bool active;};
Rocket rockets[MAX_ROCKETS]{};ExplosionParticle explosionParticles[MAX_EXPLOSION_PARTICLES]{};ExplosionBlast explosionBlasts[MAX_EXPLOSION_BLASTS]{};
Bullet bullets[MAX_BULLETS]{};
int rocketCursor=0,bulletCursor=0,explosionParticleCursor=0,explosionBlastCursor=0;

struct CityParking { float x,z,width,depth; };
constexpr CityParking CITY_PARKING[]={{-82,-82,36,36},{82,-82,36,36},{-82,82,42,34},{82,82,42,34}};

struct IndustrialObstacle {float x,z,width,depth,height,r,g,b;};
constexpr IndustrialObstacle INDUSTRIAL_OBSTACLES[]={
  {432,-145,4.5f,11,2.8f,.62f,.20f,.12f},{439,-145,4.5f,11,2.8f,.12f,.34f,.58f},
  {468,-145,11,4.5f,2.8f,.72f,.48f,.10f},{482,-145,11,4.5f,2.8f,.20f,.46f,.34f},
  {512,-145,4.5f,11,2.8f,.55f,.18f,.12f},{520,-145,4.5f,11,2.8f,.14f,.30f,.55f},
  {434,145,11,4.5f,2.8f,.68f,.42f,.10f},{470,145,4.5f,11,2.8f,.16f,.42f,.58f},
  {480,145,4.5f,11,2.8f,.56f,.18f,.14f},{516,145,11,4.5f,2.8f,.18f,.48f,.35f}
};
constexpr int INDUSTRIAL_OBSTACLE_COUNT=sizeof(INDUSTRIAL_OBSTACLES)/sizeof(INDUSTRIAL_OBSTACLES[0]);

struct ParkedCar {float x,z,yaw,r,g,b;};
constexpr ParkedCar PARKED_CARS[]={
  {-91,-88,0,.16f,.28f,.62f},{-73,-76,180,.72f,.18f,.10f},
  {73,-88,0,.15f,.56f,.30f},{91,-76,180,.74f,.62f,.16f},
  {-92,78,0,.54f,.18f,.62f},{-73,90,180,.12f,.62f,.66f},
  {72,78,0,.76f,.30f,.12f},{92,90,180,.68f,.70f,.72f}
};
constexpr int PARKED_CAR_COUNT=sizeof(PARKED_CARS)/sizeof(PARKED_CARS[0]);

// --- Sandbox life systems (traffic, peds, multi-vehicle, chaos) ---
enum class SandboxVehicleKind { Car, Motorcycle, Truck, Boat, Buggy };
constexpr int MAX_TRAFFIC=12;
constexpr int MAX_PEDESTRIANS=10;
constexpr int MAX_SANDBOX_VEHICLES=10;
constexpr int MAX_DYNAMIC_PARKED=16;
float chaosScore=0.0f;
float chaosCombo=1.0f;
float chaosDecay=0.0f;
float buildingCollapse[CITY_BUILDING_COUNT]{};
bool buildingCollapsed[CITY_BUILDING_COUNT]{};
SandboxVehicleKind activeVehicleKind=SandboxVehicleKind::Car;
int occupiedSandboxVehicle=-1; // index into sandboxVehicles, or -1 for player car body
float aimRecoil=0.0f;
float walkBob=0.0f;
float shootShake=0.0f;

struct TrafficCar {
  float x,z,yaw,speed,r,g,b,laneOffset,pathT;
  int pathId; // 0..4 grid roads, 100+ extended
  int style; // 0 coupe 1 hatch 2 muscle 3 truck-ish
  float health,vx,vz,yawRate,smoke,wreckTimer,flip;
  bool active,honked,wrecked,flipped;
};
struct Pedestrian {
  float x,z,yaw,speed,phase,r,g,b,targetX,targetZ,wait;
  bool active,crossing;
};
struct SandboxVehicle {
  float x,z,y,yaw,vx,vz,yawRate,health,spawnX,spawnZ,spawnYaw;
  SandboxVehicleKind kind;
  float r,g,b;
  bool active,occupied,flipped,exploded;
  float flip,respawn;
};
struct DynamicParked {
  float x,z,yaw,vx,vz,yawRate,health,r,g,b,spawnX,spawnZ,spawnYaw,flip,respawn,smoke;
  bool active,knocked,exploded,flipped;
};
TrafficCar trafficCars[MAX_TRAFFIC]{};
Pedestrian pedestrians[MAX_PEDESTRIANS]{};
SandboxVehicle sandboxVehicles[MAX_SANDBOX_VEHICLES]{};
DynamicParked dynamicParked[MAX_DYNAMIC_PARKED]{};
bool sandboxLifeInitialized=false;

void addChaos(float amount){
  chaosScore+=amount*chaosCombo;
  float nextCombo=chaosCombo+amount*.035f;
  if(nextCombo<1.0f)nextCombo=1.0f;if(nextCombo>8.0f)nextCombo=8.0f;
  chaosCombo=nextCombo;
  chaosDecay=4.5f;
  car.score+=amount*chaosCombo*.35f;
}

void maybeCollapseBuilding(int buildingIndex,float hitX,float hitY,float hitZ);
void damageDynamicParkedAt(float x,float z,float radius,float force,bool explosive);
void damageSandboxVehicleAt(float x,float z,float radius,float force,bool explosive);
void damageTrafficAt(float x,float z,float radius,float force,bool explosive);
void initSandboxLife();
void resetSandboxLife();


struct KnockableProp {
  float spawnX,spawnZ,spawnYaw,x,z,vx,vz,yaw,spin,fall,fallSpeed,life,respawn;
  bool active,knocked,bounced;
};
constexpr int MAX_CITY_LAMPS=128;
constexpr int MAX_CITY_BENCHES=12;
constexpr int MAX_CITY_BUS_STOPS=8;
constexpr int MAX_CITY_STOP_SIGNS=12;
constexpr int MAX_CITY_TRAFFIC_LIGHTS=12;
constexpr int MAX_CITY_STREET_SIGNS=12;
constexpr int MAX_FENCE_PIECES=160;
KnockableProp cityLamps[MAX_CITY_LAMPS];
KnockableProp cityBenches[MAX_CITY_BENCHES];
KnockableProp cityBusStops[MAX_CITY_BUS_STOPS];
KnockableProp cityStopSigns[MAX_CITY_STOP_SIGNS];
KnockableProp cityTrafficLights[MAX_CITY_TRAFFIC_LIGHTS];
KnockableProp cityStreetSigns[MAX_CITY_STREET_SIGNS];
KnockableProp fencePieces[MAX_FENCE_PIECES];
bool fencePieceIsPost[MAX_FENCE_PIECES]{};
bool fencePieceUpperRail[MAX_FENCE_PIECES]{};
float fencePieceLength[MAX_FENCE_PIECES]{};
int cityLampCount=0,cityBenchCount=0,cityBusStopCount=0,cityStopSignCount=0,cityTrafficLightCount=0,cityStreetSignCount=0;
int fencePieceCount=0;
bool cityPropsInitialized=false;

#pragma pack(push, 1)
struct RemoteInputPacket {
  uint32_t magic;
  uint16_t version;
  uint16_t size;
  uint32_t sequence;
  uint32_t buttons;
  uint8_t lx, ly, rx, ry;
  uint32_t checksum;
};
struct TelemetryPacket {
  uint32_t magic;
  uint16_t version;
  uint16_t size;
  uint32_t sequence;
  uint32_t status;
  uint32_t buttons;
  uint8_t lx, ly, rx, ry;
  float speed, yaw, slipAngle, score, combo, x, z, yawRate;
  uint32_t mode;
  uint32_t checksum;
};
struct FrameChunkHeader {
  uint32_t magic;
  uint16_t version;
  uint16_t size;
  uint32_t frameId;
  uint16_t chunkIndex;
  uint16_t chunkCount;
  uint16_t payloadSize;
  uint16_t width;
  uint16_t height;
  uint16_t reserved;
};
#pragma pack(pop)

alignas(64) uint8_t netMemory[1024 * 1024];
uint8_t captureRgba[960 * 544 * 4];
uint8_t captureRgb[STREAM_WIDTH * STREAM_HEIGHT * 3];
int wifiSocket = -1;
bool wifiReady = false;
bool remotePeerKnown = false;
SceNetSockaddrIn remotePeer{};
unsigned int remotePeerLength = sizeof(remotePeer);
RemoteInputPacket remoteInput{};
uint64_t lastRemoteInputUs = 0;
uint64_t lastStreamFrameUs = 0;
uint32_t streamFrameId = 0;
float currentSlipAngle = 0.0f;
float currentSpeed = 0.0f;
float carDamage = 0.0f;
float frontDamage = 0.0f, rearDamage = 0.0f, leftDamage = 0.0f, rightDamage = 0.0f;
float damageCooldown = 0.0f;
float wheelSpin = 0.0f;
GLuint environmentTexture = 0;
GLuint cockpitTexture = 0;
struct AtlasUv{float u0,v0,u1,v1;};
constexpr float A0=.003f,A1=.330f,A2=.337f,A3=.663f,A4=.670f,A5=.997f;
constexpr AtlasUv UV_GRASS{A0,A0,A1,A1},UV_ROAD{A2,A0,A3,A1},UV_SIDEWALK{A4,A0,A5,A1};
constexpr AtlasUv UV_BRICK{A0,A2,A1,A3},UV_STONE{A2,A2,A3,A3},UV_GLASS{A4,A2,A5,A3};
constexpr AtlasUv UV_WOOD{A0,A4,A1,A5},UV_METAL{A2,A4,A3,A5},UV_SKY{A4,A4,A5,A5};
bool hudShowsMinimap = false;
bool hudTouchWasDown = false;
SceTouchPanelInfo frontTouchInfo{};

constexpr int MAX_SMOKE_PARTICLES = 144;
struct SmokeParticle { float x,y,z,vx,vy,vz,life,size,shade; bool active; };
SmokeParticle smokeParticles[MAX_SMOKE_PARTICLES];
int smokeCursor = 0;
float smokeAccumulator = 0.0f;

constexpr int MAX_SKID_POINTS = 1400;
struct SkidPoint { float lx, lz, rx, rz, alpha, life; };
SkidPoint skidPoints[MAX_SKID_POINTS];
int skidStart = 0;
int skidCount = 0;
float skidEmitDistance = 0.0f;

void addSkidPoint(float lateral, float forward);
void drawSkidMarks();
void drawGround();

float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

uint32_t fnvChecksum(const void* value, unsigned int size) {
  const uint8_t* bytes = static_cast<const uint8_t*>(value);
  uint32_t hash = 2166136261u;
  for (unsigned int i = 0; i + sizeof(uint32_t) < size; ++i) {
    hash ^= bytes[i];
    hash *= 16777619u;
  }
  return hash;
}

void sendTelemetry(uint32_t sequence) {
  if (!wifiReady || !remotePeerKnown) return;
  TelemetryPacket packet{};
  packet.magic = 0x4B413846u; // F8AK
  packet.version = 1;
  packet.size = sizeof(packet);
  packet.sequence = sequence;
  packet.status = 1;
  packet.buttons = remoteInput.buttons;
  packet.lx = remoteInput.lx; packet.ly = remoteInput.ly;
  packet.rx = remoteInput.rx; packet.ry = remoteInput.ry;
  packet.speed = currentSpeed;
  packet.yaw = car.yaw;
  packet.slipAngle = currentSlipAngle;
  packet.score = car.score;
  packet.combo = car.combo;
  packet.x = car.x; packet.z = car.z;
  packet.yawRate = car.yawRate;
  packet.mode = static_cast<uint32_t>(gameMode);
  packet.checksum = fnvChecksum(&packet, sizeof(packet));
  sceNetSendto(wifiSocket, &packet, sizeof(packet), 0,
               reinterpret_cast<const SceNetSockaddr*>(&remotePeer), remotePeerLength);
}

void initWifiBridge() {
  SceNetInitParam params{netMemory, sizeof(netMemory), 0};
  if (sceSysmoduleLoadModule(SCE_SYSMODULE_NET) < 0) return;
  if (sceNetInit(&params) < 0) return;
  sceNetCtlInit();
  wifiSocket = sceNetSocket("figure8_wifi", SCE_NET_AF_INET,
                            SCE_NET_SOCK_DGRAM, SCE_NET_IPPROTO_UDP);
  if (wifiSocket < 0) return;
  SceNetSockaddrIn address{};
  address.sin_len = sizeof(address);
  address.sin_family = SCE_NET_AF_INET;
  address.sin_port = sceNetHtons(WIFI_CONTROL_PORT);
  address.sin_addr.s_addr = SCE_NET_INADDR_ANY;
  if (sceNetBind(wifiSocket, reinterpret_cast<const SceNetSockaddr*>(&address), sizeof(address)) < 0) {
    sceNetSocketClose(wifiSocket);
    wifiSocket = -1;
    return;
  }
  wifiReady = true;
}

void pollWifiBridge() {
  if (!wifiReady) return;
  for (;;) {
    RemoteInputPacket packet{};
    SceNetSockaddrIn sender{};
    unsigned int senderLength = sizeof(sender);
    int received = sceNetRecvfrom(wifiSocket, &packet, sizeof(packet), SCE_NET_MSG_DONTWAIT,
                                  reinterpret_cast<SceNetSockaddr*>(&sender), &senderLength);
    if (received <= 0) break;
    if (received != static_cast<int>(sizeof(packet)) ||
        packet.magic != 0x50493846u || packet.version != 1 ||
        packet.size != sizeof(packet) || packet.checksum != fnvChecksum(&packet, sizeof(packet))) continue;
    remoteInput = packet;
    remotePeer = sender;
    remotePeerLength = senderLength;
    remotePeerKnown = true;
    lastRemoteInputUs = sceKernelGetProcessTimeWide();
    sendTelemetry(packet.sequence);
  }
}

void mergeRemoteInput(SceCtrlData& pad) {
  uint64_t now = sceKernelGetProcessTimeWide();
  if (!remotePeerKnown || now - lastRemoteInputUs > REMOTE_INPUT_TIMEOUT_US) return;
  pad.buttons |= remoteInput.buttons;
  if (remoteInput.lx != 128 || remoteInput.ly != 128) { pad.lx = remoteInput.lx; pad.ly = remoteInput.ly; }
  if (remoteInput.rx != 128 || remoteInput.ry != 128) { pad.rx = remoteInput.rx; pad.ry = remoteInput.ry; }
}

void maybeStreamFrame() {
  if (!ENABLE_REMOTE_FRAME_STREAM || !wifiReady || !remotePeerKnown) return;
  uint64_t now = sceKernelGetProcessTimeWide();
  if (now - lastRemoteInputUs > 2000000 || now - lastStreamFrameUs < STREAM_FRAME_INTERVAL_US) return;
  lastStreamFrameUs = now;

  glReadPixels(0, 0, 960, 544, GL_RGBA, GL_UNSIGNED_BYTE, captureRgba);
  for (int y = 0; y < STREAM_HEIGHT; ++y) {
    int sourceY = 543 - y * 3;
    for (int x = 0; x < STREAM_WIDTH; ++x) {
      const uint8_t* source = &captureRgba[(sourceY * 960 + x * 3) * 4];
      uint8_t* destination = &captureRgb[(y * STREAM_WIDTH + x) * 3];
      destination[0] = source[0]; destination[1] = source[1]; destination[2] = source[2];
    }
  }

  jpeg_compress_struct compressor{};
  jpeg_error_mgr errors{};
  compressor.err = jpeg_std_error(&errors);
  jpeg_create_compress(&compressor);
  unsigned char* jpegData = nullptr;
  unsigned long jpegSize = 0;
  jpeg_mem_dest(&compressor, &jpegData, &jpegSize);
  compressor.image_width = STREAM_WIDTH;
  compressor.image_height = STREAM_HEIGHT;
  compressor.input_components = 3;
  compressor.in_color_space = JCS_RGB;
  jpeg_set_defaults(&compressor);
  jpeg_set_quality(&compressor, 42, TRUE);
  jpeg_start_compress(&compressor, TRUE);
  while (compressor.next_scanline < compressor.image_height) {
    JSAMPROW row = &captureRgb[compressor.next_scanline * STREAM_WIDTH * 3];
    jpeg_write_scanlines(&compressor, &row, 1);
  }
  jpeg_finish_compress(&compressor);

  uint16_t chunkCount = static_cast<uint16_t>((jpegSize + STREAM_CHUNK_BYTES - 1) / STREAM_CHUNK_BYTES);
  uint32_t frameId = ++streamFrameId;
  uint8_t datagram[sizeof(FrameChunkHeader) + STREAM_CHUNK_BYTES];
  for (uint16_t chunk = 0; chunk < chunkCount; ++chunk) {
    unsigned long offset = static_cast<unsigned long>(chunk) * STREAM_CHUNK_BYTES;
    uint16_t payloadSize = static_cast<uint16_t>(
      jpegSize - offset < STREAM_CHUNK_BYTES ? jpegSize - offset : STREAM_CHUNK_BYTES);
    FrameChunkHeader header{0x52463846u, 1, sizeof(FrameChunkHeader), frameId,
                            chunk, chunkCount, payloadSize, STREAM_WIDTH, STREAM_HEIGHT, 0};
    std::memcpy(datagram, &header, sizeof(header));
    std::memcpy(datagram + sizeof(header), jpegData + offset, payloadSize);
    sceNetSendto(wifiSocket, datagram, sizeof(header) + payloadSize, 0,
                 reinterpret_cast<const SceNetSockaddr*>(&remotePeer), remotePeerLength);
  }
  jpeg_destroy_compress(&compressor);
  std::free(jpegData);
}

void resetCarToTrack() {
  car = CarState{};
  carGroundHeight=personGroundHeight=0.0f;carTerrainPitch=carTerrainRoll=0.0f;carAirOffset=carAirVelocity=0.0f;
  carOnHighway=personOnHighway=false;
  playerControlMode=PlayerControlMode::Vehicle;
  carDamage = 0.0f;
  frontDamage=rearDamage=leftDamage=rightDamage=0.0f;
  damageCooldown = 0.0f;
  wheelSpin = 0.0f;
  std::memset(smokeParticles, 0, sizeof(smokeParticles));
  skidStart = 0;
  skidCount = 0;
  skidEmitDistance = 0.0f;
  if (driveEnvironment == DriveEnvironment::City) {
    car.x = -110.0f;
    car.z = -150.0f;
    car.yaw = 0.0f;
  } else {
    car.x = track[0].x;
    car.z = track[0].z;
    if (trackSampleCount > 1)
      car.yaw = std::atan2(track[1].x - track[0].x, track[1].z - track[0].z);
  }
  cameraOrbit = 0.0f;
  cameraYaw = car.yaw;
}

void buildFigure8Track() {
  driveEnvironment = DriveEnvironment::Figure8;
  cameraAvoidanceAngle=0;cameraAvoidanceTarget=0;cameraStraightClearFrames=0;
  cameraDistanceScale=1.0f;
  trackSampleCount = FIGURE8_SAMPLES;
  trackClosed = true;
  for (int i = 0; i < trackSampleCount; ++i) {
    float t = (float)i / trackSampleCount * PI * 2.0f;
    track[i] = { std::sin(t) * 42.0f, std::sin(t) * std::cos(t) * 34.0f };
  }
  resetCarToTrack();
}

void rebuildCustomTrack() {
  trackClosed = false;
  trackSampleCount = 1;
  track[0] = {0.0f, 0.0f};
  float x = 0.0f, z = 0.0f, heading = 0.0f;
  for (int s = 0; s < segmentCount && trackSampleCount < MAX_TRACK_SAMPLES; ++s) {
    const TrackSegment &seg = segments[s];
    if (seg.type == 0) {
      int steps = (int)std::ceil(seg.length);
      float ds = seg.length / steps;
      for (int i = 0; i < steps && trackSampleCount < MAX_TRACK_SAMPLES; ++i) {
        x += std::sin(heading) * ds; z += std::cos(heading) * ds;
        track[trackSampleCount++] = {x, z};
      }
    } else {
      float total = seg.degrees * PI / 180.0f * (float)seg.type;
      int steps = (int)std::ceil(std::fabs(total) * seg.radius);
      if (steps < 4) steps = 4;
      float da = total / steps;
      float ds = std::fabs(da) * seg.radius;
      for (int i = 0; i < steps && trackSampleCount < MAX_TRACK_SAMPLES; ++i) {
        heading += da;
        x += std::sin(heading) * ds; z += std::cos(heading) * ds;
        track[trackSampleCount++] = {x, z};
      }
    }
  }
}

void addSegment(int type) {
  if (segmentCount >= MAX_SEGMENTS) { std::snprintf(builderStatus,sizeof(builderStatus),"TRACK FULL"); return; }
  static const float lengths[] = {12, 20, 32, 48};
  static const float angles[] = {30, 45, 60, 90, 120, 180};
  static const float radii[] = {10, 16, 24};
  segments[segmentCount++] = {type, lengths[straightChoice], angles[turnAngleChoice], radii[turnRadiusChoice]};
  rebuildCustomTrack();
  std::snprintf(builderStatus,sizeof(builderStatus),"%d PIECES",segmentCount);
}

struct TrackSaveHeader { char magic[8]; int version; int count; };
void trackSavePath(int slot, char* output, size_t outputSize) {
  std::snprintf(output, outputSize, "ux0:data/figure8-drift/track%d.dat", slot + 1);
}
bool trackSlotExists(int slot) {
  char path[64]; trackSavePath(slot, path, sizeof(path));
  FILE* file = std::fopen(path, "rb");
  if (!file) return false;
  std::fclose(file);
  return true;
}
bool saveTrack() {
  if (segmentCount <= 0) { std::snprintf(builderStatus,sizeof(builderStatus),"NOTHING TO SAVE"); return false; }
  if (trackSlotExists(currentTrackSlot) && overwriteArmedSlot != currentTrackSlot) {
    overwriteArmedSlot = currentTrackSlot;
    std::snprintf(builderStatus,sizeof(builderStatus),"SLOT %d EXISTS - CROSS AGAIN",currentTrackSlot+1);
    return false;
  }
  sceIoMkdir("ux0:data/figure8-drift", 0777);
  char path[64]; trackSavePath(currentTrackSlot,path,sizeof(path));
  FILE* f=std::fopen(path,"wb");
  if(!f){std::snprintf(builderStatus,sizeof(builderStatus),"SAVE FAILED");return false;}
  TrackSaveHeader h{{'F','8','T','R','A','C','K','1'},1,segmentCount};
  bool ok=std::fwrite(&h,sizeof(h),1,f)==1 && std::fwrite(segments,sizeof(TrackSegment),segmentCount,f)==(size_t)segmentCount;
  std::fclose(f);
  overwriteArmedSlot=-1;
  if(ok)std::snprintf(builderStatus,sizeof(builderStatus),"SLOT %d SAVED",currentTrackSlot+1);
  else std::snprintf(builderStatus,sizeof(builderStatus),"SAVE FAILED");
  return ok;
}

void saveSteeringSetting(){
  sceIoMkdir("ux0:data/figure8-drift",0777);FILE*f=std::fopen(STEERING_SETTINGS_PATH,"wb");if(!f)return;
  uint32_t magic=0x52455453u;std::fwrite(&magic,sizeof(magic),1,f);std::fwrite(&steeringAngleDegrees,sizeof(steeringAngleDegrees),1,f);std::fclose(f);
}

void loadSteeringSetting(){
  FILE*f=std::fopen(STEERING_SETTINGS_PATH,"rb");if(!f)return;uint32_t magic=0;float value=steeringAngleDegrees;
  if(std::fread(&magic,sizeof(magic),1,f)==1&&std::fread(&value,sizeof(value),1,f)==1&&magic==0x52455453u)
    steeringAngleDegrees=clampf(value,24.0f,52.0f);
  std::fclose(f);
}

void saveCustomization(){
  sceIoMkdir("ux0:data/figure8-drift",0777);FILE*f=std::fopen(CUSTOMIZATION_PATH,"wb");if(!f)return;
  uint32_t values[6]={0x54535543u,1u,(uint32_t)selectedCarStyle,(uint32_t)selectedBodyColor,
                      (uint32_t)selectedStripeColor,(uint32_t)selectedWheelStyle};
  std::fwrite(values,sizeof(values),1,f);std::fclose(f);
}

void loadCustomization(){
  FILE*f=std::fopen(CUSTOMIZATION_PATH,"rb");if(!f)return;uint32_t values[6]{};
  if(std::fread(values,sizeof(values),1,f)==1&&values[0]==0x54535543u&&values[1]==1u){
    selectedCarStyle=(int)(values[2]%3u);selectedBodyColor=(int)(values[3]%(sizeof(BODY_COLORS)/sizeof(BODY_COLORS[0])));
    selectedStripeColor=(int)(values[4]%(sizeof(STRIPE_COLORS)/sizeof(STRIPE_COLORS[0])));selectedWheelStyle=(int)(values[5]%3u);
  }
  std::fclose(f);
}
bool loadTrack() {
  char path[64]; trackSavePath(currentTrackSlot,path,sizeof(path));
  FILE* f=std::fopen(path,"rb");
  if(!f&&currentTrackSlot==0)f=std::fopen(LEGACY_TRACK_SAVE_PATH,"rb");
  if(!f){std::snprintf(builderStatus,sizeof(builderStatus),"NO SAVED TRACK");return false;}
  TrackSaveHeader h{};
  bool ok=std::fread(&h,sizeof(h),1,f)==1 && std::memcmp(h.magic,"F8TRACK1",8)==0 && h.version==1 && h.count>0 && h.count<=MAX_SEGMENTS;
  if(ok){segmentCount=h.count;ok=std::fread(segments,sizeof(TrackSegment),segmentCount,f)==(size_t)segmentCount;}
  std::fclose(f);
  if(ok){rebuildCustomTrack();std::snprintf(builderStatus,sizeof(builderStatus),"SLOT %d LOADED",currentTrackSlot+1);}
  else std::snprintf(builderStatus,sizeof(builderStatus),"LOAD FAILED");
  return ok;
}

float trackDistance(float x, float z) {
  float best = 100000.0f;
  for (int i = 0; i < trackSampleCount; i += 3) {
    float dx = x - track[i].x;
    float dz = z - track[i].z;
    float d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return std::sqrt(best);
}

constexpr float CITY_ROADS[]={-110.0f,-55.0f,0.0f,55.0f,110.0f};
struct CityRoadSegment{float x0,z0,x1,z1,halfWidth;};
constexpr CityRoadSegment CITY_EXTENDED_ROADS[]={
  // Western neighborhood grid.
  {-345,-120,-162,-120,6.0f},{-345,-60,-162,-60,5.5f},{-345,0,-162,0,7.5f},
  {-345,60,-162,60,5.5f},{-345,120,-162,120,6.0f},
  {-320,-145,-320,145,5.5f},{-260,-145,-260,145,7.0f},{-200,-145,-200,145,5.5f},
  {-320,145,-320,170,5.5f},{-260,145,-260,170,7.0f},{-200,145,-200,170,5.5f},
  // Eastern business/industrial district.
  {170,-120,405,-120,7.0f},{162,-60,405,-60,5.5f},{162,0,405,0,8.0f},
  {170,60,405,60,5.5f},{170,120,405,120,6.0f},
  {200,-150,200,145,5.5f},{260,-150,260,145,7.0f},{320,-150,320,145,5.5f},{380,-150,380,145,6.0f},
  {200,145,200,170,5.5f},{260,145,260,170,7.0f},{380,145,380,170,6.0f},
  {162,0,170,0,8.0f},
  // Ground-level industrial streets continue beneath and beyond the highway.
  {405,-170,530,-170,7.0f},{405,-120,530,-120,7.0f},{405,-40,530,-40,6.0f},
  {405,40,530,40,6.0f},{405,120,530,120,7.0f},{405,170,530,170,7.0f},
  {450,-170,450,170,7.0f},{500,-170,500,170,7.0f},{530,-170,530,170,6.0f},
  // Narrow service alleys.
  {-305,-145,-305,145,2.6f},{-225,-145,-225,145,2.6f},
  // West retains tight service alleys; east uses larger uninterrupted blocks.
  // Park connectors and northern scenic road.
  {-320,170,-220,170,6.0f},{-220,170,-100,170,6.0f},{-100,170,100,170,6.0f},
  {100,170,220,170,6.0f},{220,170,360,170,6.0f},
  {-260,120,-260,225,6.0f},{320,120,320,225,6.0f},
  // Northbound connector and a wide, purpose-built outer drift circuit.
  {0,162,0,250,8.0f},{0,250,0,300,9.0f},
  {-92,300,92,300,10.0f},{-92,300,-132,348,10.0f},{-132,348,-132,438,10.0f},
  {-132,438,-42,478,10.0f},{-42,478,86,474,10.0f},{86,474,142,418,10.0f},
  {142,418,142,338,10.0f},{142,338,92,300,10.0f},
  // Drift-complex infield. Each link terminates on the outer loop or a link,
  // creating several driveable lines and transitions instead of one circle.
  {-92,300,-58,348,8.0f},{-58,348,-58,410,8.0f},{-58,410,-12,438,8.0f},
  {-12,438,50,418,8.0f},{50,418,86,474,8.0f},
  {-132,348,-58,348,8.0f},{-58,410,50,418,8.0f},
  {-58,348,18,370,8.0f},{18,370,50,418,8.0f},
  {-92,300,-18,322,8.0f},{-18,322,18,370,8.0f},
  {-42,478,-12,438,8.0f}
};
constexpr int CITY_EXTENDED_ROAD_COUNT=sizeof(CITY_EXTENDED_ROADS)/sizeof(CITY_EXTENDED_ROADS[0]);
// Ground-level Catmull-Rom streets soften the rectangular district grids.
constexpr Vec2 WEST_CURVE_CONTROL[]={{-345,-128},{-305,-153},{-245,-150},{-195,-125},{-175,-82},{-188,-48}};
constexpr Vec2 EAST_CURVE_CONTROL[]={{170,118},{205,148},{262,154},{325,143},{378,112},{405,68}};
constexpr Vec2 HILL_CURVE_CONTROL[]={{-320,170},{-343,208},{-315,250},{-258,264},{-205,244},{-170,205},{-105,170}};
constexpr Vec2 EAST_HILL_CURVE_CONTROL[]={{220,170},{235,204},{258,244},{310,266},{362,246},{390,210},{360,170}};
constexpr Vec2 SOUTH_CURVE_CONTROL[]={{-345,-120},{-305,-165},{-225,-178},{-135,-164},{-40,-172},{55,-158},{145,-176},{235,-168},{325,-145},{405,-92}};
constexpr int WEST_CURVE_COUNT=sizeof(WEST_CURVE_CONTROL)/sizeof(WEST_CURVE_CONTROL[0]);
constexpr int EAST_CURVE_COUNT=sizeof(EAST_CURVE_CONTROL)/sizeof(EAST_CURVE_CONTROL[0]);
constexpr int HILL_CURVE_COUNT=sizeof(HILL_CURVE_CONTROL)/sizeof(HILL_CURVE_CONTROL[0]);
constexpr int EAST_HILL_CURVE_COUNT=sizeof(EAST_HILL_CURVE_CONTROL)/sizeof(EAST_HILL_CURVE_CONTROL[0]);
constexpr int SOUTH_CURVE_COUNT=sizeof(SOUTH_CURVE_CONTROL)/sizeof(SOUTH_CURVE_CONTROL[0]);
constexpr int CURVED_ROAD_STEPS=10;
constexpr float WEST_CURVE_HALF=6.0f,EAST_CURVE_HALF=7.0f,HILL_CURVE_HALF=6.0f,EAST_HILL_CURVE_HALF=6.0f,SOUTH_CURVE_HALF=8.0f;
constexpr float WEST_ROUNDABOUT_X=-260.0f,EAST_ROUNDABOUT_X=260.0f,ROUNDABOUT_Z=0.0f,ROUNDABOUT_RADIUS=20.0f,ROUNDABOUT_HALF=6.0f;
constexpr Vec2 HIGHWAY_CONTROL[]={
  {-360,-200},{-180,-175},{0,-175},{180,-175},{410,-190},{420,0},
  {400,180},{210,230},{0,205},{-210,230},{-380,180},{-400,0}
};
constexpr int HIGHWAY_CONTROL_COUNT=sizeof(HIGHWAY_CONTROL)/sizeof(HIGHWAY_CONTROL[0]);
constexpr int HIGHWAY_STEPS_PER_SEGMENT=10;
constexpr int HIGHWAY_SAMPLE_COUNT=HIGHWAY_CONTROL_COUNT*HIGHWAY_STEPS_PER_SEGMENT;
constexpr float HIGHWAY_HALF=10.0f,HIGHWAY_HEIGHT=10.0f;
struct HighwayRamp{float x0,z0,x1,z1;};
// Ramp endpoints deliberately meet the nearest deck lane on their approach
// side. They no longer pass beneath the near lane to reach the far shoulder.
constexpr HighwayRamp HIGHWAY_RAMPS[]={
   {-110,-145,-110,-164},{110,-145,110,-164},{260,-145,290,-174},{-260,145,-307,210}
};
constexpr int HIGHWAY_RAMP_COUNT=sizeof(HIGHWAY_RAMPS)/sizeof(HIGHWAY_RAMPS[0]);
// Two city entrances feed one continuous back-road route. Catmull-Rom
// interpolation turns these broad guide points into a smooth road instead of
// rendering the old point-to-point zigzag.
constexpr Vec2 PARK_ROAD_CONTROL[]={{110,110},{145,111},{178,134},{214,104},{250,132},{289,124},
                                    {320,91},{307,51},{270,29},{222,37},{174,58},{110,55}};
constexpr int PARK_ROAD_CONTROL_COUNT=sizeof(PARK_ROAD_CONTROL)/sizeof(PARK_ROAD_CONTROL[0]);
constexpr int PARK_ROAD_STEPS_PER_SEGMENT=10;
constexpr int PARK_ROAD_SAMPLE_COUNT=(PARK_ROAD_CONTROL_COUNT-1)*PARK_ROAD_STEPS_PER_SEGMENT+1;
constexpr float PARK_ROAD_HALF=6.5f;

Vec2 parkRoadPoint(float position){
  float maxPosition=(float)(PARK_ROAD_CONTROL_COUNT-1);position=clampf(position,0.0f,maxPosition);
  int segment=std::min((int)std::floor(position),PARK_ROAD_CONTROL_COUNT-2);float t=position-segment;
  if(position>=maxPosition)t=1.0f;
  const Vec2&p0=PARK_ROAD_CONTROL[std::max(0,segment-1)];const Vec2&p1=PARK_ROAD_CONTROL[segment];
  const Vec2&p2=PARK_ROAD_CONTROL[segment+1];const Vec2&p3=PARK_ROAD_CONTROL[std::min(PARK_ROAD_CONTROL_COUNT-1,segment+2)];
  float t2=t*t,t3=t2*t;
  return {0.5f*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
          0.5f*((2*p1.z)+(-p0.z+p2.z)*t+(2*p0.z-5*p1.z+4*p2.z-p3.z)*t2+(-p0.z+3*p1.z-3*p2.z+p3.z)*t3)};
}

float parkRoadRawDistance(float x,float z){
  float best=100000.0f;
  for(int sample=0;sample+1<PARK_ROAD_SAMPLE_COUNT;++sample){
    Vec2 a=parkRoadPoint((float)sample/PARK_ROAD_STEPS_PER_SEGMENT);
    Vec2 b=parkRoadPoint((float)(sample+1)/PARK_ROAD_STEPS_PER_SEGMENT);
    float dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz;
    float t=clampf(((x-a.x)*dx+(z-a.z)*dz)/std::max(length2,.0001f),0.0f,1.0f);
    float px=a.x+dx*t,pz=a.z+dz*t;
    best=std::min(best,std::sqrt((x-px)*(x-px)+(z-pz)*(z-pz)));
  }
  return best;
}
float cityRoadHalfWidth(float center){
  float distance=std::fabs(center);
  if(distance<1.0f)return 11.0f;      // central four-lane boulevard
  if(distance<80.0f)return 8.0f;      // broad two-lane avenues
  return 6.5f;                        // tighter neighborhood streets
}

float roadSegmentRawDistance(float x,float z,const CityRoadSegment&road){
  float dx=road.x1-road.x0,dz=road.z1-road.z0,length2=dx*dx+dz*dz;
  float t=clampf(((x-road.x0)*dx+(z-road.z0)*dz)/std::max(length2,.0001f),0.0f,1.0f);
  float px=road.x0+dx*t,pz=road.z0+dz*t;return std::sqrt((x-px)*(x-px)+(z-pz)*(z-pz));
}

Vec2 curvedRoadPoint(const Vec2*control,int count,float position){
  float maxPosition=(float)(count-1);position=clampf(position,0.0f,maxPosition);
  int segment=std::min((int)std::floor(position),count-2);float t=position-segment;
  if(position>=maxPosition)t=1.0f;
  const Vec2&p0=control[std::max(0,segment-1)],&p1=control[segment],&p2=control[segment+1],&p3=control[std::min(count-1,segment+2)];
  float t2=t*t,t3=t2*t;
  return {0.5f*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
          0.5f*((2*p1.z)+(-p0.z+p2.z)*t+(2*p0.z-5*p1.z+4*p2.z-p3.z)*t2+(-p0.z+3*p1.z-3*p2.z+p3.z)*t3)};
}

float curvedRoadRawDistance(float x,float z,const Vec2*control,int count){
  float best=100000.0f;int samples=(count-1)*CURVED_ROAD_STEPS;
  for(int sample=0;sample<samples;++sample){Vec2 a=curvedRoadPoint(control,count,(float)sample/CURVED_ROAD_STEPS);
    Vec2 b=curvedRoadPoint(control,count,(float)(sample+1)/CURVED_ROAD_STEPS);float dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz;
    float t=clampf(((x-a.x)*dx+(z-a.z)*dz)/std::max(length2,.0001f),0.0f,1.0f);
    float px=a.x+dx*t,pz=a.z+dz*t;best=std::min(best,std::sqrt((x-px)*(x-px)+(z-pz)*(z-pz)));
  }return best;
}

float hillHeight(float x,float z,float centerX,float centerZ,float radius,float height){
  float dx=x-centerX,dz=z-centerZ,distance=std::sqrt(dx*dx+dz*dz);
  float blend=clampf(1.0f-distance/radius,0.0f,1.0f);return height*blend*blend*(3.0f-2.0f*blend);
}

Vec2 highwayPoint(float position){
  int segment=((int)std::floor(position)%HIGHWAY_CONTROL_COUNT+HIGHWAY_CONTROL_COUNT)%HIGHWAY_CONTROL_COUNT;
  float t=position-std::floor(position),t2=t*t,t3=t2*t;
  const Vec2&p0=HIGHWAY_CONTROL[(segment-1+HIGHWAY_CONTROL_COUNT)%HIGHWAY_CONTROL_COUNT];
  const Vec2&p1=HIGHWAY_CONTROL[segment],&p2=HIGHWAY_CONTROL[(segment+1)%HIGHWAY_CONTROL_COUNT];
  const Vec2&p3=HIGHWAY_CONTROL[(segment+2)%HIGHWAY_CONTROL_COUNT];
  return {0.5f*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
          0.5f*((2*p1.z)+(-p0.z+p2.z)*t+(2*p0.z-5*p1.z+4*p2.z-p3.z)*t2+(-p0.z+3*p1.z-3*p2.z+p3.z)*t3)};
}

float highwayRawDistance(float x,float z){
  float best=100000.0f;
  for(int sample=0;sample<HIGHWAY_SAMPLE_COUNT;++sample){Vec2 a=highwayPoint((float)sample/HIGHWAY_STEPS_PER_SEGMENT);
    Vec2 b=highwayPoint((float)(sample+1)/HIGHWAY_STEPS_PER_SEGMENT);float dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz;
    float t=clampf(((x-a.x)*dx+(z-a.z)*dz)/std::max(length2,.0001f),0.0f,1.0f);
    float px=a.x+dx*t,pz=a.z+dz*t;best=std::min(best,std::sqrt((x-px)*(x-px)+(z-pz)*(z-pz)));
  }return best;
}

float highwayClosestPoint(float x,float z,Vec2&closest,Vec2&tangent){
  float bestDistance2=100000000.0f;
  for(int sample=0;sample<HIGHWAY_SAMPLE_COUNT;++sample){
    Vec2 a=highwayPoint((float)sample/HIGHWAY_STEPS_PER_SEGMENT);
    Vec2 b=highwayPoint((float)(sample+1)/HIGHWAY_STEPS_PER_SEGMENT);
    float dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz;
    float t=clampf(((x-a.x)*dx+(z-a.z)*dz)/std::max(length2,.0001f),0.0f,1.0f);
    float px=a.x+dx*t,pz=a.z+dz*t,ox=x-px,oz=z-pz,distance2=ox*ox+oz*oz;
    if(distance2<bestDistance2){
      bestDistance2=distance2;closest={px,pz};
      float length=std::sqrt(std::max(length2,.0001f));tangent={dx/length,dz/length};
    }
  }
  return std::sqrt(bestDistance2);
}

float rampProgress(float x,float z,const HighwayRamp&ramp,float&distance){
  float dx=ramp.x1-ramp.x0,dz=ramp.z1-ramp.z0,length2=dx*dx+dz*dz;
  float t=clampf(((x-ramp.x0)*dx+(z-ramp.z0)*dz)/std::max(length2,.0001f),0.0f,1.0f);
  float px=ramp.x0+dx*t,pz=ramp.z0+dz*t;distance=std::sqrt((x-px)*(x-px)+(z-pz)*(z-pz));return t;
}

float highwayLayerHeightAt(float x,float z,bool&onRamp){
  onRamp=false;float bestHeight=-1,bestDistance=100000.0f;
  for(const HighwayRamp&ramp:HIGHWAY_RAMPS){float distance=0,t=rampProgress(x,z,ramp,distance);
    if(distance<8.2f&&distance<bestDistance){bestDistance=distance;bestHeight=HIGHWAY_HEIGHT*t;onRamp=true;}}
  // The sloped ramp is authoritative anywhere its mesh exists. Testing the
  // elevated loop first can incorrectly snap the car to full bridge height
  // near a ramp endpoint.
  if(bestHeight>=0.0f)return bestHeight;
  if(highwayRawDistance(x,z)<=HIGHWAY_HALF+1.0f)return HIGHWAY_HEIGHT;
  return -1.0f;
}

float cityGroundHeightAt(float x,float z){
  float height=0;
  // Two broad landscaped hills flank the northern scenic road.
  height=std::max(height,hillHeight(x,z,-265,210,82,8.0f));
  height=std::max(height,hillHeight(x,z,285,205,88,7.0f));
  // Large ponds are excavated basins, not blue decals on top of the scenic hills.
  // A shallow beveled rim provides a driveable shoreline while the centers sit below grade.
  auto basin=[&](float cx,float cz,float rx,float rz,float depth){
    float nx=(x-cx)/rx,nz=(z-cz)/rz,d2=nx*nx+nz*nz;
    if(d2>=1.35f)return 0.0f;
    float bowl=clampf(1.0f-d2,0.0f,1.0f);return -depth*bowl*bowl;
  };
  height+=basin(-275,208,43,29,3.7f);
  height+=basin(286,210,48,32,3.5f);
  return height;
}

float cityGroundRoadDistance(float x, float z) {
  float best = 100000.0f;
  for (float road : CITY_ROADS) {
    float scale=ROAD_HALF/cityRoadHalfWidth(road);
    if(z>=-162.0f&&z<=162.0f)best = std::min(best, std::fabs(x - road)*scale);
    if(x>=-162.0f&&x<=162.0f)best = std::min(best, std::fabs(z - road)*scale);
  }
  for(const CityRoadSegment&road:CITY_EXTENDED_ROADS)
    best=std::min(best,roadSegmentRawDistance(x,z,road)*ROAD_HALF/road.halfWidth);
  best=std::min(best,curvedRoadRawDistance(x,z,WEST_CURVE_CONTROL,WEST_CURVE_COUNT)*ROAD_HALF/WEST_CURVE_HALF);
  best=std::min(best,curvedRoadRawDistance(x,z,EAST_CURVE_CONTROL,EAST_CURVE_COUNT)*ROAD_HALF/EAST_CURVE_HALF);
  best=std::min(best,curvedRoadRawDistance(x,z,HILL_CURVE_CONTROL,HILL_CURVE_COUNT)*ROAD_HALF/HILL_CURVE_HALF);
  best=std::min(best,curvedRoadRawDistance(x,z,EAST_HILL_CURVE_CONTROL,EAST_HILL_CURVE_COUNT)*ROAD_HALF/EAST_HILL_CURVE_HALF);
  best=std::min(best,curvedRoadRawDistance(x,z,SOUTH_CURVE_CONTROL,SOUTH_CURVE_COUNT)*ROAD_HALF/SOUTH_CURVE_HALF);
  float westRadius=std::sqrt((x-WEST_ROUNDABOUT_X)*(x-WEST_ROUNDABOUT_X)+(z-ROUNDABOUT_Z)*(z-ROUNDABOUT_Z));
  float eastRadius=std::sqrt((x-EAST_ROUNDABOUT_X)*(x-EAST_ROUNDABOUT_X)+(z-ROUNDABOUT_Z)*(z-ROUNDABOUT_Z));
  best=std::min(best,std::fabs(westRadius-ROUNDABOUT_RADIUS)*ROAD_HALF/ROUNDABOUT_HALF);
  best=std::min(best,std::fabs(eastRadius-ROUNDABOUT_RADIUS)*ROAD_HALF/ROUNDABOUT_HALF);
  for(const CityParking& lot:CITY_PARKING)
    if(std::fabs(x-lot.x)<lot.width*.5f&&std::fabs(z-lot.z)<lot.depth*.5f)best=0.0f;
  if (std::fabs(x) < 19.0f && std::fabs(z) < 19.0f) best = 0.0f;
  best=std::min(best,parkRoadRawDistance(x,z)*ROAD_HALF/PARK_ROAD_HALF);
  return best;
}

float cityRoadDistance(float x,float z){
  if(!carOnHighway)return cityGroundRoadDistance(x,z);
  float best=highwayRawDistance(x,z)*ROAD_HALF/HIGHWAY_HALF;
  for(const HighwayRamp&ramp:HIGHWAY_RAMPS){CityRoadSegment road{ramp.x0,ramp.z0,ramp.x1,ramp.z1,8.0f};
    best=std::min(best,roadSegmentRawDistance(x,z,road)*ROAD_HALF/road.halfWidth);}
  return best;
}

float citySurfaceBumpAt(float x,float z){
  float roadDistance=cityGroundRoadDistance(x,z);
  if(roadDistance<=ROAD_HALF+.35f)return 0.0f;
  if(roadDistance<=ROAD_HALF+3.0f)return .14f;
  return .065f;
}

float cityVehicleSurfaceHeight(float x,float z){
  if(carOnHighway){
    float nearestRamp=100000.0f,rampHeight=-1.0f;
    for(const HighwayRamp&ramp:HIGHWAY_RAMPS){float distance=0,t=rampProgress(x,z,ramp,distance);
      if(distance<8.2f&&distance<nearestRamp){nearestRamp=distance;rampHeight=HIGHWAY_HEIGHT*t;}}
    if(rampHeight>=0.0f)return rampHeight;
    // Once the car has entered the highway layer, every non-ramp wheel sits on
    // the flat bridge deck. Avoid a full loop-distance scan per wheel.
    return HIGHWAY_HEIGHT;
  }
  return cityGroundHeightAt(x,z);
}

float surfaceDistanceAt(float x, float z) {
  return driveEnvironment == DriveEnvironment::City ? cityRoadDistance(x,z) : trackDistance(x,z);
}

KnockableProp makeCityProp(float x,float z,float yaw=0.0f){
  return {x,z,yaw,x,z,0,0,yaw,0,0,0,0,0,true,false,false};
}

bool insideParkingLot(float x,float z,float margin=0.0f){
  for(const CityParking&lot:CITY_PARKING)
    if(std::fabs(x-lot.x)<lot.width*.5f+margin&&std::fabs(z-lot.z)<lot.depth*.5f+margin)return true;
  return false;
}

bool cityPropPlacementClear(float x,float z,float minRoadClear=.55f,float maxRoadClear=3.4f){
  float roadClear=cityGroundRoadDistance(x,z)-ROAD_HALF;
  if(roadClear<minRoadClear||roadClear>maxRoadClear||insideParkingLot(x,z,1.2f))return false;
  for(const CityBuilding&building:CITY_BUILDINGS)
    if(std::fabs(x-building.x)<building.width*.5f+1.2f&&std::fabs(z-building.z)<building.depth*.5f+1.2f)return false;
  return true;
}

// Trees and bushes need more clearance than street furniture: keep foliage out
// of every road, shoulder, ramp and the elevated highway's approach envelope.
bool cityVegetationClear(float x,float z){
  if(cityGroundRoadDistance(x,z)<=ROAD_HALF+3.5f||insideParkingLot(x,z,3.0f))return false;
  if(highwayRawDistance(x,z)<=HIGHWAY_HALF+4.5f)return false;
  for(const HighwayRamp&ramp:HIGHWAY_RAMPS){float distance=0;rampProgress(x,z,ramp,distance);if(distance<=12.0f)return false;}
  for(const CityBuilding&building:CITY_BUILDINGS)
    if(std::fabs(x-building.x)<building.width*.5f+3.0f&&std::fabs(z-building.z)<building.depth*.5f+3.0f)return false;
  return true;
}

void initCityProps(){
  cityLampCount=0;cityBenchCount=0;cityBusStopCount=0;cityStopSignCount=0;cityTrafficLightCount=0;cityStreetSignCount=0;fencePieceCount=0;
  auto addLamp=[&](float x,float z,float yaw=0.0f){
    if(cityLampCount<MAX_CITY_LAMPS&&cityPropPlacementClear(x,z,.45f,3.6f))
      cityLamps[cityLampCount++]=makeCityProp(x,z,yaw);
  };
  static const float runs[]={-145,-138,-84,-28,28,84,138,145};
  for(float road:CITY_ROADS)for(float run:runs){
    float offset=cityRoadHalfWidth(road)+1.65f;
    addLamp(road-offset,run);addLamp(road+offset,run);
    addLamp(run,road-offset);addLamp(run,road+offset);
  }
  for(const CityRoadSegment&road:CITY_EXTENDED_ROADS){
    float dx=road.x1-road.x0,dz=road.z1-road.z0,length=std::sqrt(dx*dx+dz*dz);
    if(length<30.0f)continue;
    float nx=-dz/length,nz=dx/length,offset=road.halfWidth+1.65f;
    for(float t:{.18f,.42f,.66f,.88f}){float x=road.x0+dx*t,z=road.z0+dz*t;
      addLamp(x+nx*offset,z+nz*offset);addLamp(x-nx*offset,z-nz*offset);}
  }
  static const float benches[][3]={{-120,14.0f,90},{120,-14.0f,270},{-140,-14.0f,270},{140,14.0f,90},
    {-285,-51.5f,0},{-285,51.5f,180},{335,-51.5f,0},{335,51.5f,180},
    {475,-31.5f,0},{475,31.5f,180}};
  for(const auto&v:benches)if(cityBenchCount<MAX_CITY_BENCHES&&cityPropPlacementClear(v[0],v[1],.4f,4.0f))
    cityBenches[cityBenchCount++]=makeCityProp(v[0],v[1],v[2]);
  static const float busStops[][3]={{-140,14.0f,90},{140,-14.0f,270},{-285,-68.5f,0},{335,68.5f,180},{475,48.5f,180}};
  for(const auto&v:busStops)if(cityBusStopCount<MAX_CITY_BUS_STOPS&&cityPropPlacementClear(v[0],v[1],.7f,4.3f))
    cityBusStops[cityBusStopCount++]=makeCityProp(v[0],v[1],v[2]);
  static const float stopSigns[][3]={{-13,-13,0},{64.5f,-45.5f,90},{151.5f,125.5f,90},{-232,-13,0},{238,-53,90},{-178,83,180}};
  for(const auto&v:stopSigns)if(cityStopSignCount<MAX_CITY_STOP_SIGNS&&cityPropPlacementClear(v[0],v[1],.35f,4.5f))cityStopSigns[cityStopSignCount++]=makeCityProp(v[0],v[1],v[2]);
  static const float trafficLights[][3]={{-13,-13,0},{13,13,180},{45.5f,-12.5f,90},{-208,13,180},{262,-27,270}};
  for(const auto&v:trafficLights)if(cityTrafficLightCount<MAX_CITY_TRAFFIC_LIGHTS&&cityPropPlacementClear(v[0],v[1],.35f,4.5f))cityTrafficLights[cityTrafficLightCount++]=makeCityProp(v[0],v[1],v[2]);
  static const float streetSigns[][3]={{64.5f,12.5f,90},{179,119,20},{-220,18,0},{250,-22,90},{-178,-83,0}};
  for(const auto&v:streetSigns)if(cityStreetSignCount<MAX_CITY_STREET_SIGNS&&cityPropPlacementClear(v[0],v[1],.35f,4.5f))cityStreetSigns[cityStreetSignCount++]=makeCityProp(v[0],v[1],v[2]);
  auto addFenceLine=[&](float x0,float z0,float x1,float z1){
    float dx=x1-x0,dz=z1-z0,length=std::sqrt(dx*dx+dz*dz);int segments=std::max(1,(int)(length/5.0f));
    float yaw=std::atan2(dx,dz)*180.0f/PI;
    for(int i=0;i<=segments&&fencePieceCount<MAX_FENCE_PIECES;++i){
      float t=(float)i/segments;fencePieces[fencePieceCount]=makeCityProp(x0+dx*t,z0+dz*t,yaw);
      fencePieceIsPost[fencePieceCount]=true;fencePieceUpperRail[fencePieceCount]=false;
      fencePieceLength[fencePieceCount++]=.14f;
    }
    for(int i=0;i<segments&&fencePieceCount+1<MAX_FENCE_PIECES;++i){
      float t=((float)i+.5f)/segments,x=x0+dx*t,z=z0+dz*t;
      for(int rail=0;rail<2;++rail){fencePieces[fencePieceCount]=makeCityProp(x,z,yaw);
        fencePieceIsPost[fencePieceCount]=false;fencePieceUpperRail[fencePieceCount]=rail==1;
        fencePieceLength[fencePieceCount++]=length/segments;}
    }
  };
  addFenceLine(-345,152,-329,152);addFenceLine(-311,152,-269,152);
  addFenceLine(-251,152,-209,152);addFenceLine(-191,152,-175,152);
  addFenceLine(170,-158,191,-158);addFenceLine(329,-158,371,-158);addFenceLine(389,-158,405,-158);
  cityPropsInitialized=true;
}

void hitKnockable(KnockableProp& prop,float radius,bool lamp){
  if(!prop.active)return;
  float dx=prop.x-car.x,dz=prop.z-car.z;
  float minimum=1.25f+radius,distance2=dx*dx+dz*dz;
  if(distance2>=minimum*minimum)return;
  float distance=std::sqrt(std::max(distance2,.001f)),nx=dx/distance,nz=dz/distance;
  float speed=std::sqrt(car.vx*car.vx+car.vz*car.vz);
  float impulse=std::max(speed,4.0f);
  prop.knocked=true;prop.bounced=false;prop.life=0;
  prop.vx+=car.vx*.42f+nx*impulse*.32f;prop.vz+=car.vz*.42f+nz*impulse*.32f;
  prop.yaw=std::atan2(prop.vx,prop.vz)*180.0f/PI;
  prop.spin+=(nx*car.vz-nz*car.vx)*(lamp?2.2f:5.0f);
  prop.fallSpeed=lamp?150.0f:210.0f;
  car.vx*=.93f;car.vz*=.93f;
}

void updateKnockable(KnockableProp& prop,float dt){
  if(!prop.active){
    prop.respawn-=dt;
    if(prop.respawn<=0){prop=makeCityProp(prop.spawnX,prop.spawnZ,prop.spawnYaw);}
    return;
  }
  if(!prop.knocked)return;
  prop.x+=prop.vx*dt;prop.z+=prop.vz*dt;prop.yaw+=prop.spin*dt;
  float damping=std::pow(.965f,dt*60.0f);prop.vx*=damping;prop.vz*=damping;prop.spin*=damping;
  if(!prop.bounced){
    prop.fall+=prop.fallSpeed*dt;
    if(prop.fall>=88.0f){prop.fall=88.0f;prop.fallSpeed=-38.0f;prop.bounced=true;}
  }else{
    prop.fallSpeed+=185.0f*dt;prop.fall+=prop.fallSpeed*dt;
    if(prop.fall>=90.0f){prop.fall=90.0f;prop.fallSpeed=0;}
  }
  prop.life+=dt;
  if(prop.life>9.0f){prop.active=false;prop.respawn=5.5f;}
}

void strikeKnockable(KnockableProp&prop,float sourceX,float sourceZ,float force,bool explosive,bool tall){
  if(!prop.active)return;
  float dx=prop.x-sourceX,dz=prop.z-sourceZ,distance=std::sqrt(std::max(dx*dx+dz*dz,.001f));
  float nx=dx/distance,nz=dz/distance;
  prop.knocked=true;prop.bounced=false;prop.life=0;
  prop.vx+=nx*force;prop.vz+=nz*force;prop.spin+=(nx-nz)*(explosive?190.0f:35.0f);
  prop.fallSpeed=explosive?(tall?330.0f:390.0f):(tall?95.0f:125.0f);
}

bool projectileHitsProp(float x,float y,float z,float previousX,float previousZ,const KnockableProp&prop,float radius,float height){
  if(!prop.active||y<0||y>height)return false;
  float dx=x-previousX,dz=z-previousZ,length2=dx*dx+dz*dz;
  float t=clampf(((prop.x-previousX)*dx+(prop.z-previousZ)*dz)/std::max(length2,.0001f),0.0f,1.0f);
  float closestX=previousX+dx*t,closestZ=previousZ+dz*t;
  float px=closestX-prop.x,pz=closestZ-prop.z;return px*px+pz*pz<=radius*radius;
}

void blastCityProps(float x,float z,float radius,float force){
  auto blast=[&](KnockableProp&prop,bool tall){
    float dx=prop.x-x,dz=prop.z-z,distance=std::sqrt(dx*dx+dz*dz);
    if(distance<radius)strikeKnockable(prop,x,z,force*(1.0f-distance/radius)+5.0f,true,tall);
  };
  for(int i=0;i<cityLampCount;++i)blast(cityLamps[i],true);
  for(int i=0;i<cityBenchCount;++i)blast(cityBenches[i],false);
  for(int i=0;i<cityBusStopCount;++i)blast(cityBusStops[i],false);
  for(int i=0;i<cityStopSignCount;++i)blast(cityStopSigns[i],true);
  for(int i=0;i<cityTrafficLightCount;++i)blast(cityTrafficLights[i],true);
  for(int i=0;i<cityStreetSignCount;++i)blast(cityStreetSigns[i],true);
  for(int i=0;i<fencePieceCount;++i)blast(fencePieces[i],fencePieceIsPost[i]);
}

bool hitCityPropWithProjectile(float x,float y,float z,float sourceX,float sourceZ,bool explosive){
  auto test=[&](KnockableProp&prop,float radius,float height,bool tall){
    if(!projectileHitsProp(x,y,z,sourceX,sourceZ,prop,radius,height))return false;
    strikeKnockable(prop,sourceX,sourceZ,explosive?24.0f:2.3f,explosive,tall);return true;
  };
  for(int i=0;i<cityLampCount;++i)if(test(cityLamps[i],.55f,4.8f,true))return true;
  for(int i=0;i<cityBenchCount;++i)if(test(cityBenches[i],1.35f,1.4f,false))return true;
  for(int i=0;i<cityBusStopCount;++i)if(test(cityBusStops[i],2.1f,3.0f,false))return true;
  for(int i=0;i<cityStopSignCount;++i)if(test(cityStopSigns[i],.75f,4.0f,true))return true;
  for(int i=0;i<cityTrafficLightCount;++i)if(test(cityTrafficLights[i],1.3f,5.8f,true))return true;
  for(int i=0;i<cityStreetSignCount;++i)if(test(cityStreetSigns[i],.9f,3.6f,true))return true;
  for(int i=0;i<fencePieceCount;++i){
    float radius=fencePieceIsPost[i]?.38f:std::max(.75f,fencePieceLength[i]*.48f);
    float height=fencePieceIsPost[i]?1.7f:(fencePieceUpperRail[i]?1.45f:1.0f);
    if(test(fencePieces[i],radius,height,fencePieceIsPost[i]))return true;
  }
  return false;
}

void updateCityProps(float dt){
  if(!cityPropsInitialized)initCityProps();
  for(int i=0;i<cityLampCount;++i)updateKnockable(cityLamps[i],dt);
  for(int i=0;i<cityBenchCount;++i)updateKnockable(cityBenches[i],dt);
  for(int i=0;i<cityBusStopCount;++i)updateKnockable(cityBusStops[i],dt);
  for(int i=0;i<cityStopSignCount;++i)updateKnockable(cityStopSigns[i],dt);
  for(int i=0;i<cityTrafficLightCount;++i)updateKnockable(cityTrafficLights[i],dt);
  for(int i=0;i<cityStreetSignCount;++i)updateKnockable(cityStreetSigns[i],dt);
  for(int i=0;i<fencePieceCount;++i)updateKnockable(fencePieces[i],dt);
}

void resolveCityCollisions(float dt) {
  if(!cityPropsInitialized)initCityProps();
  constexpr float radius=1.25f;
  if(damageCooldown>0.0f)damageCooldown-=dt;
  for(const CityBuilding& building:CITY_BUILDINGS){
    if(carGroundHeight>building.height+1.0f)continue;
    float left=building.x-building.width*.5f-radius,right=building.x+building.width*.5f+radius;
    float top=building.z-building.depth*.5f-radius,bottom=building.z+building.depth*.5f+radius;
    if(car.x<=left||car.x>=right||car.z<=top||car.z>=bottom)continue;
    float impactSpeed=std::sqrt(car.vx*car.vx+car.vz*car.vz);
    if(playerControlMode==PlayerControlMode::Vehicle&&damageCooldown<=0.0f&&impactSpeed>9.0f){
      float gained=(impactSpeed-8.0f)*.72f;
      carDamage=clampf(carDamage+gained,0.0f,100.0f);
      float fx=std::sin(car.yaw),fz=std::cos(car.yaw),rx=std::cos(car.yaw),rz=-std::sin(car.yaw);
      float forwardImpact=car.vx*fx+car.vz*fz,sideImpact=car.vx*rx+car.vz*rz;
      if(std::fabs(forwardImpact)>=std::fabs(sideImpact)){
        if(forwardImpact>=0)frontDamage=clampf(frontDamage+gained*1.4f,0.0f,100.0f);
        else rearDamage=clampf(rearDamage+gained*1.4f,0.0f,100.0f);
      }else if(sideImpact>=0)rightDamage=clampf(rightDamage+gained*1.4f,0.0f,100.0f);
      else leftDamage=clampf(leftDamage+gained*1.4f,0.0f,100.0f);
      damageCooldown=.42f;
    }
    float dl=car.x-left,dr=right-car.x,dtop=car.z-top,db=bottom-car.z;
    float smallest=std::min(std::min(dl,dr),std::min(dtop,db));
    if(smallest==dl){car.x=left;car.vx=-std::fabs(car.vx)*.24f;car.vz*=.68f;}
    else if(smallest==dr){car.x=right;car.vx=std::fabs(car.vx)*.24f;car.vz*=.68f;}
    else if(smallest==dtop){car.z=top;car.vz=-std::fabs(car.vz)*.24f;car.vx*=.68f;}
    else{car.z=bottom;car.vz=std::fabs(car.vz)*.24f;car.vx*=.68f;}
  }
  for(const IndustrialObstacle& obstacle:INDUSTRIAL_OBSTACLES){
    float left=obstacle.x-obstacle.width*.5f-radius,right=obstacle.x+obstacle.width*.5f+radius;
    float top=obstacle.z-obstacle.depth*.5f-radius,bottom=obstacle.z+obstacle.depth*.5f+radius;
    if(car.x<=left||car.x>=right||car.z<=top||car.z>=bottom)continue;
    float dl=car.x-left,dr=right-car.x,dtop=car.z-top,db=bottom-car.z;
    float smallest=std::min(std::min(dl,dr),std::min(dtop,db));
    if(smallest==dl){car.x=left;car.vx=-std::fabs(car.vx)*.32f;car.vz*=.76f;}
    else if(smallest==dr){car.x=right;car.vx=std::fabs(car.vx)*.32f;car.vz*=.76f;}
    else if(smallest==dtop){car.z=top;car.vz=-std::fabs(car.vz)*.32f;car.vx*=.76f;}
    else{car.z=bottom;car.vz=std::fabs(car.vz)*.32f;car.vx*=.76f;}
  }
  for(const ParkedCar&parked:PARKED_CARS){
    float halfX=parked.yaw==0||parked.yaw==180?1.15f:2.0f,halfZ=parked.yaw==0||parked.yaw==180?2.0f:1.15f;
    float left=parked.x-halfX-radius,right=parked.x+halfX+radius,top=parked.z-halfZ-radius,bottom=parked.z+halfZ+radius;
    if(car.x<=left||car.x>=right||car.z<=top||car.z>=bottom)continue;
    float dl=car.x-left,dr=right-car.x,dtop=car.z-top,db=bottom-car.z,smallest=std::min(std::min(dl,dr),std::min(dtop,db));
    if(smallest==dl){car.x=left;car.vx=-std::fabs(car.vx)*.25f;}else if(smallest==dr){car.x=right;car.vx=std::fabs(car.vx)*.25f;}
    else if(smallest==dtop){car.z=top;car.vz=-std::fabs(car.vz)*.25f;}else{car.z=bottom;car.vz=std::fabs(car.vz)*.25f;}
  }
  for(int i=0;i<cityLampCount;++i)hitKnockable(cityLamps[i],.45f,true);
  for(int i=0;i<cityBenchCount;++i)hitKnockable(cityBenches[i],1.25f,false);
  for(int i=0;i<cityBusStopCount;++i)hitKnockable(cityBusStops[i],1.8f,false);
  for(int i=0;i<cityStopSignCount;++i)hitKnockable(cityStopSigns[i],.55f,true);
  for(int i=0;i<cityTrafficLightCount;++i)hitKnockable(cityTrafficLights[i],1.0f,true);
  for(int i=0;i<cityStreetSignCount;++i)hitKnockable(cityStreetSigns[i],.65f,true);
  for(int i=0;i<fencePieceCount;++i)
    hitKnockable(fencePieces[i],fencePieceIsPost[i]?.22f:std::max(.55f,fencePieceLength[i]*.35f),fencePieceIsPost[i]);
  if(car.x < -430){car.x=-430;car.vx=std::fabs(car.vx)*.3f;}
  if(car.x > 550){car.x=550;car.vx=-std::fabs(car.vx)*.3f;}
  if(car.z < -315){car.z=-315;car.vz=std::fabs(car.vz)*.3f;}
  if(car.z > 315){car.z=315;car.vz=-std::fabs(car.vz)*.3f;}
}

void emitTireSmoke(float lateral,float forward,float dt){
  for(int i=0;i<MAX_SMOKE_PARTICLES;++i){
    SmokeParticle&p=smokeParticles[i];if(!p.active)continue;
    p.life-=dt;if(p.life<=0){p.active=false;continue;}
    p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vy+=.18f*dt;
    float drag=std::pow(.975f,dt*60.0f);p.vx*=drag;p.vz*=drag;p.size+=dt*.72f;
  }
  float intensity=clampf((std::fabs(lateral)-1.2f)/5.0f,0.0f,1.0f)*clampf((std::fabs(forward)-7.0f)/18.0f,0.0f,1.0f);
  if(intensity<=.02f)return;
  smokeAccumulator+=dt*(10.0f+intensity*30.0f);
  float rx=std::cos(car.yaw),rz=-std::sin(car.yaw),fx=std::sin(car.yaw),fz=std::cos(car.yaw);
  while(smokeAccumulator>=1.0f){
    smokeAccumulator-=1.0f;
    for(int side=-1;side<=1;side+=2){
      SmokeParticle&p=smokeParticles[smokeCursor++%MAX_SMOKE_PARTICLES];
      float jitter=((smokeCursor*37)%19-9)*.018f;
      p.x=car.x+rx*(side*.92f)-fx*1.28f;p.z=car.z+rz*(side*.92f)-fz*1.28f;p.y=.34f;
      p.vx=car.vx*.10f+rx*jitter*4.0f-fx*.35f;p.vz=car.vz*.10f+rz*jitter*4.0f-fz*.35f;
      p.vy=.35f+intensity*.45f;p.life=.72f+intensity*.46f;p.size=.28f+intensity*.18f;
      p.shade=.62f+((smokeCursor*13)%10)*.018f;p.active=true;
    }
  }
}

void updateCar(float dt, const SceCtrlData &pad) {
  // Vita's analog X axis reports left below center. Negate it so the
  // physical direction and the car's visible steering direction agree.
  float steer = -((int)pad.lx - 128) / 127.0f;
  if (std::fabs(steer) < 0.12f) steer = 0.0f;
  // Vita shoulder buttons: R = gas, L = brake/reverse.
  float throttle = (pad.buttons & SCE_CTRL_RTRIGGER) ? 1.0f : 0.0f;
  float brake = (pad.buttons & SCE_CTRL_LTRIGGER) ? 1.0f : 0.0f;
  bool handbrake = (pad.buttons & SCE_CTRL_CIRCLE) != 0;

  float fx = std::sin(car.yaw), fz = std::cos(car.yaw);
  float rx = std::cos(car.yaw), rz = -std::sin(car.yaw);
  float forward = car.vx * fx + car.vz * fz;
  float lateral = car.vx * rx + car.vz * rz;
  float surfaceDistance = surfaceDistanceAt(car.x, car.z);
  bool offRoad = surfaceDistance > ROAD_HALF + 1.0f;
  float surfaceGrip = offRoad ? 0.38f : 1.0f;

  // Keep the established acceleration and speed envelope. Drive force acts at
  // the car heading, while the axle model can move the chassis sideways.
  // Gas can hold the rear tires unloaded while the handbrake is engaged, but
  // it cannot add vehicle speed until Circle is released.
  float acceleration = (handbrake ? 0.0f : throttle * 43.0f) - brake * 38.0f;
  // Stronger mid/high-speed pull keeps a committed drift alive without making
  // Mid-speed boost now lives between 20 and 35 mph.
  if (!handbrake && throttle > 0.0f && forward > 20.0f && forward < 35.0f) {
    float boostBlend = clampf((forward - 20.0f) / 4.0f, 0.0f, 1.0f)
                     * clampf((35.0f - forward) / 4.0f, 0.0f, 1.0f);
    acceleration += 12.0f * boostBlend;
  }
  if (brake && forward < 1.0f) acceleration = -brake * 15.0f;
  car.vx += fx * acceleration * dt;
  car.vz += fz * acceleration * dt;
  // Circle-held slides retain momentum longer, especially once velocity is
  // sideways. Normal driving keeps the already-approved rolling decay.
  float sidewaysShare=clampf(std::fabs(lateral)/(std::fabs(forward)+std::fabs(lateral)+.25f),0.0f,1.0f);
  float rollingBase=handbrake?(.9955f+.0025f*sidewaysShare):.991f;
  float rolling = std::pow(rollingBase, dt * 60.0f);
  car.vx *= rolling;
  car.vz *= rolling;
  if(driveEnvironment==DriveEnvironment::City){
    float west=std::sqrt((car.x-WEST_ROUNDABOUT_X)*(car.x-WEST_ROUNDABOUT_X)+(car.z-ROUNDABOUT_Z)*(car.z-ROUNDABOUT_Z));
    float east=std::sqrt((car.x-EAST_ROUNDABOUT_X)*(car.x-EAST_ROUNDABOUT_X)+(car.z-ROUNDABOUT_Z)*(car.z-ROUNDABOUT_Z));
    if(std::min(west,east)<ROUNDABOUT_RADIUS-ROUNDABOUT_HALF){
      float islandDrag=std::pow(.987f,dt*60.0f);car.vx*=islandDrag;car.vz*=islandDrag;
    }
  }
  forward = car.vx * fx + car.vz * fz;
  if (forward > 65.0f) { car.vx -= fx * (forward - 65.0f); car.vz -= fz * (forward - 65.0f); forward = 65.0f; }
  if (forward < -11.0f) { car.vx += fx * (-11.0f - forward); car.vz += fz * (-11.0f - forward); forward = -11.0f; }

  // Player-authoritative arcade bicycle model. The previous tune let tire-force
  // stabilization overpower steering, which made the car feel heavy. The axle
  // slips still shape the slide, but steering now commands the turn directly.
  const float frontAxle = 1.42f;
  const float rearAxle = 1.28f;
  const float wheelbase = frontAxle + rearAxle;
  float steerAmount = std::fabs(steer);
  float steerShaped = steer * (0.68f + steerAmount * 0.32f);
  float speedRatio = clampf(std::fabs(forward) / 36.0f, 0.0f, 1.0f);
  float steeringScale=steeringAngleDegrees/(0.58f*180.0f/PI);
  float maxSteer = (0.58f + (0.38f - 0.58f) * speedRatio)*steeringScale;
  float steerTarget = steerShaped * maxSteer;
  car.steerAngle += (steerTarget - car.steerAngle) * clampf(dt * 13.0f, 0.0f, 1.0f);

  // Circle now acts as an actual handbrake initiation: rear grip drops quickly
  // and recovers over a short catch window instead of toggling like a slide mode.
  float handbrakeTarget = handbrake && std::fabs(forward) > 5.0f ? 1.0f : 0.0f;
  float handbrakeRate = handbrake ? 18.0f : 3.8f;
  car.driftLock += (handbrakeTarget - car.driftLock) * clampf(dt * handbrakeRate, 0.0f, 1.0f);
  float cornerLoad = clampf((steerAmount - 0.30f) / 0.70f, 0.0f, 1.0f)
                   * clampf((std::fabs(forward) - 7.0f) / 17.0f, 0.0f, 1.0f);
  float existingSlide = clampf((std::fabs(lateral) - 1.4f) / 6.0f, 0.0f, 1.0f);
  float throttleSlide = throttle * existingSlide * clampf((std::fabs(forward) - 12.0f) / 18.0f, 0.0f, 1.0f);
  // Rear lateral grip falls with speed and sideways slip. At 65 mph a car in
  // a slide has materially less rear bite than at 30 mph, enabling a real
  // breakaway/spin that still rewards countersteer and throttle correction.
  float speedGripRelease=clampf((std::fabs(forward)-25.0f)/40.0f,0.0f,1.0f);
  float lateralGripRelease=clampf((std::fabs(lateral)-1.5f)/10.0f,0.0f,1.0f);
  float rearUnload=std::max(cornerLoad*(throttle>0.0f?.58f:.22f),throttleSlide*.72f);
  rearUnload=std::max(rearUnload,speedGripRelease*(.20f+.34f*lateralGripRelease));
  float powerRearGrip=1.0f-rearUnload;
  float rearGripTarget=powerRearGrip*(1.0f-car.driftLock*.88f);
  float rearGripRate = handbrake ? 18.0f : 9.0f;
  car.rearGripBlend += (rearGripTarget - car.rearGripBlend) * clampf(dt * rearGripRate, 0.0f, 1.0f);

  float frontYaw = car.yaw + car.steerAngle;
  float frx = std::cos(frontYaw), frz = -std::sin(frontYaw);
  float frontVx = car.vx + rx * car.yawRate * frontAxle;
  float frontVz = car.vz + rz * car.yawRate * frontAxle;
  float rearVx = car.vx - rx * car.yawRate * rearAxle;
  float rearVz = car.vz - rz * car.yawRate * rearAxle;
  float frontSlip = frontVx * frx + frontVz * frz;
  float rearSlip = rearVx * rx + rearVz * rz;
  float tireEntrySpeed=std::sqrt(car.vx*car.vx+car.vz*car.vz);

  float frontForce = clampf(-frontSlip * 4.2f, -28.0f, 28.0f) * surfaceGrip;
  float rearForceLimit = 12.0f + 20.0f * car.rearGripBlend;
  float rearForce = clampf(-rearSlip * (4.8f * car.rearGripBlend), -rearForceLimit, rearForceLimit) * surfaceGrip;
  car.vx += (frx * frontForce * 0.50f + rx * rearForce * 0.36f) * dt;
  car.vz += (frz * frontForce * 0.50f + rz * rearForce * 0.36f) * dt;
  if(!handbrake&&throttleSlide>.02f){
    // Powered drifts preserve the velocity vector through tire scrub, then add
    // a small amount of speed along that existing momentum instead of snapping straight.
    float afterTireSpeed=std::sqrt(car.vx*car.vx+car.vz*car.vz);
    float poweredTarget=std::min(65.0f,tireEntrySpeed+throttleSlide*8.0f*dt);
    float protection=clampf(throttleSlide*1.35f,0.0f,1.0f);
    float protectedSpeed=afterTireSpeed+(poweredTarget-afterTireSpeed)*protection;
    if(afterTireSpeed>.01f&&protectedSpeed>afterTireSpeed){
      float scale=protectedSpeed/afterTireSpeed;car.vx*=scale;car.vz*=scale;
    }
  }

  // Use bicycle geometry as the primary yaw command. Axle-force torque is only
  // a small slide influence, so it cannot cancel steering or create endless spin.
  float direction = forward < -0.2f ? -1.0f : 1.0f;
  float turnSpeed = std::max(std::fabs(forward), 2.5f);
  float desiredYawRate = direction * (turnSpeed / wheelbase) * std::tan(car.steerAngle) * 0.90f;
  if (offRoad) desiredYawRate *= 0.48f;
  desiredYawRate = clampf(desiredYawRate, -2.05f, 2.05f);
  float axleYawInfluence = (frontForce * frontAxle - rearForce * rearAxle) / 46.0f;
  car.yawRate += axleYawInfluence * dt;
  // When the rear saturates, stop welding the chassis to the steering command.
  // The front axle keeps biting while a bounded breakaway moment rotates the
  // body across its still-forward momentum: visible oversteer instead of a block slide.
  float rearRelease = clampf((1.0f - car.rearGripBlend) * 1.45f, 0.0f, 1.0f);
  float breakawaySpeed = clampf((std::fabs(forward) - 7.0f) / 22.0f, 0.0f, 1.0f);
  float breakawayMoment = steerShaped * rearRelease * breakawaySpeed * (1.35f + car.driftLock * 1.25f);
  // Gas during an established slide reinforces its current rotation rather
  // than using forward thrust to immediately straighten the velocity vector.
  float slideDirection = std::fabs(car.yawRate) > 0.12f ? (car.yawRate > 0.0f ? 1.0f : -1.0f)
                                                        : (steerShaped >= 0.0f ? 1.0f : -1.0f);
  breakawayMoment += slideDirection * throttleSlide * 0.72f;
  car.yawRate += breakawayMoment * dt;
  float releasedYawAuthority = car.driftLock > 0.1f ? 3.0f : 4.2f;
  float yawAuthority = 8.5f + (releasedYawAuthority - 8.5f) * rearRelease;
  car.yawRate += (desiredYawRate - car.yawRate) * clampf(dt * yawAuthority, 0.0f, 1.0f);
  car.yawRate *= std::pow(handbrake ? 0.994f : 0.997f, dt * 60.0f);
  car.yawRate = clampf(car.yawRate, -2.20f, 2.20f);
  if (std::fabs(forward) < 0.7f) car.yawRate *= std::pow(0.84f, dt * 60.0f);
  car.yaw += car.yawRate * dt;

  if (handbrake) {
    // A locked rear axle scrubs a little forward speed without deleting the
    // sideways momentum that makes the rear visibly swing around.
    float slideShare=clampf(std::fabs(lateral)/(std::fabs(forward)+std::fabs(lateral)+.25f),0.0f,1.0f);
    float scrubBase=.99945f+.00040f*slideShare;
    float forwardScrub = forward * (1.0f - std::pow(scrubBase, dt * 60.0f));
    car.vx -= fx * forwardScrub;
    car.vz -= fz * forwardScrub;
  }

  // Re-sample chassis-space motion for scoring, tire marks and body roll.
  fx = std::sin(car.yaw); fz = std::cos(car.yaw);
  rx = std::cos(car.yaw); rz = -std::sin(car.yaw);
  forward = car.vx * fx + car.vz * fz;
  lateral = car.vx * rx + car.vz * rz;
  currentSpeed = std::sqrt(car.vx * car.vx + car.vz * car.vz);
  currentSlipAngle = std::atan2(lateral, std::max(std::fabs(forward), 0.25f));
  wheelSpin+=forward*dt/.34f;
  emitTireSmoke(lateral,forward,dt);
  float rollTarget = clampf(-car.yawRate * 0.075f + lateral * 0.009f, -0.18f, 0.18f);
  car.bodyRoll += (rollTarget - car.bodyRoll) * clampf(dt * 7.0f, 0.0f, 1.0f);
  // Visual-only weight transfer: deliberately exaggerated without changing forces.
  float pitchTarget=(brake&&forward>2.0f?.145f:0.0f)-(throttle>.0f?.085f:0.0f);
  car.bodyPitch+=(pitchTarget-car.bodyPitch)*clampf(dt*(pitchTarget==0?5.0f:8.0f),0.0f,1.0f);

  car.x += car.vx * dt;
  car.z += car.vz * dt;
  float targetGround=0.0f;
  if(driveEnvironment==DriveEnvironment::City){
    bool onRamp=false;float highwayHeight=highwayLayerHeightAt(car.x,car.z,onRamp);
    // Enter the elevated layer only from the low end of an on-ramp. Crossing
    // beneath the middle of a ramp/highway must remain ground-level.
    if(!carOnHighway&&onRamp&&highwayHeight>.02f&&highwayHeight<2.15f)carOnHighway=true;
    if(carOnHighway&&onRamp&&highwayHeight>=0&&highwayHeight<.20f)carOnHighway=false;
    // Once on the elevated loop, keep the tire contact patch inside the deck
    // instead of dropping the entire car whenever a fast drift crosses a
    // sampled spline edge. The outward part of velocity is absorbed while the
    // tangential drift momentum is preserved.
    if(carOnHighway&&!onRamp){
      Vec2 closest{},tangent{};float deckDistance=highwayClosestPoint(car.x,car.z,closest,tangent);
      constexpr float usableDeckHalf=HIGHWAY_HALF-1.35f;
      if(deckDistance>usableDeckHalf){
        float nx=(car.x-closest.x)/std::max(deckDistance,.001f);
        float nz=(car.z-closest.z)/std::max(deckDistance,.001f);
        car.x=closest.x+nx*usableDeckHalf;car.z=closest.z+nz*usableDeckHalf;
        float outward=car.vx*nx+car.vz*nz;
        if(outward>0.0f){car.vx-=nx*outward*1.08f;car.vz-=nz*outward*1.08f;}
        highwayHeight=HIGHWAY_HEIGHT;
      }
    }
    fx=std::sin(car.yaw);fz=std::cos(car.yaw);rx=std::cos(car.yaw);rz=-std::sin(car.yaw);
    float centerHeight=carOnHighway&&highwayHeight>=0?highwayHeight:
                       cityGroundHeightAt(car.x,car.z)+citySurfaceBumpAt(car.x,car.z);
    float frontHeight=cityVehicleSurfaceHeight(car.x+fx*1.28f,car.z+fz*1.28f);
    float rearHeight=cityVehicleSurfaceHeight(car.x-fx*1.28f,car.z-fz*1.28f);
    float leftHeight=cityVehicleSurfaceHeight(car.x-rx*.94f,car.z-rz*.94f);
    float rightHeight=cityVehicleSurfaceHeight(car.x+rx*.94f,car.z+rz*.94f);
    float wheelAverage=(frontHeight+rearHeight+leftHeight+rightHeight)*.25f;
    float highestWheel=std::max(std::max(frontHeight,rearHeight),std::max(leftHeight,rightHeight));
    targetGround=std::max(centerHeight,std::max(wheelAverage,highestWheel-.16f));
    // Positive OpenGL X rotation drops the model's forward (+Z) direction,
    // so use rear-minus-front height. This makes the car nose-up while climbing
    // and nose-down while descending instead of the visually inverted tilt.
    float terrainPitchTarget=std::atan2(rearHeight-frontHeight,2.56f);
    float terrainRollTarget=std::atan2(leftHeight-rightHeight,1.88f);
    carTerrainPitch+=(clampf(terrainPitchTarget,-.28f,.28f)-carTerrainPitch)*clampf(dt*10.0f,0.0f,1.0f);
    carTerrainRoll+=(clampf(terrainRollTarget,-.24f,.24f)-carTerrainRoll)*clampf(dt*10.0f,0.0f,1.0f);
  }else{
    carTerrainPitch+=(0.0f-carTerrainPitch)*clampf(dt*10.0f,0.0f,1.0f);
    carTerrainRoll+=(0.0f-carTerrainRoll)*clampf(dt*10.0f,0.0f,1.0f);
  }
  // Never let the chassis lag beneath an uphill mesh. Descents remain gently
  // damped so cresting a hill does not make the camera or body snap downward.
  if(targetGround>carGroundHeight)carGroundHeight=targetGround;
  else carGroundHeight+=(targetGround-carGroundHeight)*clampf(dt*12.0f,0.0f,1.0f);
  if(driveEnvironment==DriveEnvironment::City)resolveCityCollisions(dt);

  float roadDist = surfaceDistanceAt(car.x, car.z);
  bool drifting = std::fabs(lateral) > 1.5f && std::fabs(forward) > 7.0f && (handbrake || std::fabs(steer) > 0.2f);
  if (drifting && roadDist < ROAD_HALF + 1.5f) {
    car.combo = clampf(car.combo + dt * 0.55f, 1.0f, 5.0f);
    car.score += std::fabs(lateral * forward) * 0.052f * car.combo;
  } else {
    car.combo = clampf(car.combo - dt * 0.9f, 1.0f, 5.0f);
  }
  if (roadDist > ROAD_HALF + 2.0f) {
    // Grass is loose, not glue: almost no speed penalty, much less tire bite.
    car.vx *= std::pow(0.998f, dt * 60.0f);
    car.vz *= std::pow(0.998f, dt * 60.0f);
  }
  addSkidPoint(lateral, forward);
  for(int n=0;n<skidCount;++n)skidPoints[(skidStart+n)%MAX_SKID_POINTS].life-=dt;
  while(skidCount>0&&skidPoints[skidStart].life<=0){skidStart=(skidStart+1)%MAX_SKID_POINTS;--skidCount;}
  // The chase camera can now orbit a full 180 degrees to a true front view.
  // Pulling the right stick fully down is also a direct "look at the front"
  // gesture, which is much easier to hold accurately on the Vita.
  float cameraStickX=((int)pad.rx-128)/127.0f;
  float cameraStickY=((int)pad.ry-128)/127.0f;
  if(std::fabs(cameraStickX)<.14f)cameraStickX=0.0f;
  if(std::fabs(cameraStickY)<.14f)cameraStickY=0.0f;
  if(cameraStickY>.68f){
    float frontDelta=std::atan2(std::sin(PI-cameraOrbit),std::cos(PI-cameraOrbit));
    cameraOrbit+=frontDelta*clampf(dt*9.0f,0.0f,1.0f);
  }else if(cameraStickX!=0.0f){
    cameraOrbit+=cameraStickX*dt*4.0f;
    cameraOrbit=std::atan2(std::sin(cameraOrbit),std::cos(cameraOrbit));
  }else
    cameraOrbit += (0.0f - cameraOrbit) * clampf(dt * 12.0f, 0.0f, 1.0f);
  if (std::fabs(cameraOrbit) < 0.002f) cameraOrbit = 0.0f;
  float cameraTarget = car.yaw + cameraOrbit;
  float cameraDelta = std::atan2(std::sin(cameraTarget - cameraYaw), std::cos(cameraTarget - cameraYaw));
  cameraYaw += cameraDelta * clampf(dt * 10.0f, 0.0f, 1.0f);
}

float personDistanceToCar(){float dx=person.x-car.x,dz=person.z-car.z;return std::sqrt(dx*dx+dz*dz);}

bool personPositionBlocked(float x,float z){
  if(driveEnvironment==DriveEnvironment::City){
    if(x<-430||x>550||z<-315||z>315)return true;
    for(const CityBuilding&building:CITY_BUILDINGS)
      if(std::fabs(x-building.x)<building.width*.5f+.42f&&std::fabs(z-building.z)<building.depth*.5f+.42f)return true;
    for(const IndustrialObstacle&obstacle:INDUSTRIAL_OBSTACLES)
      if(std::fabs(x-obstacle.x)<obstacle.width*.5f+.42f&&std::fabs(z-obstacle.z)<obstacle.depth*.5f+.42f)return true;
  }else if(x<-188||x>188||z<-188||z>188)return true;
  float carDx=x-car.x,carDz=z-car.z;
  if(carDx*carDx+carDz*carDz<1.65f*1.65f&&person.y<carGroundHeight+carAirOffset+1.35f)return true;
  for(int i=0;i<MAX_DYNAMIC_PARKED;++i){const DynamicParked&parked=dynamicParked[i];if(!parked.active)continue;
    float yaw=parked.yaw,dx=x-parked.x,dz=z-parked.z;
    float localX=dx*std::cos(yaw)-dz*std::sin(yaw),localZ=dx*std::sin(yaw)+dz*std::cos(yaw);
    if(std::fabs(localX)<1.15f&&std::fabs(localZ)<2.0f&&person.y<cityGroundHeightAt(parked.x,parked.z)+1.25f)return true;
  }
  for(int i=0;i<MAX_SANDBOX_VEHICLES;++i){const SandboxVehicle&v=sandboxVehicles[i];if(!v.active||v.occupied)continue;
    float dx=x-v.x,dz=z-v.z;if(dx*dx+dz*dz<1.6f*1.6f)return true;
  }
  return false;
}

void exitVehicle(){
  float rx=std::cos(car.yaw),rz=-std::sin(car.yaw);float side=-2.15f;
  float exitX=car.x+rx*side,exitZ=car.z+rz*side;
  if(personPositionBlocked(exitX,exitZ)){side=2.15f;exitX=car.x+rx*side;exitZ=car.z+rz*side;}
  person=PersonState{};person.x=exitX;person.z=exitZ;person.y=personGroundHeight=carGroundHeight;personOnHighway=carOnHighway;person.bodyYaw=person.viewYaw=car.yaw;person.cameraMode=0;
  car.vx=car.vz=car.yawRate=0;car.steerAngle=0;playerControlMode=PlayerControlMode::OnFoot;
}

void enterVehicle(){
  if(personDistanceToCar()>3.25f)return;
  carOnHighway=personOnHighway;
  playerControlMode=PlayerControlMode::Vehicle;cameraYaw=car.yaw;cameraOrbit=0;cameraMode=0;cameraDistanceScale=1.0f;
}

float personSupportHeight(float x,float z){
  float support=driveEnvironment==DriveEnvironment::City?
    (personOnHighway?HIGHWAY_HEIGHT:cityGroundHeightAt(x,z)+citySurfaceBumpAt(x,z)):0.0f;
  float dx=x-car.x,dz=z-car.z,fx=std::sin(car.yaw),fz=std::cos(car.yaw),rx=std::cos(car.yaw),rz=-std::sin(car.yaw);
  float localX=dx*rx+dz*rz,localZ=dx*fx+dz*fz;
  if(std::fabs(localX)<1.08f&&std::fabs(localZ)<1.82f)
    support=std::max(support,carGroundHeight+carAirOffset+1.62f);
  for(int i=0;i<cityBenchCount;++i){const KnockableProp&bench=cityBenches[i];
    if(!bench.active||bench.fall>28.0f)continue;
    float yaw=bench.yaw*PI/180.0f,bdx=x-bench.x,bdz=z-bench.z;
    float bx=bdx*std::cos(yaw)-bdz*std::sin(yaw),bz=bdx*std::sin(yaw)+bdz*std::cos(yaw);
    if(std::fabs(bx)<1.18f&&std::fabs(bz)<.42f)support=std::max(support,cityGroundHeightAt(bench.x,bench.z)+.92f);
  }
  for(int i=0;i<MAX_DYNAMIC_PARKED;++i){const DynamicParked&parked=dynamicParked[i];if(!parked.active||parked.flipped)continue;
    float yaw=parked.yaw,pdx=x-parked.x,pdz=z-parked.z;
    float px=pdx*std::cos(yaw)-pdz*std::sin(yaw),pz=pdx*std::sin(yaw)+pdz*std::cos(yaw);
    if(std::fabs(px)<.92f&&std::fabs(pz)<1.72f)support=std::max(support,cityGroundHeightAt(parked.x,parked.z)+1.35f);
  }
  return support;
}

void updatePerson(float dt,const SceCtrlData&pad,uint32_t pressed){
  // Vita on-foot axes are opposite the raw convention used by the controller
  // bridge. Flip both look axes and horizontal movement to match the stick.
  float lookX=-((int)pad.rx-128)/127.0f,lookY=-((int)pad.ry-128)/127.0f;
  if(std::fabs(lookX)<.10f)lookX=0;
  if(std::fabs(lookY)<.10f)lookY=0;
  // Slight aim accel + recoil settle for gunfeel.
  float lookSens=person.cameraMode==1?3.85f:3.35f;
  person.viewYaw+=lookX*dt*lookSens;
  // Aim stays player-authored. Recoil is a render-only positive pitch offset,
  // so both weapons visibly kick upward then recover without aim drift.
  person.viewPitch=clampf(person.viewPitch+lookY*dt*2.95f,-1.35f,1.35f);
  aimRecoil+=(0.0f-aimRecoil)*clampf(dt*13.5f,0.0f,1.0f);
  shootShake=std::max(0.0f,shootShake-dt*4.5f);
  float strafe=-((int)pad.lx-128)/127.0f,forward=-((int)pad.ly-128)/127.0f;
  if(std::fabs(strafe)<.12f)strafe=0;
  if(std::fabs(forward)<.12f)forward=0;
  float moveX=std::sin(person.viewYaw)*forward+std::cos(person.viewYaw)*strafe;
  float moveZ=std::cos(person.viewYaw)*forward-std::sin(person.viewYaw)*strafe;
  float length=std::sqrt(moveX*moveX+moveZ*moveZ);if(length>1.0f){moveX/=length;moveZ/=length;length=1.0f;}
  bool sprint=(pad.buttons&SCE_CTRL_DOWN)!=0;
  // ADS-ish slow when holding L in first person.
  bool ads=person.cameraMode==1&&(pad.buttons&SCE_CTRL_LTRIGGER);
  float speed=sprint?10.4f:5.35f;if(ads)speed*=.62f;
  if(length>.01f){
    // First person: body follows look, not move vector (less crab-walk weirdness).
    if(person.cameraMode==1){
      float turn=std::atan2(moveX,moveZ)-person.bodyYaw;
      while(turn>PI)turn-=2*PI;while(turn<-PI)turn+=2*PI;
      // Keep body mostly facing aim; slight lean into strafe.
      person.bodyYaw=person.viewYaw+clampf(std::atan2(strafe,std::max(.2f,forward))*0.18f,-.25f,.25f);
    }
    person.walkPhase+=dt*speed*(sprint?2.8f:2.15f);
    walkBob+=(sprint?1.0f:.55f)*length*dt*10.0f;
    float nextX=person.x+moveX*speed*dt;if(!personPositionBlocked(nextX,person.z))person.x=nextX;
    float nextZ=person.z+moveZ*speed*dt;if(!personPositionBlocked(person.x,nextZ))person.z=nextZ;
  }else{
    walkBob+=(0.0f-walkBob)*clampf(dt*6.0f,0.0f,1.0f);
  }
  if(driveEnvironment==DriveEnvironment::City){bool onRamp=false;float highwayHeight=highwayLayerHeightAt(person.x,person.z,onRamp);
    if(!personOnHighway&&onRamp&&highwayHeight>.02f&&highwayHeight<2.15f)personOnHighway=true;
    if(personOnHighway&&onRamp&&highwayHeight>=0&&highwayHeight<.12f)personOnHighway=false;
    if(personOnHighway&&highwayHeight<0)personOnHighway=false;
    personGroundHeight=personOnHighway&&highwayHeight>=0?highwayHeight:personSupportHeight(person.x,person.z);
  }else personGroundHeight=0.0f;
  if(person.cameraMode==0)person.bodyYaw=person.viewYaw;
  if((pressed&SCE_CTRL_CROSS)&&person.grounded){person.verticalVelocity=8.15f;person.grounded=false;}
  if(!person.grounded){person.verticalVelocity-=17.2f*dt;person.y+=person.verticalVelocity*dt;if(person.y<=personGroundHeight){person.y=personGroundHeight;person.verticalVelocity=0;person.grounded=true;}}
  else person.y+=(personGroundHeight-person.y)*clampf(dt*12.0f,0.0f,1.0f);
}

void addSkidPoint(float lateral, float forward) {
  float speed=std::fabs(forward);
  if(speed<8.0f||std::fabs(lateral)<1.25f)return;
  skidEmitDistance+=speed/60.0f;
  if(skidEmitDistance<.38f)return;
  skidEmitDistance=0.0f;
  float rx=std::cos(car.yaw),rz=-std::sin(car.yaw),fx=std::sin(car.yaw),fz=std::cos(car.yaw);
  int index=(skidStart+skidCount)%MAX_SKID_POINTS;
  if(skidCount==MAX_SKID_POINTS){skidStart=(skidStart+1)%MAX_SKID_POINTS;index=(skidStart+skidCount-1)%MAX_SKID_POINTS;}else ++skidCount;
  skidPoints[index]={car.x-rx*.82f-fx*1.18f,car.z-rz*.82f-fz*1.18f,car.x+rx*.82f-fx*1.18f,car.z+rz*.82f-fz*1.18f,clampf(std::fabs(lateral)/7.0f,.28f,.82f),7.0f};
}

void drawSkidMarks() {
  glEnable(GL_BLEND);glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);glDepthMask(GL_FALSE);glLineWidth(3.0f);glBegin(GL_LINES);
  for(int n=1;n<skidCount;++n){
    const SkidPoint&a=skidPoints[(skidStart+n-1)%MAX_SKID_POINTS];const SkidPoint&b=skidPoints[(skidStart+n)%MAX_SKID_POINTS];
    float dx=b.lx-a.lx,dz=b.lz-a.lz;if(dx*dx+dz*dz>16.0f)continue;
    float shade=.025f+(1.0f-b.alpha)*.04f,fade=clampf(b.life/2.0f,0.0f,1.0f);glColor4f(shade,shade,shade,b.alpha*fade);
    glVertex3f(a.lx,.047f,a.lz);glVertex3f(b.lx,.047f,b.lz);glVertex3f(a.rx,.047f,a.rz);glVertex3f(b.rx,.047f,b.rz);
  }
  glEnd();glDepthMask(GL_TRUE);glDisable(GL_BLEND);
}

void cube(float x, float y, float z, float sx, float sy, float sz, float r, float g, float b) {
  glPushMatrix();
  glTranslatef(x, y, z);
  glScalef(sx, sy, sz);
  glColor3f(r, g, b);
  glBegin(GL_QUADS);
  glVertex3f(-.5f,-.5f,.5f); glVertex3f(.5f,-.5f,.5f); glVertex3f(.5f,.5f,.5f); glVertex3f(-.5f,.5f,.5f);
  glVertex3f(.5f,-.5f,-.5f); glVertex3f(-.5f,-.5f,-.5f); glVertex3f(-.5f,.5f,-.5f); glVertex3f(.5f,.5f,-.5f);
  glVertex3f(-.5f,-.5f,-.5f); glVertex3f(-.5f,-.5f,.5f); glVertex3f(-.5f,.5f,.5f); glVertex3f(-.5f,.5f,-.5f);
  glVertex3f(.5f,-.5f,.5f); glVertex3f(.5f,-.5f,-.5f); glVertex3f(.5f,.5f,-.5f); glVertex3f(.5f,.5f,.5f);
  glVertex3f(-.5f,.5f,.5f); glVertex3f(.5f,.5f,.5f); glVertex3f(.5f,.5f,-.5f); glVertex3f(-.5f,.5f,-.5f);
  glVertex3f(-.5f,-.5f,-.5f); glVertex3f(.5f,-.5f,-.5f); glVertex3f(.5f,-.5f,.5f); glVertex3f(-.5f,-.5f,.5f);
  glEnd();
  glPopMatrix();
}

void drawPerson(){
  glPushMatrix();glTranslatef(person.x,person.y,person.z);glRotatef(person.bodyYaw*180.0f/PI,0,1,0);
  float stride=std::sin(person.walkPhase)*.28f;
  float armSwing=std::sin(person.walkPhase)*.34f;
  // Tighter proportions: narrower torso, real neck, longer legs, boots.
  cube(0,1.18f,0,.48f,.78f,.30f,.10f,.18f,.30f); // torso
  cube(0,1.62f,0,.50f,.18f,.32f,.12f,.20f,.32f); // shoulders
  cube(0,1.78f,0,.16f,.12f,.16f,.66f,.45f,.31f); // neck
  cube(0,2.02f,0,.40f,.40f,.40f,.70f,.48f,.34f); // head
  cube(0,2.18f,.02f,.42f,.10f,.44f,.08f,.09f,.11f); // hair cap
  // Arms
  cube(-.40f,1.28f,armSwing,.14f,.70f,.14f,.70f,.48f,.34f);
  cube(.40f,1.28f,-armSwing,.14f,.70f,.14f,.70f,.48f,.34f);
  cube(-.40f,.88f,armSwing*.6f,.15f,.22f,.15f,.08f,.09f,.1f);
  cube(.40f,.88f,-armSwing*.6f,.15f,.22f,.15f,.08f,.09f,.1f);
  // Legs
  cube(-.14f,.55f,-stride,.18f,.95f,.20f,.09f,.11f,.15f);
  cube(.14f,.55f,stride,.18f,.95f,.20f,.09f,.11f,.15f);
  cube(-.14f,.08f,-stride+.06f,.24f,.14f,.40f,.04f,.045f,.05f);
  cube(.14f,.08f,stride+.06f,.24f,.14f,.40f,.04f,.045f,.05f);
  glPopMatrix();
}

void resetDestruction(){
  std::memset(buildingDamage,0,sizeof(buildingDamage));std::memset(rockets,0,sizeof(rockets));
  std::memset(bullets,0,sizeof(bullets));
  std::memset(explosionParticles,0,sizeof(explosionParticles));std::memset(explosionBlasts,0,sizeof(explosionBlasts));
  rocketCursor=bulletCursor=explosionParticleCursor=explosionBlastCursor=0;
  machineGunCooldown=muzzleFlashTimer=0;
  std::memset(buildingCollapse,0,sizeof(buildingCollapse));
  std::memset(buildingCollapsed,0,sizeof(buildingCollapsed));
  chaosScore=0;chaosCombo=1.0f;chaosDecay=0;
}

int buildingChunkBit(int side,int row,int column){return side*BUILDING_DAMAGE_ROWS*BUILDING_DAMAGE_COLS+row*BUILDING_DAMAGE_COLS+column;}

void buildingHitPanel(int buildingIndex,float hitX,float hitY,float hitZ,int side,int&row,int&column){
  const CityBuilding&b=CITY_BUILDINGS[buildingIndex];float across=0;
  if(side==0)across=(hitX-(b.x-b.width*.5f))/b.width;
  else if(side==1)across=((b.x+b.width*.5f)-hitX)/b.width;
  else if(side==2)across=((b.z+b.depth*.5f)-hitZ)/b.depth;
  else across=(hitZ-(b.z-b.depth*.5f))/b.depth;
  column=std::max(0,std::min(BUILDING_DAMAGE_COLS-1,(int)(clampf(across,0.0f,.999f)*BUILDING_DAMAGE_COLS)));
  row=std::max(0,std::min(BUILDING_DAMAGE_ROWS-1,(int)(clampf(hitY/b.height,0.0f,.999f)*BUILDING_DAMAGE_ROWS)));
}

void damageBuildingAt(int buildingIndex,float hitX,float hitY,float hitZ,int side,bool rocketDamage){
  if(buildingIndex<0||buildingIndex>=CITY_BUILDING_COUNT-1)return; // bespoke church remains structural for now
  if(buildingCollapsed[buildingIndex])return;
  int row=0,column=0;buildingHitPanel(buildingIndex,hitX,hitY,hitZ,side,row,column);
  if(!rocketDamage){
    buildingDamage[buildingIndex]|=1ULL<<buildingChunkBit(side,row,column);
    addChaos(3.5f);
    maybeCollapseBuilding(buildingIndex,hitX,hitY,hitZ);
    return;
  }
  // Rockets tear out a nine-block section and throw matching masonry debris.
  int startRow=std::max(0,std::min(BUILDING_DAMAGE_ROWS-3,row-1));
  int startColumn=std::max(0,std::min(BUILDING_DAMAGE_COLS-3,column-1));
  for(int rr=startRow;rr<startRow+3;++rr)for(int cc=startColumn;cc<startColumn+3;++cc)
    buildingDamage[buildingIndex]|=1ULL<<buildingChunkBit(side,rr,cc);
  // Extra vertical tear for bigger payoff.
  if(row+2<BUILDING_DAMAGE_ROWS)for(int cc=startColumn;cc<startColumn+3;++cc)
    buildingDamage[buildingIndex]|=1ULL<<buildingChunkBit(side,row+2,cc);
  addChaos(28.0f);
  maybeCollapseBuilding(buildingIndex,hitX,hitY,hitZ);
}

void spawnExplosion(float x,float y,float z){
  ExplosionBlast&blast=explosionBlasts[explosionBlastCursor++%MAX_EXPLOSION_BLASTS];blast={x,y,z,.32f,.32f,true};
  for(int i=0;i<28;++i){ExplosionParticle&p=explosionParticles[explosionParticleCursor++%MAX_EXPLOSION_PARTICLES];
    float angle=(i*2.39996f)+(explosionParticleCursor%7)*.19f;float lift=.35f+(i%6)*.17f;float speed=4.0f+(i%8)*.72f;
    p.x=x;p.y=y;p.z=z;p.vx=std::cos(angle)*speed;p.vz=std::sin(angle)*speed;p.vy=lift*speed;
    p.maxLife=p.life=.55f+(i%5)*.13f;p.size=i<12?.16f:.24f;
    if(i<8){p.r=1.0f;p.g=.58f+(i%3)*.12f;p.b=.04f;}else if(i<16){p.r=.30f;p.g=.25f;p.b=.20f;}else{p.r=.12f;p.g=.13f;p.b=.14f;}p.active=true;
  }
}

void spawnBuildingDebris(int buildingIndex,float x,float y,float z,int side){
  if(buildingIndex<0||buildingIndex>=CITY_BUILDING_COUNT)return;
  const CityBuilding&building=CITY_BUILDINGS[buildingIndex];
  float normalX=side==2?-1.0f:(side==3?1.0f:0.0f),normalZ=side==0?-1.0f:(side==1?1.0f:0.0f);
  for(int i=0;i<18;++i){ExplosionParticle&p=explosionParticles[explosionParticleCursor++%MAX_EXPLOSION_PARTICLES];
    float angle=i*2.39996f,speed=5.5f+(i%6)*1.0f;
    p.x=x+std::cos(angle)*(i%3)*.12f;p.y=y+(i%4)*.12f;p.z=z+std::sin(angle)*(i%3)*.12f;
    p.vx=normalX*(4.0f+(i%5)) + std::cos(angle)*speed*.62f;
    p.vz=normalZ*(4.0f+(i%5)) + std::sin(angle)*speed*.62f;p.vy=3.5f+(i%7)*.78f;
    p.maxLife=p.life=1.15f+(i%5)*.16f;p.size=.34f+(i%4)*.14f;
    p.r=building.r*(.72f+(i%3)*.12f);p.g=building.g*(.72f+(i%2)*.15f);p.b=building.b*.78f;p.active=true;
  }
}

bool projectileHitsPlayerCar(float x,float y,float z,float previousX,float previousZ,float radius){
  float base=carGroundHeight+carAirOffset;if(y<base-.15f||y>base+2.1f)return false;
  float dx=x-previousX,dz=z-previousZ,length2=dx*dx+dz*dz;
  float t=clampf(((car.x-previousX)*dx+(car.z-previousZ)*dz)/std::max(length2,.0001f),0.0f,1.0f);
  float px=previousX+dx*t-car.x,pz=previousZ+dz*t-car.z;return px*px+pz*pz<radius*radius;
}

bool projectileHitsPlane(float x,float y,float z,float previousX,float previousZ,float radius){
  if(!plane.active)return false;
  float dx=x-previousX,dz=z-previousZ,length2=dx*dx+dz*dz;
  float t=clampf(((plane.x-previousX)*dx+(plane.z-previousZ)*dz)/std::max(length2,.0001f),0.0f,1.0f);
  float px=previousX+dx*t-plane.x,pz=previousZ+dz*t-plane.z;
  return px*px+pz*pz<radius*radius&&y>=plane.y-.35f&&y<=plane.y+2.4f;
}
void damagePlane(float amount,float hitX,float hitZ){
  if(!plane.active)return;
  plane.health-=amount;float dx=plane.x-hitX,dz=plane.z-hitZ,dist=std::sqrt(std::max(.05f,dx*dx+dz*dz));
  plane.vx+=dx/dist*amount*.055f;plane.vz+=dz/dist*amount*.055f;
  if(plane.health<=0.0f){plane.health=0.0f;plane.active=false;plane.crashed=true;plane.respawn=6.0f;spawnExplosion(plane.x,plane.y+.65f,plane.z);}
}

void pushPlayerCar(float sourceX,float sourceZ,float force,float lift){
  float dx=car.x-sourceX,dz=car.z-sourceZ,distance=std::sqrt(std::max(dx*dx+dz*dz,.05f));
  float nx=dx/distance,nz=dz/distance;car.vx+=nx*force;car.vz+=nz*force;
  car.yawRate+=clampf((nx*std::cos(car.yaw)-nz*std::sin(car.yaw))*force*.055f,-1.8f,1.8f);
  carAirVelocity=std::max(carAirVelocity,lift);carAirOffset=std::max(carAirOffset,.04f);
}

void blastPlayerCar(float x,float z,float radius,float force,float lift){
  float dx=car.x-x,dz=car.z-z,distance=std::sqrt(dx*dx+dz*dz);
  if(distance<radius)pushPlayerCar(x,z,force*(1.0f-distance/radius)+2.0f,lift*(1.0f-distance/radius)+1.0f);
}

void updateCarAir(float dt){
  if(carAirOffset<=0.0f&&carAirVelocity<=0.0f)return;
  carAirVelocity-=15.5f*dt;carAirOffset+=carAirVelocity*dt;
  if(carAirOffset<=0.0f){carAirOffset=0.0f;carAirVelocity=0.0f;}
}

void updateUnoccupiedCar(float dt){
  if(playerControlMode!=PlayerControlMode::OnFoot)return;
  car.x+=car.vx*dt;car.z+=car.vz*dt;car.yaw+=car.yawRate*dt;
  float damping=std::pow(.975f,dt*60.0f);car.vx*=damping;car.vz*=damping;car.yawRate*=std::pow(.96f,dt*60.0f);
  if(driveEnvironment==DriveEnvironment::City){
    float target=carOnHighway?HIGHWAY_HEIGHT:cityGroundHeightAt(car.x,car.z)+citySurfaceBumpAt(car.x,car.z);
    carGroundHeight+=(target-carGroundHeight)*clampf(dt*12.0f,0.0f,1.0f);resolveCityCollisions(dt);
  }
}

void spawnRocketMuzzleBurst(float x,float y,float z,float dx,float dy,float dz){
  for(int i=0;i<8;++i){ExplosionParticle&p=explosionParticles[explosionParticleCursor++%MAX_EXPLOSION_PARTICLES];
    float spread=(i-3.5f)*.10f;p.x=x;p.y=y;p.z=z;p.vx=-dx*(3.2f+i*.18f)+std::cos(i*2.2f)*spread;
    p.vy=-dy*2.0f+.4f+(i%3)*.18f;p.vz=-dz*(3.2f+i*.18f)+std::sin(i*2.2f)*spread;
    p.maxLife=p.life=.16f+(i%3)*.035f;p.size=.11f+(i%2)*.05f;p.r=1.0f;p.g=.48f+(i%3)*.10f;p.b=.03f;p.active=true;
  }
}

void fireRocket(){
  float cp=std::cos(person.viewPitch),sp=std::sin(person.viewPitch),dx=std::sin(person.viewYaw)*cp,dy=sp,dz=std::cos(person.viewYaw)*cp;
  // Spawn from eye/muzzle with slight right-hand offset so FPS rockets don't clip the camera.
  float rx=std::cos(person.viewYaw),rz=-std::sin(person.viewYaw);
  Rocket&r=rockets[rocketCursor++%MAX_ROCKETS];
  r.x=person.x+dx*1.35f+rx*.28f;r.y=person.y+1.58f+dy*.55f;r.z=person.z+dz*1.35f+rz*.28f;
  r.vx=dx*38.0f;r.vy=dy*38.0f;r.vz=dz*38.0f;r.yaw=person.viewYaw;r.pitch=person.viewPitch;r.life=5.0f;r.active=true;
  spawnRocketMuzzleBurst(r.x,r.y,r.z,dx,dy,dz);
  // Positive pitch points upward (dy = sin(viewPitch)); kick the rendered view up.
  aimRecoil=std::max(aimRecoil,.085f);shootShake=.22f;addChaos(2.0f);
}

void fireMachineGun(){
  float cp=std::cos(person.viewPitch),sp=std::sin(person.viewPitch),dx=std::sin(person.viewYaw)*cp,dy=sp,dz=std::cos(person.viewYaw)*cp;
  // Tiny cone spread for spray feel.
  float spreadYaw=(std::sin(person.walkPhase*8.0f)+((bulletCursor%5)-2)*.08f)*.012f;
  float spreadPitch=((bulletCursor%3)-1)*.01f;
  float yaw=person.viewYaw+spreadYaw,pitch=person.viewPitch+spreadPitch;
  cp=std::cos(pitch);sp=std::sin(pitch);dx=std::sin(yaw)*cp;dy=sp;dz=std::cos(yaw)*cp;
  float rx=std::cos(person.viewYaw),rz=-std::sin(person.viewYaw);
  Bullet&b=bullets[bulletCursor++%MAX_BULLETS];
  b.x=person.x+dx*1.05f+rx*.22f;b.y=person.y+1.52f+dy*.3f;b.z=person.z+dz*1.05f+rz*.22f;
  b.vx=dx*110.0f;b.vy=dy*110.0f;b.vz=dz*110.0f;b.life=1.6f;b.active=true;muzzleFlashTimer=.05f;
  // Same positive upward-view convention as the rocket launcher.
  aimRecoil=std::max(aimRecoil,.018f);shootShake=std::max(shootShake,.08f);addChaos(.35f);
}

void updateRocketsAndExplosions(float dt){
  for(Rocket&r:rockets){if(!r.active)continue;float previousX=r.x,previousZ=r.z;r.x+=r.vx*dt;r.y+=r.vy*dt;r.z+=r.vz*dt;r.life-=dt;int hit=-1;
    if(projectileHitsPlayerCar(r.x,r.y,r.z,previousX,previousZ,1.65f)){
      spawnExplosion(r.x,r.y,r.z);pushPlayerCar(previousX,previousZ,24.0f,9.0f);blastCityProps(r.x,r.z,8.5f,28.0f);damageDynamicParkedAt(r.x,r.z,9.0f,30.0f,true);damageSandboxVehicleAt(r.x,r.z,9.0f,30.0f,true);damageTrafficAt(r.x,r.z,9.0f,30.0f,true);addChaos(18.0f);r.active=false;continue;
    }
    if(projectileHitsPlane(r.x,r.y,r.z,previousX,previousZ,2.7f)){
      spawnExplosion(r.x,r.y,r.z);damagePlane(55.0f,previousX,previousZ);r.active=false;continue;
    }
    if(driveEnvironment==DriveEnvironment::City&&hitCityPropWithProjectile(r.x,r.y,r.z,previousX,previousZ,true)){
      spawnExplosion(r.x,r.y,r.z);blastCityProps(r.x,r.z,8.5f,28.0f);blastPlayerCar(r.x,r.z,8.5f,20.0f,7.5f);damageDynamicParkedAt(r.x,r.z,9.0f,28.0f,true);damageSandboxVehicleAt(r.x,r.z,9.0f,28.0f,true);damageTrafficAt(r.x,r.z,9.0f,28.0f,true);addChaos(12.0f);r.active=false;continue;
    }
    if(driveEnvironment==DriveEnvironment::City)for(int i=0;i<CITY_BUILDING_COUNT;++i){const CityBuilding&b=CITY_BUILDINGS[i];
      if(r.y>=0&&r.y<=b.height&&std::fabs(r.x-b.x)<=b.width*.5f&&std::fabs(r.z-b.z)<=b.depth*.5f){hit=i;break;}}
    if(hit>=0){const CityBuilding&building=CITY_BUILDINGS[hit];int side=std::fabs(r.vx)>std::fabs(r.vz)?(r.vx>0?2:3):(r.vz>0?0:1);
      float impactX=r.x,impactY=clampf(r.y,.15f,building.height-.15f),impactZ=r.z;
      if(side==0)impactZ=building.z-building.depth*.5f-.05f;else if(side==1)impactZ=building.z+building.depth*.5f+.05f;
      else if(side==2)impactX=building.x-building.width*.5f-.05f;else impactX=building.x+building.width*.5f+.05f;
      damageBuildingAt(hit,impactX,impactY,impactZ,side,true);spawnExplosion(impactX,impactY,impactZ);spawnBuildingDebris(hit,impactX,impactY,impactZ,side);
      blastCityProps(impactX,impactZ,9.0f,30.0f);blastPlayerCar(impactX,impactZ,10.0f,23.0f,8.0f);damageDynamicParkedAt(impactX,impactZ,10.0f,32.0f,true);damageSandboxVehicleAt(impactX,impactZ,10.0f,32.0f,true);damageTrafficAt(impactX,impactZ,10.0f,32.0f,true);r.active=false;continue;}
    if(r.y<=.05f||r.life<=0||std::fabs(r.x)>560||std::fabs(r.z)>320){if(r.y<=.05f&&r.life>0){spawnExplosion(r.x,.2f,r.z);blastPlayerCar(r.x,r.z,9.0f,20.0f,7.0f);damageDynamicParkedAt(r.x,r.z,9.0f,24.0f,true);damageSandboxVehicleAt(r.x,r.z,9.0f,24.0f,true);damageTrafficAt(r.x,r.z,9.0f,24.0f,true);addChaos(8.0f);}r.active=false;}
  }
  for(Bullet&b:bullets){if(!b.active)continue;float previousX=b.x,previousZ=b.z;b.x+=b.vx*dt;b.y+=b.vy*dt;b.z+=b.vz*dt;b.life-=dt;int hit=-1;
    if(projectileHitsPlayerCar(b.x,b.y,b.z,previousX,previousZ,1.42f)){pushPlayerCar(previousX,previousZ,.65f,.18f);b.active=false;continue;}
    if(projectileHitsPlane(b.x,b.y,b.z,previousX,previousZ,2.3f)){damagePlane(7.0f,previousX,previousZ);b.active=false;continue;}
    if(driveEnvironment==DriveEnvironment::City&&hitCityPropWithProjectile(b.x,b.y,b.z,previousX,previousZ,false)){b.active=false;continue;}
    if(driveEnvironment==DriveEnvironment::City)for(int i=0;i<CITY_BUILDING_COUNT;++i){const CityBuilding&building=CITY_BUILDINGS[i];
      if(b.y>=0&&b.y<=building.height&&std::fabs(b.x-building.x)<=building.width*.5f&&std::fabs(b.z-building.z)<=building.depth*.5f){hit=i;break;}}
    if(hit>=0){int side=std::fabs(b.vx)>std::fabs(b.vz)?(b.vx>0?2:3):(b.vz>0?0:1);damageBuildingAt(hit,b.x,b.y,b.z,side,false);b.active=false;continue;}
    if(driveEnvironment==DriveEnvironment::City){damageDynamicParkedAt(b.x,b.z,1.4f,8.0f,false);damageSandboxVehicleAt(b.x,b.z,1.4f,8.0f,false);damageTrafficAt(b.x,b.z,1.4f,8.0f,false);}
    if(b.y<=.02f||b.life<=0||std::fabs(b.x)>560||std::fabs(b.z)>320)b.active=false;
  }
  machineGunCooldown=std::max(0.0f,machineGunCooldown-dt);muzzleFlashTimer=std::max(0.0f,muzzleFlashTimer-dt);
  for(ExplosionParticle&p:explosionParticles){if(!p.active)continue;p.life-=dt;if(p.life<=0){p.active=false;continue;}
    p.vy-=12.0f*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;float drag=std::pow(.975f,dt*60);p.vx*=drag;p.vz*=drag;
    if(p.y<.08f){p.y=.08f;p.vy=std::fabs(p.vy)*.28f;p.vx*=.66f;p.vz*=.66f;}
  }
  for(ExplosionBlast&b:explosionBlasts)if(b.active){b.life-=dt;if(b.life<=0)b.active=false;}
}

void drawWeaponWorld(){
  glPushMatrix();glTranslatef(person.x,person.y+1.42f,person.z);glRotatef(person.viewYaw*180.0f/PI,0,1,0);glRotatef(-person.viewPitch*180.0f/PI,1,0,0);
  if(selectedWeapon==WeaponType::RocketLauncher){cube(.34f,.10f,.42f,.26f,.26f,1.65f,.14f,.19f,.12f);cube(.34f,.10f,1.25f,.42f,.42f,.18f,.08f,.10f,.075f);cube(.34f,-.17f,.22f,.16f,.48f,.18f,.10f,.12f,.09f);}
  else{cube(.30f,.06f,.55f,.20f,.25f,1.45f,.075f,.08f,.085f);cube(.30f,.02f,.10f,.30f,.36f,.48f,.11f,.115f,.12f);cube(.30f,-.26f,.15f,.14f,.48f,.18f,.075f,.08f,.085f);if(muzzleFlashTimer>0)cube(.30f,.06f,1.38f,.38f,.38f,.38f,1.0f,.62f,.08f);}
  glPopMatrix();
}

void drawRocketsAndExplosions(){
  for(const Rocket&r:rockets){if(!r.active)continue;glPushMatrix();glTranslatef(r.x,r.y,r.z);glRotatef(r.yaw*180.0f/PI,0,1,0);glRotatef(-r.pitch*180.0f/PI,1,0,0);
    cube(0,0,0,.18f,.18f,.72f,.18f,.21f,.16f);cube(0,0,.42f,.22f,.22f,.18f,.92f,.28f,.035f);cube(0,0,-.44f,.13f,.13f,.22f,1.0f,.62f,.08f);glPopMatrix();}
  for(const Bullet&b:bullets)if(b.active)cube(b.x,b.y,b.z,.07f,.07f,.42f,1.0f,.72f,.15f);
  for(const ExplosionBlast&b:explosionBlasts)if(b.active){float phase=1.0f-b.life/b.maxLife,size=std::sin(phase*PI)*2.8f;
    cube(b.x,b.y,b.z,size,size,size,1.0f,.38f,.025f);cube(b.x,b.y,b.z,size*.56f,size*.56f,size*.56f,1.0f,.82f,.16f);}
  for(const ExplosionParticle&p:explosionParticles)if(p.active){float fade=clampf(p.life/p.maxLife,0.0f,1.0f);cube(p.x,p.y,p.z,p.size,p.size,p.size,p.r*fade,p.g*fade,p.b*fade);}
}

void drawWheel(float x, float z, float steering) {
  glPushMatrix();
  glTranslatef(x, -.2f, z);
  glRotatef(steering * 180.0f / PI, 0, 1, 0);
  glRotatef(wheelSpin*180.0f/PI,1,0,0);
  constexpr int SIDES=12;constexpr float radius=.36f,halfWidth=.19f;
  glColor3f(.025f,.027f,.030f);glBegin(GL_QUADS);
  for(int i=0;i<SIDES;++i){float a=i*2*PI/SIDES,b=(i+1)*2*PI/SIDES;
    float ya=std::cos(a)*radius,za=std::sin(a)*radius,yb=std::cos(b)*radius,zb=std::sin(b)*radius;
    glVertex3f(-halfWidth,ya,za);glVertex3f(halfWidth,ya,za);glVertex3f(halfWidth,yb,zb);glVertex3f(-halfWidth,yb,zb);
  }glEnd();
  for(int side=-1;side<=1;side+=2){
    float rimShade=selectedWheelStyle==1?.30f:(selectedWheelStyle==2?.12f:.18f);
    glColor3f(rimShade,rimShade+.02f,rimShade+.04f);glBegin(GL_TRIANGLE_FAN);glVertex3f(side*halfWidth*1.01f,0,0);
    for(int i=0;i<=SIDES;++i){float a=i*2*PI/SIDES;glVertex3f(side*halfWidth*1.01f,std::cos(a)*.235f,std::sin(a)*.235f);}glEnd();
    int spokes=selectedWheelStyle==1?12:(selectedWheelStyle==2?5:6);
    glColor3f(selectedWheelStyle==1?.82f:.72f,selectedWheelStyle==1?.70f:.74f,selectedWheelStyle==1?.42f:.76f);glBegin(GL_LINES);
    for(int i=0;i<spokes;++i){float a=i*2*PI/spokes;float hub=selectedWheelStyle==2?.055f:0.0f;
      glVertex3f(side*halfWidth*1.02f,std::cos(a)*hub,std::sin(a)*hub);glVertex3f(side*halfWidth*1.02f,std::cos(a)*.19f,std::sin(a)*.19f);}glEnd();
  }
  glPopMatrix();
}

void drawSmoke(){
  glEnable(GL_BLEND);glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);glDepthMask(GL_FALSE);
  for(int i=0;i<MAX_SMOKE_PARTICLES;++i){const SmokeParticle&p=smokeParticles[i];if(!p.active)continue;
    float alpha=clampf(p.life*1.25f,0.0f,.55f);glColor4f(p.shade,p.shade,p.shade,alpha);float s=p.size;
    glBegin(GL_QUADS);
    glVertex3f(p.x-s,p.y,p.z-s);glVertex3f(p.x+s,p.y,p.z-s);glVertex3f(p.x+s,p.y,p.z+s);glVertex3f(p.x-s,p.y,p.z+s);
    glVertex3f(p.x-s,p.y-s*.35f,p.z);glVertex3f(p.x+s,p.y-s*.35f,p.z);glVertex3f(p.x+s,p.y+s*.85f,p.z);glVertex3f(p.x-s,p.y+s*.85f,p.z);
    glEnd();
  }
  glDepthMask(GL_TRUE);glDisable(GL_BLEND);
}

void flatQuad(float x0,float z0,float x1,float z1,float y,float r,float g,float b){
  glColor3f(r,g,b);glBegin(GL_QUADS);
  glVertex3f(x0,y,z0);glVertex3f(x1,y,z0);glVertex3f(x1,y,z1);glVertex3f(x0,y,z1);
  glEnd();
}

bool loadJpegTexture(const char*path,GLuint&texture){
  FILE*file=std::fopen(path,"rb");if(!file)return false;
  std::fseek(file,0,SEEK_END);long size=std::ftell(file);std::rewind(file);if(size<=0){std::fclose(file);return false;}
  unsigned char*encoded=(unsigned char*)std::malloc(size);if(!encoded){std::fclose(file);return false;}
  bool ok=std::fread(encoded,1,size,file)==(size_t)size;std::fclose(file);if(!ok){std::free(encoded);return false;}
  jpeg_decompress_struct decoder{};jpeg_error_mgr errors{};decoder.err=jpeg_std_error(&errors);jpeg_create_decompress(&decoder);
  jpeg_mem_src(&decoder,encoded,size);jpeg_read_header(&decoder,TRUE);decoder.out_color_space=JCS_RGB;jpeg_start_decompress(&decoder);
  int width=decoder.output_width,height=decoder.output_height;unsigned char*pixels=(unsigned char*)std::malloc(width*height*3);
  if(!pixels){jpeg_destroy_decompress(&decoder);std::free(encoded);return false;}
  while(decoder.output_scanline<decoder.output_height){unsigned char*row=pixels+decoder.output_scanline*width*3;jpeg_read_scanlines(&decoder,&row,1);}
  jpeg_finish_decompress(&decoder);jpeg_destroy_decompress(&decoder);std::free(encoded);
  glGenTextures(1,&texture);glBindTexture(GL_TEXTURE_2D,texture);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
  glTexImage2D(GL_TEXTURE_2D,0,GL_RGB,width,height,0,GL_RGB,GL_UNSIGNED_BYTE,pixels);std::free(pixels);return true;
}

bool loadEnvironmentTexture(){return loadJpegTexture("app0:assets/environment-atlas.jpg",environmentTexture);}

void texturedRect(float x0,float z0,float x1,float z1,float y,float u0,float v0,float u1,float v1,float tile=10.0f){
  if(!environmentTexture){flatQuad(x0,z0,x1,z1,y,.25f,.30f,.25f);return;}
  glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,environmentTexture);
  glColor3f(1,1,1);glBegin(GL_QUADS);
  for(float x=x0;x<x1;x+=tile)for(float z=z0;z<z1;z+=tile){float tx1=std::min(x+tile,x1),tz1=std::min(z+tile,z1);
    glTexCoord2f(u0,v0);glVertex3f(x,y,z);glTexCoord2f(u1,v0);glVertex3f(tx1,y,z);
    glTexCoord2f(u1,v1);glVertex3f(tx1,y,tz1);glTexCoord2f(u0,v1);glVertex3f(x,y,tz1);
  }glEnd();
  glDisable(GL_TEXTURE_2D);
}

void texturedCube(float x,float y,float z,float sx,float sy,float sz,const AtlasUv&uv,float r=1,float g=1,float b=1){
  if(!environmentTexture){cube(x,y,z,sx,sy,sz,r,g,b);return;}glPushMatrix();glTranslatef(x,y,z);glScalef(sx,sy,sz);
  glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,environmentTexture);glColor3f(r,g,b);glBegin(GL_QUADS);
  glTexCoord2f(uv.u0,uv.v0);glVertex3f(-.5f,-.5f,.5f);glTexCoord2f(uv.u1,uv.v0);glVertex3f(.5f,-.5f,.5f);glTexCoord2f(uv.u1,uv.v1);glVertex3f(.5f,.5f,.5f);glTexCoord2f(uv.u0,uv.v1);glVertex3f(-.5f,.5f,.5f);
  glTexCoord2f(uv.u0,uv.v0);glVertex3f(.5f,-.5f,-.5f);glTexCoord2f(uv.u1,uv.v0);glVertex3f(-.5f,-.5f,-.5f);glTexCoord2f(uv.u1,uv.v1);glVertex3f(-.5f,.5f,-.5f);glTexCoord2f(uv.u0,uv.v1);glVertex3f(.5f,.5f,-.5f);
  glTexCoord2f(uv.u0,uv.v0);glVertex3f(-.5f,-.5f,-.5f);glTexCoord2f(uv.u1,uv.v0);glVertex3f(-.5f,-.5f,.5f);glTexCoord2f(uv.u1,uv.v1);glVertex3f(-.5f,.5f,.5f);glTexCoord2f(uv.u0,uv.v1);glVertex3f(-.5f,.5f,-.5f);
  glTexCoord2f(uv.u0,uv.v0);glVertex3f(.5f,-.5f,.5f);glTexCoord2f(uv.u1,uv.v0);glVertex3f(.5f,-.5f,-.5f);glTexCoord2f(uv.u1,uv.v1);glVertex3f(.5f,.5f,-.5f);glTexCoord2f(uv.u0,uv.v1);glVertex3f(.5f,.5f,.5f);
  glEnd();glDisable(GL_TEXTURE_2D);glPopMatrix();
}

bool buildingChunkDestroyed(int buildingIndex,int side,int row,int column){return (buildingDamage[buildingIndex]&(1ULL<<buildingChunkBit(side,row,column)))!=0;}

void drawDestructibleBuilding(const CityBuilding&b,int buildingIndex,const AtlasUv&uv){
  float x0=b.x-b.width*.5f,x1=b.x+b.width*.5f,z0=b.z-b.depth*.5f,z1=b.z+b.depth*.5f;
  auto wallPoint=[&](int side,float across,float inset,float&x,float&z){
    if(side==0){x=x0+b.width*across;z=z0+inset;}
    else if(side==1){x=x1-b.width*across;z=z1-inset;}
    else if(side==2){x=x0+inset;z=z1-b.depth*across;}
    else{x=x1-inset;z=z0+b.depth*across;}
  };
  if(environmentTexture){glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,environmentTexture);}
  glColor3f(b.r*1.18f,b.g*1.18f,b.b*1.18f);glBegin(GL_QUADS);
  for(int side=0;side<BUILDING_DAMAGE_SIDES;++side)for(int row=0;row<BUILDING_DAMAGE_ROWS;++row)for(int column=0;column<BUILDING_DAMAGE_COLS;++column){
    float a0=(float)column/BUILDING_DAMAGE_COLS,a1=(float)(column+1)/BUILDING_DAMAGE_COLS;
    float y0=b.height*(float)row/BUILDING_DAMAGE_ROWS,y1=b.height*(float)(row+1)/BUILDING_DAMAGE_ROWS;
    float ax,az,bx,bz;wallPoint(side,a0,0,ax,az);wallPoint(side,a1,0,bx,bz);
    if(buildingChunkDestroyed(buildingIndex,side,row,column)){
      // Persistent recessed charcoal backing keeps battle damage solid and readable.
      float iax,iaz,ibx,ibz;wallPoint(side,a0,.38f,iax,iaz);wallPoint(side,a1,.38f,ibx,ibz);
      glColor3f(.045f,.050f,.055f);glVertex3f(iax,y0,iaz);glVertex3f(ibx,y0,ibz);glVertex3f(ibx,y1,ibz);glVertex3f(iax,y1,iaz);
      continue;
    }
    glTexCoord2f(uv.u0,uv.v1);glVertex3f(ax,y0,az);glTexCoord2f(uv.u1,uv.v1);glVertex3f(bx,y0,bz);
    glTexCoord2f(uv.u1,uv.v0);glVertex3f(bx,y1,bz);glTexCoord2f(uv.u0,uv.v0);glVertex3f(ax,y1,az);
  }
  // Roof remains structural while facade chunks can be blown away.
  glTexCoord2f(uv.u0,uv.v0);glVertex3f(x0,b.height,z0);glTexCoord2f(uv.u1,uv.v0);glVertex3f(x1,b.height,z0);
  glTexCoord2f(uv.u1,uv.v1);glVertex3f(x1,b.height,z1);glTexCoord2f(uv.u0,uv.v1);glVertex3f(x0,b.height,z1);glEnd();
  if(environmentTexture)glDisable(GL_TEXTURE_2D);
  // Add a cheap broken concrete frame after the backed facade, so damage reads
  // as a scorched cavity with remaining masonry rather than a transparent shell.
  for(int side=0;side<BUILDING_DAMAGE_SIDES;++side)for(int row=0;row<BUILDING_DAMAGE_ROWS;++row)for(int column=0;column<BUILDING_DAMAGE_COLS;++column)if(buildingChunkDestroyed(buildingIndex,side,row,column)){
    float a=(column+.5f)/BUILDING_DAMAGE_COLS,y=b.height*(row+.5f)/BUILDING_DAMAGE_ROWS,px,pz;wallPoint(side,a,.05f,px,pz);
    cube(px,y,pz,side<2?b.width/BUILDING_DAMAGE_COLS+.10f:.16f,.10f,side<2?.16f:b.depth/BUILDING_DAMAGE_COLS+.10f,.16f,.13f,.10f);
    cube(px,y,pz,side<2?.14f:b.depth/BUILDING_DAMAGE_COLS+.10f,.12f,side<2?b.width/BUILDING_DAMAGE_COLS+.10f:.14f,.25f,.18f,.12f);
  }
}

void drawSky(){
  if(!environmentTexture)return;
  // A flight-safe dome: large enough for the expanded city and 420 m ceiling.
  glDepthMask(GL_FALSE);glDisable(GL_CULL_FACE);glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,environmentTexture);glColor3f(1,1,1);
  constexpr float skyRadius=2600.0f,skyFloor=-40.0f,skyTop=620.0f;
  constexpr int sides=32;glBegin(GL_QUADS);for(int i=0;i<sides;++i){float a=i*2*PI/sides,b=(i+1)*2*PI/sides;
    float u0=UV_SKY.u0+(i%6)*(UV_SKY.u1-UV_SKY.u0)/6.0f,u1=UV_SKY.u0+((i%6)+1)*(UV_SKY.u1-UV_SKY.u0)/6.0f;
    glTexCoord2f(u0,UV_SKY.v1);glVertex3f(std::sin(a)*skyRadius,skyFloor,std::cos(a)*skyRadius);glTexCoord2f(u1,UV_SKY.v1);glVertex3f(std::sin(b)*skyRadius,skyFloor,std::cos(b)*skyRadius);
    glTexCoord2f(u1,UV_SKY.v0);glVertex3f(std::sin(b)*skyRadius,skyTop,std::cos(b)*skyRadius);glTexCoord2f(u0,UV_SKY.v0);glVertex3f(std::sin(a)*skyRadius,skyTop,std::cos(a)*skyRadius);
  }glEnd();glDisable(GL_TEXTURE_2D);glDepthMask(GL_TRUE);
}

void drawLamp(const KnockableProp& prop){
  if(!prop.active)return;
  glPushMatrix();glTranslatef(prop.x,cityGroundHeightAt(prop.x,prop.z),prop.z);glRotatef(prop.yaw,0,1,0);glRotatef(-prop.fall,1,0,0);
  texturedCube(0,2.15f,0,.20f,4.3f,.20f,UV_METAL,.82f,.84f,.86f);
  cube(0,4.35f,0,.75f,.24f,.75f,.95f,.82f,.42f);
  glPopMatrix();
}

void drawBench(const KnockableProp& prop){
  if(!prop.active)return;
  glPushMatrix();glTranslatef(prop.x,cityGroundHeightAt(prop.x,prop.z)+.42f,prop.z);glRotatef(prop.yaw,0,1,0);glRotatef(prop.fall,1,0,0);
  texturedCube(0,0,0,2.4f,.22f,.72f,UV_WOOD,.92f,.82f,.68f);
  texturedCube(0,.55f,.31f,2.4f,.75f,.16f,UV_WOOD,.92f,.82f,.68f);
  texturedCube(-.85f,-.35f,0,.16f,.7f,.55f,UV_METAL,.68f,.70f,.72f);
  texturedCube(.85f,-.35f,0,.16f,.7f,.55f,UV_METAL,.68f,.70f,.72f);
  glPopMatrix();
}

void drawTree(float x,float z,float scale=1.0f){
  cube(x,1.5f*scale,z,.48f*scale,3.0f*scale,.48f*scale,.30f,.17f,.07f);
  glPushMatrix();glTranslatef(x,4.0f*scale,z);glScalef(scale,scale,scale);glColor3f(.10f,.38f,.09f);glBegin(GL_TRIANGLES);
  for(int i=0;i<8;++i){float a=i*PI*.25f,b=(i+1)*PI*.25f;glVertex3f(0,3.2f,0);glVertex3f(std::sin(a)*2.0f,-1.2f,std::cos(a)*2.0f);glVertex3f(std::sin(b)*2.0f,-1.2f,std::cos(b)*2.0f);}
  glEnd();glColor3f(.15f,.48f,.12f);glBegin(GL_TRIANGLES);for(int i=0;i<8;++i){float a=i*PI*.25f,b=(i+1)*PI*.25f;glVertex3f(0,1.8f,0);glVertex3f(std::sin(a)*2.6f,-2.2f,std::cos(a)*2.6f);glVertex3f(std::sin(b)*2.6f,-2.2f,std::cos(b)*2.6f);}glEnd();glPopMatrix();
}

void drawBush(float x,float z,float scale=1.0f){
  float y=cityGroundHeightAt(x,z);cube(x,y+.45f,z,1.35f*scale,.9f*scale,1.1f*scale,.10f,.34f,.08f);
  cube(x-.42f*scale,y+.58f,z+.18f*scale,.75f*scale,.72f*scale,.75f*scale,.16f,.43f,.10f);
  cube(x+.43f*scale,y+.55f,z-.12f*scale,.78f*scale,.68f*scale,.78f*scale,.13f,.39f,.09f);
}

void drawFencePiece(int index){
  const KnockableProp&prop=fencePieces[index];if(!prop.active)return;
  glPushMatrix();glTranslatef(prop.x,cityGroundHeightAt(prop.x,prop.z),prop.z);
  glRotatef(prop.yaw,0,1,0);glRotatef(prop.fall,1,0,0);
  if(fencePieceIsPost[index])
    texturedCube(0,.75f,0,.14f,1.5f,.14f,UV_WOOD,.66f,.48f,.28f);
  else
    texturedCube(0,fencePieceUpperRail[index]?1.18f:.70f,0,.12f,.14f,fencePieceLength[index],UV_WOOD,.66f,.48f,.28f);
  glPopMatrix();
}

void drawStopSign(const KnockableProp&prop){
  if(!prop.active)return;
  glPushMatrix();glTranslatef(prop.x,cityGroundHeightAt(prop.x,prop.z),prop.z);glRotatef(prop.yaw,0,1,0);glRotatef(-prop.fall,1,0,0);cube(0,1.5f,0,.12f,3.0f,.12f,.62f,.64f,.65f);
  glTranslatef(0,3.1f,0);glColor3f(.82f,.035f,.025f);glBegin(GL_TRIANGLE_FAN);glVertex3f(0,0,0);
  for(int i=0;i<=8;++i){float a=PI*.125f+i*PI*.25f;glVertex3f(std::cos(a)*.64f,std::sin(a)*.64f,.03f);}glEnd();
  glColor3f(1,1,1);glLineWidth(3);glBegin(GL_LINE_LOOP);for(int i=0;i<8;++i){float a=PI*.125f+i*PI*.25f;glVertex3f(std::cos(a)*.56f,std::sin(a)*.56f,.045f);}glEnd();glPopMatrix();
}

void drawTrafficLight(const KnockableProp&prop){
  if(!prop.active)return;
  glPushMatrix();glTranslatef(prop.x,cityGroundHeightAt(prop.x,prop.z),prop.z);glRotatef(prop.yaw,0,1,0);glRotatef(-prop.fall,1,0,0);cube(0,2.7f,0,.16f,5.4f,.16f,.16f,.18f,.19f);cube(.95f,5.25f,0,2.0f,.14f,.14f,.16f,.18f,.19f);
  cube(1.78f,4.75f,0,.48f,1.25f,.42f,.08f,.09f,.09f);cube(1.78f,5.12f,-.23f,.22f,.22f,.05f,.92f,.12f,.06f);cube(1.78f,4.77f,-.23f,.22f,.22f,.05f,.95f,.72f,.08f);cube(1.78f,4.42f,-.23f,.22f,.22f,.05f,.08f,.78f,.18f);glPopMatrix();
}

void drawBusStop(const KnockableProp&prop){
  if(!prop.active)return;
  glPushMatrix();glTranslatef(prop.x,cityGroundHeightAt(prop.x,prop.z),prop.z);glRotatef(prop.yaw,0,1,0);glRotatef(prop.fall,1,0,0);cube(0,2.05f,.42f,3.6f,.16f,1.25f,.12f,.16f,.18f);cube(-1.72f,1.05f,0,.12f,2.1f,1.05f,.42f,.62f,.68f);cube(1.72f,1.05f,0,.12f,2.1f,1.05f,.42f,.62f,.68f);
  cube(0,1.12f,.50f,3.25f,1.9f,.08f,.30f,.50f,.58f);cube(0,.48f,.05f,2.3f,.18f,.48f,.42f,.23f,.09f);glPopMatrix();
}

void drawStreetSign(const KnockableProp&prop){
  if(!prop.active)return;
  glPushMatrix();glTranslatef(prop.x,cityGroundHeightAt(prop.x,prop.z),prop.z);glRotatef(prop.yaw,0,1,0);glRotatef(-prop.fall,1,0,0);cube(0,1.5f,0,.10f,3.0f,.10f,.60f,.62f,.63f);cube(0,3.0f,0,1.65f,.42f,.10f,.06f,.40f,.18f);glPopMatrix();
}

void drawChurch(){
  constexpr float x=140,z=145;
  texturedCube(x,5.0f,z,14,10,18,UV_STONE,1.0f,.98f,.92f);texturedCube(x,11.5f,z-5,5.2f,13,5.5f,UV_STONE,1.0f,.98f,.92f);
  glColor3f(.30f,.12f,.08f);glBegin(GL_TRIANGLES);glVertex3f(x-7.5f,10,z-9);glVertex3f(x+7.5f,10,z-9);glVertex3f(x,14,z-9);glVertex3f(x-7.5f,10,z+9);glVertex3f(x,14,z+9);glVertex3f(x+7.5f,10,z+9);glEnd();
  glBegin(GL_QUADS);glVertex3f(x-7.5f,10,z-9);glVertex3f(x,14,z-9);glVertex3f(x,14,z+9);glVertex3f(x-7.5f,10,z+9);glVertex3f(x,14,z-9);glVertex3f(x+7.5f,10,z-9);glVertex3f(x+7.5f,10,z+9);glVertex3f(x,14,z+9);glEnd();
  glColor3f(.22f,.10f,.06f);glBegin(GL_TRIANGLES);for(int i=0;i<8;++i){float a=i*PI*.25f,b=(i+1)*PI*.25f;glVertex3f(x,20.5f,z-5);glVertex3f(x+std::sin(a)*3.2f,18,z-5+std::cos(a)*3.2f);glVertex3f(x+std::sin(b)*3.2f,18,z-5+std::cos(b)*3.2f);}glEnd();
  cube(x,4.0f,z-9.08f,2.6f,5.5f,.12f,.22f,.11f,.045f);cube(x,15.7f,z-7.85f,.18f,3.0f,.18f,.78f,.72f,.48f);cube(x,17.0f,z-7.85f,1.4f,.18f,.18f,.78f,.72f,.48f);
}

void drawParkDistrict(){
  // The park-road mesh and its trees are static world decoration. Keep the
  // expensive road geometry near the player; distant park detail was a major
  // immediate-mode submission cost in the City Drive regression.
  float focusX=playerControlMode==PlayerControlMode::OnFoot?person.x:car.x;
  float focusZ=playerControlMode==PlayerControlMode::OnFoot?person.z:car.z;
  float focusDx=focusX-235.0f,focusDz=focusZ-110.0f;
  if(focusDx*focusDx+focusDz*focusDz>245.0f*245.0f)return;
  auto samplePoint=[](int sample){return parkRoadPoint((float)sample/PARK_ROAD_STEPS_PER_SEGMENT);};
  auto sampleNormal=[&](int sample){
    Vec2 before=samplePoint(std::max(0,sample-1)),after=samplePoint(std::min(PARK_ROAD_SAMPLE_COUNT-1,sample+1));
    float dx=after.x-before.x,dz=after.z-before.z,len=std::sqrt(dx*dx+dz*dz);
    return Vec2{-dz/std::max(len,.0001f),dx/std::max(len,.0001f)};
  };
  if(environmentTexture){glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,environmentTexture);}
  glColor3f(.92f,.92f,.92f);glBegin(GL_QUADS);
  for(int sample=0;sample+1<PARK_ROAD_SAMPLE_COUNT;++sample){
    Vec2 a=samplePoint(sample),b=samplePoint(sample+1),na=sampleNormal(sample),nb=sampleNormal(sample+1);
    glTexCoord2f(UV_ROAD.u0,UV_ROAD.v0);glVertex3f(a.x+na.x*PARK_ROAD_HALF,.026f,a.z+na.z*PARK_ROAD_HALF);
    glTexCoord2f(UV_ROAD.u1,UV_ROAD.v0);glVertex3f(a.x-na.x*PARK_ROAD_HALF,.026f,a.z-na.z*PARK_ROAD_HALF);
    glTexCoord2f(UV_ROAD.u1,UV_ROAD.v1);glVertex3f(b.x-nb.x*PARK_ROAD_HALF,.026f,b.z-nb.z*PARK_ROAD_HALF);
    glTexCoord2f(UV_ROAD.u0,UV_ROAD.v1);glVertex3f(b.x+nb.x*PARK_ROAD_HALF,.026f,b.z+nb.z*PARK_ROAD_HALF);
  }
  glEnd();if(environmentTexture)glDisable(GL_TEXTURE_2D);
  glColor3f(.94f,.70f,.18f);glLineWidth(2);glBegin(GL_LINES);
  for(int sample=0;sample+1<PARK_ROAD_SAMPLE_COUNT;sample+=2){Vec2 a=samplePoint(sample),b=samplePoint(sample+1);glVertex3f(a.x,.055f,a.z);glVertex3f(b.x,.055f,b.z);}glEnd();
  static const Vec2 trees[]={{168,92},{178,151},{235,91},{277,82}};
  for(int i=0;i<(int)(sizeof(trees)/sizeof(trees[0]));++i)
    drawTree(trees[i].x,trees[i].z,.78f+(i%3)*.12f);
  cube(244,.42f,155,3.0f,.22f,1.0f,.46f,.27f,.10f);cube(243,.18f,154,.16f,.7f,.16f,.18f,.18f,.18f);cube(245,.18f,156,.16f,.7f,.16f,.18f,.18f,.18f);
}

void drawRoadSegment(const CityRoadSegment&road,bool sidewalk){
  float dx=road.x1-road.x0,dz=road.z1-road.z0,length=std::sqrt(dx*dx+dz*dz);
  if(length<.01f)return;
  float normalX=-dz/length,normalZ=dx/length;int steps=std::max(1,(int)(length/12.0f));
  auto strip=[&](float half,const AtlasUv&uv,float yOffset){
    if(environmentTexture){glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,environmentTexture);}
    glColor3f(1,1,1);glBegin(GL_QUADS);
    for(int i=0;i<steps;++i){float t0=(float)i/steps,t1=(float)(i+1)/steps;
      float ax=road.x0+dx*t0,az=road.z0+dz*t0,bx=road.x0+dx*t1,bz=road.z0+dz*t1;
      // Sample the terrain at each road edge. Sampling only the centreline
      // let a hillside rise through one half of the asphalt.
      float alx=ax+normalX*half,alz=az+normalZ*half,arx=ax-normalX*half,arz=az-normalZ*half;
      float blx=bx+normalX*half,blz=bz+normalZ*half,brx=bx-normalX*half,brz=bz-normalZ*half;
      glTexCoord2f(uv.u0,uv.v0);glVertex3f(alx,cityGroundHeightAt(alx,alz)+yOffset,alz);
      glTexCoord2f(uv.u1,uv.v0);glVertex3f(arx,cityGroundHeightAt(arx,arz)+yOffset,arz);
      glTexCoord2f(uv.u1,uv.v1);glVertex3f(brx,cityGroundHeightAt(brx,brz)+yOffset,brz);
      glTexCoord2f(uv.u0,uv.v1);glVertex3f(blx,cityGroundHeightAt(blx,blz)+yOffset,blz);
    }glEnd();if(environmentTexture)glDisable(GL_TEXTURE_2D);
  };
  if(sidewalk){strip(road.halfWidth+2.3f,UV_SIDEWALK,.014f);return;}
  strip(road.halfWidth,UV_ROAD,.036f);
  if(road.halfWidth>3.0f){glColor3f(.94f,.70f,.18f);glLineWidth(2);glBegin(GL_LINES);
    for(int i=0;i<steps;++i){float t0=(float)i/steps,t1=(float)(i+1)/steps;
      float ax=road.x0+dx*t0,az=road.z0+dz*t0,bx=road.x0+dx*t1,bz=road.z0+dz*t1;
      glVertex3f(ax,cityGroundHeightAt(ax,az)+.07f,az);glVertex3f(bx,cityGroundHeightAt(bx,bz)+.07f,bz);
    }glEnd();}
}

void drawCurvedRoad(const Vec2*control,int count,float halfWidth,bool sidewalk){
  int samples=(count-1)*CURVED_ROAD_STEPS;
  auto point=[&](int sample){return curvedRoadPoint(control,count,(float)sample/CURVED_ROAD_STEPS);};
  auto normal=[&](int sample){Vec2 before=point(std::max(0,sample-1)),after=point(std::min(samples,sample+1));
    float dx=after.x-before.x,dz=after.z-before.z,length=std::sqrt(dx*dx+dz*dz);
    return Vec2{-dz/std::max(length,.001f),dx/std::max(length,.001f)};};
  float drawHalf=halfWidth+(sidewalk?2.3f:0.0f);const AtlasUv&uv=sidewalk?UV_SIDEWALK:UV_ROAD;
  if(environmentTexture){glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,environmentTexture);}
  glColor3f(1,1,1);glBegin(GL_QUADS);
  for(int sample=0;sample<samples;++sample){Vec2 a=point(sample),b=point(sample+1),na=normal(sample),nb=normal(sample+1);
    float yOffset=sidewalk?.014f:.042f;
    float alx=a.x+na.x*drawHalf,alz=a.z+na.z*drawHalf,arx=a.x-na.x*drawHalf,arz=a.z-na.z*drawHalf;
    float blx=b.x+nb.x*drawHalf,blz=b.z+nb.z*drawHalf,brx=b.x-nb.x*drawHalf,brz=b.z-nb.z*drawHalf;
    glTexCoord2f(uv.u0,uv.v0);glVertex3f(alx,cityGroundHeightAt(alx,alz)+yOffset,alz);
    glTexCoord2f(uv.u1,uv.v0);glVertex3f(arx,cityGroundHeightAt(arx,arz)+yOffset,arz);
    glTexCoord2f(uv.u1,uv.v1);glVertex3f(brx,cityGroundHeightAt(brx,brz)+yOffset,brz);
    glTexCoord2f(uv.u0,uv.v1);glVertex3f(blx,cityGroundHeightAt(blx,blz)+yOffset,blz);
  }glEnd();if(environmentTexture)glDisable(GL_TEXTURE_2D);
  if(!sidewalk){glColor3f(.94f,.70f,.18f);glLineWidth(2);glBegin(GL_LINES);
    for(int sample=0;sample<samples;sample+=2){Vec2 a=point(sample),b=point(std::min(samples,sample+1));
      glVertex3f(a.x,cityGroundHeightAt(a.x,a.z)+.075f,a.z);glVertex3f(b.x,cityGroundHeightAt(b.x,b.z)+.075f,b.z);
    }glEnd();}
}

void drawRoundabout(float centerX,float centerZ){
  constexpr int segments=36;float inner=ROUNDABOUT_RADIUS-ROUNDABOUT_HALF,outer=ROUNDABOUT_RADIUS+ROUNDABOUT_HALF;
  if(environmentTexture){glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,environmentTexture);}
  glColor3f(.92f,.92f,.92f);glBegin(GL_QUADS);
  for(int i=0;i<segments;++i){float a=i*2*PI/segments,b=(i+1)*2*PI/segments;
    glTexCoord2f(UV_ROAD.u0,UV_ROAD.v0);glVertex3f(centerX+std::sin(a)*inner,.032f,centerZ+std::cos(a)*inner);
    glTexCoord2f(UV_ROAD.u1,UV_ROAD.v0);glVertex3f(centerX+std::sin(a)*outer,.032f,centerZ+std::cos(a)*outer);
    glTexCoord2f(UV_ROAD.u1,UV_ROAD.v1);glVertex3f(centerX+std::sin(b)*outer,.032f,centerZ+std::cos(b)*outer);
    glTexCoord2f(UV_ROAD.u0,UV_ROAD.v1);glVertex3f(centerX+std::sin(b)*inner,.032f,centerZ+std::cos(b)*inner);
  }glEnd();if(environmentTexture)glDisable(GL_TEXTURE_2D);
  glColor3f(.16f,.42f,.12f);glBegin(GL_TRIANGLE_FAN);glVertex3f(centerX,.04f,centerZ);
  for(int i=0;i<=segments;++i){float a=i*2*PI/segments;glVertex3f(centerX+std::sin(a)*(inner-1),.04f,centerZ+std::cos(a)*(inner-1));}glEnd();
}

void drawHighway(){
  if(environmentTexture){glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,environmentTexture);}
  glColor3f(1,1,1);glBegin(GL_QUADS);
  for(int sample=0;sample<HIGHWAY_SAMPLE_COUNT;++sample){Vec2 a=highwayPoint((float)sample/HIGHWAY_STEPS_PER_SEGMENT);
    Vec2 b=highwayPoint((float)(sample+1)/HIGHWAY_STEPS_PER_SEGMENT);
    Vec2 before=highwayPoint((float)(sample-1)/HIGHWAY_STEPS_PER_SEGMENT),after=highwayPoint((float)(sample+2)/HIGHWAY_STEPS_PER_SEGMENT);
    float adx=b.x-before.x,adz=b.z-before.z,alen=std::sqrt(adx*adx+adz*adz);
    float bdx=after.x-a.x,bdz=after.z-a.z,blen=std::sqrt(bdx*bdx+bdz*bdz);
    float anx=-adz/std::max(alen,.001f),anz=adx/std::max(alen,.001f);
    float bnx=-bdz/std::max(blen,.001f),bnz=bdx/std::max(blen,.001f);
    // Per-vertex normals form a mitered deck, closing the visible seams at turns.
    glTexCoord2f(UV_ROAD.u0,UV_ROAD.v0);glVertex3f(a.x+anx*HIGHWAY_HALF,HIGHWAY_HEIGHT,a.z+anz*HIGHWAY_HALF);
    glTexCoord2f(UV_ROAD.u1,UV_ROAD.v0);glVertex3f(a.x-anx*HIGHWAY_HALF,HIGHWAY_HEIGHT,a.z-anz*HIGHWAY_HALF);
    glTexCoord2f(UV_ROAD.u1,UV_ROAD.v1);glVertex3f(b.x-bnx*HIGHWAY_HALF,HIGHWAY_HEIGHT,b.z-bnz*HIGHWAY_HALF);
    glTexCoord2f(UV_ROAD.u0,UV_ROAD.v1);glVertex3f(b.x+bnx*HIGHWAY_HALF,HIGHWAY_HEIGHT,b.z+bnz*HIGHWAY_HALF);
  }glEnd();if(environmentTexture)glDisable(GL_TEXTURE_2D);
  // Cache sparse supports on whichever shoulder has the most ground-road
  // clearance. Centerline pillars previously landed directly in traffic lanes.
  static Vec2 supports[24];static int supportCount=0;static bool supportsReady=false;
  if(!supportsReady){supportsReady=true;
    for(int sample=0;sample<HIGHWAY_SAMPLE_COUNT&&supportCount<24;sample+=10){
      Vec2 p=highwayPoint((float)sample/HIGHWAY_STEPS_PER_SEGMENT);
      Vec2 before=highwayPoint((float)(sample-1)/HIGHWAY_STEPS_PER_SEGMENT),after=highwayPoint((float)(sample+1)/HIGHWAY_STEPS_PER_SEGMENT);
      float dx=after.x-before.x,dz=after.z-before.z,len=std::sqrt(dx*dx+dz*dz),nx=-dz/std::max(len,.001f),nz=dx/std::max(len,.001f);
      Vec2 a{p.x+nx*(HIGHWAY_HALF-1.4f),p.z+nz*(HIGHWAY_HALF-1.4f)};
      Vec2 b{p.x-nx*(HIGHWAY_HALF-1.4f),p.z-nz*(HIGHWAY_HALF-1.4f)};
      float clearA=cityGroundRoadDistance(a.x,a.z),clearB=cityGroundRoadDistance(b.x,b.z);Vec2 chosen=clearA>clearB?a:b;
      if(std::max(clearA,clearB)>ROAD_HALF+3.2f)supports[supportCount++]=chosen;
    }
  }
  for(int i=0;i<supportCount;++i)cube(supports[i].x,HIGHWAY_HEIGHT*.5f,supports[i].z,1.4f,HIGHWAY_HEIGHT,1.4f,.52f,.53f,.54f);
  // Low visual guardrails keep the elevated loop readable. Leave both shoulders
  // open around each merge so no rail appears across an on-ramp's driveable path.
  glColor3f(.70f,.72f,.73f);glLineWidth(3.0f);glBegin(GL_LINES);
  for(int sample=0;sample<HIGHWAY_SAMPLE_COUNT;sample+=2){
    Vec2 a=highwayPoint((float)sample/HIGHWAY_STEPS_PER_SEGMENT),b=highwayPoint((float)(sample+2)/HIGHWAY_STEPS_PER_SEGMENT);
    float dx=b.x-a.x,dz=b.z-a.z,len=std::sqrt(dx*dx+dz*dz),nx=-dz/std::max(len,.001f),nz=dx/std::max(len,.001f);
    for(float side:{-1.0f,1.0f}){
      float ax=a.x+nx*(HIGHWAY_HALF-.55f)*side,az=a.z+nz*(HIGHWAY_HALF-.55f)*side;
      float bx=b.x+nx*(HIGHWAY_HALF-.55f)*side,bz=b.z+nz*(HIGHWAY_HALF-.55f)*side;
      bool merge=false;for(const HighwayRamp&ramp:HIGHWAY_RAMPS){float d=0;rampProgress((ax+bx)*.5f,(az+bz)*.5f,ramp,d);if(d<18.0f)merge=true;}
      if(!merge){glVertex3f(ax,HIGHWAY_HEIGHT+.72f,az);glVertex3f(bx,HIGHWAY_HEIGHT+.72f,bz);}
    }
  }glEnd();
  // usable beneath every other bridge span.
  // Textured driveable ramps are independent surfaces, so the ground remains
  for(const HighwayRamp&ramp:HIGHWAY_RAMPS){float dx=ramp.x1-ramp.x0,dz=ramp.z1-ramp.z0,length=std::sqrt(dx*dx+dz*dz);
    float nx=-dz/std::max(length,.001f)*8.0f,nz=dx/std::max(length,.001f)*8.0f;
    if(environmentTexture){glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,environmentTexture);}
    glColor3f(1,1,1);glBegin(GL_QUADS);constexpr int steps=12;
    for(int i=0;i<steps;++i){float t0=(float)i/steps,t1=(float)(i+1)/steps;
      float ax=ramp.x0+dx*t0,az=ramp.z0+dz*t0,bx=ramp.x0+dx*t1,bz=ramp.z0+dz*t1;
      glTexCoord2f(UV_ROAD.u0,UV_ROAD.v0);glVertex3f(ax+nx,HIGHWAY_HEIGHT*t0,az+nz);
      glTexCoord2f(UV_ROAD.u1,UV_ROAD.v0);glVertex3f(ax-nx,HIGHWAY_HEIGHT*t0,az-nz);
      glTexCoord2f(UV_ROAD.u1,UV_ROAD.v1);glVertex3f(bx-nx,HIGHWAY_HEIGHT*t1,bz-nz);
      glTexCoord2f(UV_ROAD.u0,UV_ROAD.v1);glVertex3f(bx+nx,HIGHWAY_HEIGHT*t1,bz+nz);
    }glEnd();if(environmentTexture)glDisable(GL_TEXTURE_2D);
  }
}

void drawHill(float centerX,float centerZ,float radius,float height){
  constexpr int rings=7,segments=24;
  if(environmentTexture){glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,environmentTexture);}
  glColor3f(1,1,1);glBegin(GL_QUADS);
  for(int ring=0;ring<rings;++ring){float r0=radius*ring/rings,r1=radius*(ring+1)/rings;
    float y0=hillHeight(centerX+r0,centerZ,centerX,centerZ,radius,height),y1=hillHeight(centerX+r1,centerZ,centerX,centerZ,radius,height);
    for(int i=0;i<segments;++i){float a=i*2*PI/segments,b=(i+1)*2*PI/segments;
      glTexCoord2f(UV_GRASS.u0,UV_GRASS.v0);glVertex3f(centerX+std::sin(a)*r0,y0,centerZ+std::cos(a)*r0);
      glTexCoord2f(UV_GRASS.u1,UV_GRASS.v0);glVertex3f(centerX+std::sin(a)*r1,y1,centerZ+std::cos(a)*r1);
      glTexCoord2f(UV_GRASS.u1,UV_GRASS.v1);glVertex3f(centerX+std::sin(b)*r1,y1,centerZ+std::cos(b)*r1);
      glTexCoord2f(UV_GRASS.u0,UV_GRASS.v1);glVertex3f(centerX+std::sin(b)*r0,y0,centerZ+std::cos(b)*r0);
    }
  }glEnd();if(environmentTexture)glDisable(GL_TEXTURE_2D);
}

void drawPond(float x,float z,float radiusX,float radiusZ){
  // Fixed water table is deliberately below the surrounding excavated hill terrain.
  const float waterY=-.72f;
  glColor3f(.18f,.13f,.075f);glBegin(GL_TRIANGLE_FAN);glVertex3f(x,waterY-.10f,z);
  for(int i=0;i<=32;++i){float a=i*2*PI/32;glVertex3f(x+std::sin(a)*(radiusX+2.0f),waterY-.10f,z+std::cos(a)*(radiusZ+2.0f));}glEnd();
  glEnable(GL_BLEND);glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);glColor4f(.06f,.32f,.55f,.86f);glBegin(GL_TRIANGLE_FAN);glVertex3f(x,waterY,z);
  for(int i=0;i<=32;++i){float a=i*2*PI/32;glVertex3f(x+std::sin(a)*radiusX,waterY,z+std::cos(a)*radiusZ);}glEnd();glDisable(GL_BLEND);
}

void drawIndustrialObstacle(const IndustrialObstacle&obstacle){
  texturedCube(obstacle.x,obstacle.height*.5f,obstacle.z,obstacle.width,obstacle.height,obstacle.depth,
               UV_METAL,obstacle.r,obstacle.g,obstacle.b);
  cube(obstacle.x,obstacle.height+.04f,obstacle.z,obstacle.width*.96f,.08f,obstacle.depth*.96f,
       obstacle.r*.72f,obstacle.g*.72f,obstacle.b*.72f);
}


void resetSandboxLife();
void initSandboxLife();
void updateTraffic(float dt);
void updatePedestrians(float dt);
void updateSandboxVehicles(float dt,const SceCtrlData&pad,uint32_t pressed);
void updateDynamicParked(float dt);
void drawTraffic();
void drawPedestrians();
void drawSandboxVehicles();
void drawDynamicParked();
void drawChaosHud();
bool tryEnterNearbySandboxVehicle();
void exitToOnFootFromVehicle();
float vehicleTopSpeed(SandboxVehicleKind k);
float vehicleAccel(SandboxVehicleKind k);
void damageDynamicParkedAt(float x,float z,float radius,float force,bool explosive);
void damageSandboxVehicleAt(float x,float z,float radius,float force,bool explosive);
void maybeCollapseBuilding(int buildingIndex,float hitX,float hitY,float hitZ);
int buildingDestroyedPanelCount(int buildingIndex);

float vehicleTopSpeed(SandboxVehicleKind k){
  switch(k){
    case SandboxVehicleKind::Motorcycle: return 78.0f;
    case SandboxVehicleKind::Truck: return 42.0f;
    case SandboxVehicleKind::Boat: return 34.0f;
    case SandboxVehicleKind::Buggy: return 58.0f;
    default: return 65.0f;
  }
}
float vehicleAccel(SandboxVehicleKind k){
  switch(k){
    case SandboxVehicleKind::Motorcycle: return 58.0f;
    case SandboxVehicleKind::Truck: return 28.0f;
    case SandboxVehicleKind::Boat: return 22.0f;
    case SandboxVehicleKind::Buggy: return 48.0f;
    default: return 43.0f;
  }
}

int buildingDestroyedPanelCount(int buildingIndex){
  if(buildingIndex<0||buildingIndex>=CITY_BUILDING_COUNT)return 0;
  uint64_t mask=buildingDamage[buildingIndex];int count=0;
  while(mask){count+=int(mask&1ULL);mask>>=1;}
  return count;
}

void maybeCollapseBuilding(int buildingIndex,float hitX,float hitY,float hitZ){
  if(buildingIndex<0||buildingIndex>=CITY_BUILDING_COUNT-1)return;
  if(buildingCollapsed[buildingIndex])return;
  int destroyed=buildingDestroyedPanelCount(buildingIndex);
  // 4 sides * 4 * 4 = 64 panels. Collapse once roughly half the facade is gone.
  if(destroyed<28)return;
  buildingCollapsed[buildingIndex]=true;
  buildingCollapse[buildingIndex]=0.01f;
  const CityBuilding&b=CITY_BUILDINGS[buildingIndex];
  spawnExplosion(b.x,b.height*.45f,b.z);
  spawnExplosion(b.x+b.width*.25f,b.height*.3f,b.z);
  spawnBuildingDebris(buildingIndex,hitX>0?hitX:b.x,hitY>0?hitY:b.height*.4f,hitZ>0?hitZ:b.z,0);
  spawnBuildingDebris(buildingIndex,b.x,b.height*.55f,b.z,1);
  blastCityProps(b.x,b.z,14.0f,42.0f);
  blastPlayerCar(b.x,b.z,16.0f,28.0f,10.0f);
  addChaos(120.0f);
}

void resetSandboxLife(){
  std::memset(trafficCars,0,sizeof(trafficCars));
  std::memset(pedestrians,0,sizeof(pedestrians));
  std::memset(sandboxVehicles,0,sizeof(sandboxVehicles));
  std::memset(dynamicParked,0,sizeof(dynamicParked));
  std::memset(buildingCollapse,0,sizeof(buildingCollapse));
  std::memset(buildingCollapsed,0,sizeof(buildingCollapsed));
  chaosScore=0;chaosCombo=1.0f;chaosDecay=0;sandboxLifeInitialized=false;
  activeVehicleKind=SandboxVehicleKind::Car;occupiedSandboxVehicle=-1;
  aimRecoil=walkBob=shootShake=0;
}

void initSandboxLife(){
  if(sandboxLifeInitialized)return;
  // Traffic loops on the main grid roads.
  static const float roadCenters[]={-110.f,-55.f,0.f,55.f,110.f};
  static const float palette[][3]={
    {.16f,.28f,.62f},{.72f,.18f,.10f},{.15f,.56f,.30f},{.74f,.62f,.16f},
    {.54f,.18f,.62f},{.12f,.62f,.66f},{.76f,.30f,.12f},{.68f,.70f,.72f},
    {.90f,.48f,.08f},{.20f,.22f,.28f},{.42f,.72f,.88f},{.88f,.88f,.20f}
  };
  for(int i=0;i<MAX_TRAFFIC;++i){
    TrafficCar&t=trafficCars[i];
    t.active=true;t.pathId=i%5;t.style=i%4;t.laneOffset=(i&1)?1.8f:-1.8f;
    t.pathT=(i*73)%280-140.0f;t.speed=11.0f+(i%5)*1.7f;t.honked=false;
    t.health=100.0f;t.vx=t.vz=t.yawRate=t.smoke=t.wreckTimer=t.flip=0.0f;t.wrecked=t.flipped=false;
    int c=i%12;t.r=palette[c][0];t.g=palette[c][1];t.b=palette[c][2];
    bool northSouth=i%2==0;
    if(northSouth){t.x=roadCenters[t.pathId]+t.laneOffset;t.z=t.pathT;t.yaw=(t.laneOffset>0)?0.0f:PI;}
    else{t.z=roadCenters[t.pathId]+t.laneOffset;t.x=t.pathT;t.yaw=(t.laneOffset>0)?(PI*.5f):(-PI*.5f);}
  }
  // Pedestrians near sidewalks / park edges.
  static const float pedSpawns[][4]={
    {-120,18,1.4f,0},{-95,-20,1.2f,PI*.5f},{18,-95,1.5f,PI},{95,22,1.3f,-PI*.5f},
    {-280,-48,1.1f,0},{-250,40,1.35f,PI},{240,-40,1.25f,PI*.5f},{310,55,1.15f,-PI*.5f},
    {140,130,1.2f,PI},{ -140,130,1.3f,0}
  };
  for(int i=0;i<MAX_PEDESTRIANS;++i){
    Pedestrian&p=pedestrians[i];
    p.active=true;p.x=pedSpawns[i][0];p.z=pedSpawns[i][1];p.speed=pedSpawns[i][2];
    p.yaw=pedSpawns[i][3];p.phase=i*1.7f;p.wait=0;p.crossing=false;
    p.targetX=p.x+std::sin(p.yaw)*18.0f;p.targetZ=p.z+std::cos(p.yaw)*18.0f;
    int c=(i*3)%12;p.r=.35f+palette[c][0]*.4f;p.g=.28f+palette[c][1]*.35f;p.b=.22f+palette[c][2]*.3f;
  }
  // Dynamic parked cars replace static props for destruction payoff.
  for(int i=0;i<PARKED_CAR_COUNT&&i<MAX_DYNAMIC_PARKED;++i){
    const ParkedCar&src=PARKED_CARS[i];DynamicParked&d=dynamicParked[i];
    d.active=true;d.knocked=false;d.exploded=false;d.flipped=false;
    d.x=d.spawnX=src.x;d.z=d.spawnZ=src.z;d.yaw=d.spawnYaw=src.yaw*PI/180.0f;
    d.r=src.r;d.g=src.g;d.b=src.b;d.health=100.0f;d.vx=d.vz=d.yawRate=d.flip=d.respawn=d.smoke=0;
  }
  // Extra sandbox toys around the city.
  struct Spawn {float x,z,yaw;SandboxVehicleKind k;float r,g,b;};
  static const Spawn spawns[]={
    {-100,-140,0,SandboxVehicleKind::Motorcycle,.08f,.08f,.10f},
    {-70,-145,PI*.5f,SandboxVehicleKind::Buggy,.82f,.42f,.08f},
    {80,-140,0,SandboxVehicleKind::Truck,.20f,.28f,.18f},
    {-275,200,0,SandboxVehicleKind::Boat,.12f,.42f,.68f},
    {286,200,PI,SandboxVehicleKind::Boat,.10f,.48f,.62f},
    {470,150,0,SandboxVehicleKind::Buggy,.70f,.18f,.12f},
    {200,-80,PI*.25f,SandboxVehicleKind::Motorcycle,.90f,.80f,.12f},
    {-200,80,-PI*.4f,SandboxVehicleKind::Truck,.55f,.55f,.58f},
    {320,20,PI,SandboxVehicleKind::Car,.15f,.45f,.85f},
    {-40,100,0,SandboxVehicleKind::Motorcycle,.75f,.12f,.55f},
  };
  for(int i=0;i<MAX_SANDBOX_VEHICLES;++i){
    SandboxVehicle&v=sandboxVehicles[i];const Spawn&s=spawns[i];
    v.active=true;v.occupied=false;v.flipped=false;v.exploded=false;
    v.x=v.spawnX=s.x;v.z=v.spawnZ=s.z;v.yaw=v.spawnYaw=s.yaw;v.y=0;
    v.kind=s.k;v.r=s.r;v.g=s.g;v.b=s.b;v.health=100.0f;
    v.vx=v.vz=v.yawRate=v.flip=v.respawn=0;
  }
  sandboxLifeInitialized=true;
}

void updateTraffic(float dt){
  if(driveEnvironment!=DriveEnvironment::City)return;
  if(!sandboxLifeInitialized)initSandboxLife();
  static const float roadCenters[]={-110.f,-55.f,0.f,55.f,110.f};
  float playerX=playerControlMode==PlayerControlMode::OnFoot?person.x:(playerControlMode==PlayerControlMode::Aircraft?plane.x:car.x);
  float playerZ=playerControlMode==PlayerControlMode::OnFoot?person.z:(playerControlMode==PlayerControlMode::Aircraft?plane.z:car.z);
  for(int i=0;i<MAX_TRAFFIC;++i){
    TrafficCar&t=trafficCars[i];if(!t.active)continue;
    if(t.wrecked){
      t.x+=t.vx*dt;t.z+=t.vz*dt;t.yaw+=t.yawRate*dt;
      float damp=std::pow(.958f,dt*60.0f);t.vx*=damp;t.vz*=damp;t.yawRate*=damp;
      t.smoke=std::max(0.0f,t.smoke-dt*.07f);if(t.flipped)t.flip=clampf(t.flip+dt*2.8f,0.0f,1.0f);
      t.wreckTimer+=dt;if(t.wreckTimer>12.0f){t.active=false;}continue;
    }
    bool northSouth=(i%2)==0;
    float dir=t.laneOffset>0?1.0f:-1.0f;
    // Slow near player for readable near-misses.
    float dx=t.x-playerX,dz=t.z-playerZ,dist2=dx*dx+dz*dz;
    float speed=t.speed*(dist2<100.0f?.45f:(dist2<400.0f?.72f:1.0f));
    if(northSouth){
      t.z+=dir*speed*dt;
      if(t.z>155.0f){t.z=-155.0f;}
      if(t.z<-155.0f){t.z=155.0f;}
      t.x=roadCenters[t.pathId]+t.laneOffset;
      t.yaw=dir>0?0.0f:PI;
    }else{
      t.x+=dir*speed*dt;
      if(t.x>155.0f){t.x=-155.0f;}
      if(t.x<-155.0f){t.x=155.0f;}
      t.z=roadCenters[t.pathId]+t.laneOffset;
      t.yaw=dir>0?(PI*.5f):(-PI*.5f);
    }
    // Player car bump.
    if(playerControlMode==PlayerControlMode::Vehicle){
      float cdx=t.x-car.x,cdz=t.z-car.z;float d2=cdx*cdx+cdz*cdz;
      if(d2<3.2f*3.2f){
        float d=std::sqrt(std::max(d2,.001f)),nx=cdx/d,nz=cdz/d;
        float impact=std::sqrt(car.vx*car.vx+car.vz*car.vz);
        car.vx-=nx*impact*.18f;car.vz-=nz*impact*.18f;
        if(impact>12.0f&&damageCooldown<=0){
          carDamage=clampf(carDamage+(impact-10.0f)*.35f,0,100);
          damageCooldown=.35f;addChaos(8.0f+impact*.4f);
        }
        t.z+=nz*1.2f;t.x+=nx*1.2f;
      }
    }
  }
}

void updatePedestrians(float dt){
  if(driveEnvironment!=DriveEnvironment::City)return;
  if(!sandboxLifeInitialized)initSandboxLife();
  float playerX=playerControlMode==PlayerControlMode::OnFoot?person.x:car.x;
  float playerZ=playerControlMode==PlayerControlMode::OnFoot?person.z:car.z;
  for(int i=0;i<MAX_PEDESTRIANS;++i){
    Pedestrian&p=pedestrians[i];if(!p.active)continue;
    if(p.wait>0){p.wait-=dt;continue;}
    float dx=p.targetX-p.x,dz=p.targetZ-p.z,dist=std::sqrt(dx*dx+dz*dz);
    if(dist<1.2f){
      // Pick a new sidewalk wander target.
      float ang=(i*1.7f+p.phase)*.9f;
      p.targetX=p.x+std::sin(ang)*14.0f+((i%3)-1)*6.0f;
      p.targetZ=p.z+std::cos(ang)*14.0f+((i%5)-2)*5.0f;
      p.targetX=clampf(p.targetX,-340.0f,520.0f);p.targetZ=clampf(p.targetZ,-170.0f,230.0f);
      p.wait=.2f+(i%4)*.15f;continue;
    }
    dx/=dist;dz/=dist;p.yaw=std::atan2(dx,dz);
    // Flee from speeding player car.
    float pdx=p.x-playerX,pdz=p.z-playerZ,pd2=pdx*pdx+pdz*pdz;
    float flee=0.0f;
    if(playerControlMode==PlayerControlMode::Vehicle&&pd2<70.0f){
      float spd=std::sqrt(car.vx*car.vx+car.vz*car.vz);
      if(spd>10.0f){flee=1.0f;float inv=1.0f/std::sqrt(std::max(pd2,.01f));dx=pdx*inv;dz=pdz*inv;p.yaw=std::atan2(dx,dz);}
    }
    float speed=p.speed*(flee>0?2.4f:1.0f);
    p.x+=dx*speed*dt;p.z+=dz*speed*dt;p.phase+=dt*speed*3.1f;
    // Ragdoll-lite if hit by car.
    if(playerControlMode==PlayerControlMode::Vehicle&&pd2<1.6f*1.6f){
      float spd=std::sqrt(car.vx*car.vx+car.vz*car.vz);
      if(spd>7.0f){
        p.x+=car.vx*.08f;p.z+=car.vz*.08f;p.wait=1.4f;addChaos(14.0f+spd*.5f);
        // brief scatter
        p.targetX=p.x+((i&1)?12.f:-12.f);p.targetZ=p.z+((i&2)?10.f:-10.f);
      }
    }
  }
}

void damageTrafficAt(float x,float z,float radius,float force,bool explosive){
  for(int i=0;i<MAX_TRAFFIC;++i){
    TrafficCar&t=trafficCars[i];if(!t.active||t.wrecked)continue;
    float dx=t.x-x,dz=t.z-z,dist=std::sqrt(dx*dx+dz*dz);if(dist>radius)continue;
    float falloff=1.0f-dist/std::max(radius,.01f),inv=1.0f/std::max(dist,.05f),impulse=force*falloff;
    t.health-=explosive?62.0f*falloff:16.0f*falloff;t.vx+=dx*inv*impulse;t.vz+=dz*inv*impulse;
    t.yawRate+=(dx*inv-dz*inv)*impulse*.09f;t.smoke=std::max(t.smoke,explosive?.9f:.34f);
    if(t.health<=0.0f){t.health=0;t.wrecked=true;t.flipped=explosive||impulse>15.0f;t.flip=t.flipped?.04f:0.0f;t.wreckTimer=0;spawnExplosion(t.x,cityGroundHeightAt(t.x,t.z)+.8f,t.z);addChaos(48.0f);}
    else {if(impulse>15.0f){t.flipped=true;t.flip=std::max(t.flip,.02f);}addChaos(5.0f+8.0f*falloff);}
  }
}

void damageDynamicParkedAt(float x,float z,float radius,float force,bool explosive){
  for(int i=0;i<MAX_DYNAMIC_PARKED;++i){
    DynamicParked&d=dynamicParked[i];if(!d.active||d.exploded)continue;
    float dx=d.x-x,dz=d.z-z,dist=std::sqrt(dx*dx+dz*dz);
    if(dist>radius)continue;
    float falloff=1.0f-dist/std::max(radius,.01f);
    float impulse=force*falloff;
    float inv=1.0f/std::max(dist,.05f);
    d.knocked=true;d.vx+=dx*inv*impulse;d.vz+=dz*inv*impulse;
    d.yawRate+=(dx*inv-dz*inv)*impulse*.08f;
    d.health-=explosive?55.0f*falloff:18.0f*falloff;
    d.smoke=std::max(d.smoke,explosive?.8f:.35f);
    if(d.health<=0.0f&&!d.exploded){
      d.exploded=true;d.flipped=true;d.flip=0.05f;d.health=0;
      spawnExplosion(d.x,1.0f,d.z);addChaos(45.0f);
      blastCityProps(d.x,d.z,7.0f,22.0f);
    }else if(impulse>14.0f){d.flipped=true;d.flip=std::max(d.flip,.02f);addChaos(10.0f*falloff);}
  }
}

void damageSandboxVehicleAt(float x,float z,float radius,float force,bool explosive){
  for(int i=0;i<MAX_SANDBOX_VEHICLES;++i){
    SandboxVehicle&v=sandboxVehicles[i];if(!v.active||v.exploded||v.occupied)continue;
    float dx=v.x-x,dz=v.z-z,dist=std::sqrt(dx*dx+dz*dz);
    if(dist>radius)continue;
    float falloff=1.0f-dist/std::max(radius,.01f);
    float inv=1.0f/std::max(dist,.05f);
    v.vx+=dx*inv*force*falloff;v.vz+=dz*inv*force*falloff;
    v.health-=explosive?60.0f*falloff:20.0f*falloff;
    if(v.health<=0){v.exploded=true;v.flipped=true;v.flip=.05f;spawnExplosion(v.x,1.1f,v.z);addChaos(55.0f);}
  }
}

void updateDynamicParked(float dt){
  if(driveEnvironment!=DriveEnvironment::City)return;
  if(!sandboxLifeInitialized)initSandboxLife();
  for(int i=0;i<MAX_DYNAMIC_PARKED;++i){
    DynamicParked&d=dynamicParked[i];
    if(!d.active){
      d.respawn-=dt;if(d.respawn<=0){
        d.active=true;d.knocked=d.exploded=d.flipped=false;
        d.x=d.spawnX;d.z=d.spawnZ;d.yaw=d.spawnYaw;d.health=100;d.vx=d.vz=d.yawRate=d.flip=d.smoke=0;
      }
      continue;
    }
    // Car ram.
    if(playerControlMode==PlayerControlMode::Vehicle){
      float dx=d.x-car.x,dz=d.z-car.z,d2=dx*dx+dz*dz;
      if(d2<2.8f*2.8f){
        float spd=std::sqrt(car.vx*car.vx+car.vz*car.vz);
        if(spd>6.0f){
          float inv=1.0f/std::sqrt(std::max(d2,.001f));
          d.knocked=true;d.vx+=car.vx*.55f+dx*inv*spd*.25f;d.vz+=car.vz*.55f+dz*inv*spd*.25f;
          d.yawRate+=(dx*inv*car.vz-dz*inv*car.vx)*.08f;
          d.health-=spd*1.1f;d.smoke=std::max(d.smoke,.4f);
          car.vx*=.88f;car.vz*=.88f;addChaos(6.0f+spd*.35f);
          if(d.health<=0&&!d.exploded){d.exploded=true;d.flipped=true;d.flip=.05f;spawnExplosion(d.x,1.0f,d.z);addChaos(40.0f);}
          else if(spd>16.0f){d.flipped=true;d.flip=std::max(d.flip,.02f);}
        }
      }
    }
    if(!d.knocked&&!d.exploded)continue;
    d.x+=d.vx*dt;d.z+=d.vz*dt;d.yaw+=d.yawRate*dt;
    float damp=std::pow(.965f,dt*60.0f);d.vx*=damp;d.vz*=damp;d.yawRate*=damp;
    if(d.flipped){d.flip=clampf(d.flip+dt*2.8f,0.0f,1.0f);}
    if(d.smoke>0)d.smoke=std::max(0.0f,d.smoke-dt*.12f);
    if(d.exploded){
      d.respawn+=dt; // reuse as timer after explode
      if(d.respawn>5.5f){d.active=false;d.respawn=8.0f;}
    }else if(std::fabs(d.vx)+std::fabs(d.vz)<.15f&&d.knocked){
      // stay wrecked longer than old props
      d.respawn+=dt;
      if(d.respawn>12.0f){d.active=false;d.respawn=4.0f;}
    }
  }
}

bool tryEnterNearbySandboxVehicle(){
  int best=-1;float bestD=3.6f;
  for(int i=0;i<MAX_SANDBOX_VEHICLES;++i){
    SandboxVehicle&v=sandboxVehicles[i];if(!v.active||v.occupied||v.exploded)continue;
    float dx=v.x-person.x,dz=v.z-person.z,d=std::sqrt(dx*dx+dz*dz);
    if(d<bestD){bestD=d;best=i;}
  }
  // Also allow re-entering the abandoned player car via existing enterVehicle.
  if(best<0)return false;
  SandboxVehicle&v=sandboxVehicles[best];
  v.occupied=true;occupiedSandboxVehicle=best;activeVehicleKind=v.kind;
  car.x=v.x;car.z=v.z;car.yaw=v.yaw;car.vx=v.vx;car.vz=v.vz;car.yawRate=0;car.steerAngle=0;
  carGroundHeight=cityGroundHeightAt(car.x,car.z);
  // Boats sit in pond water slightly lower.
  if(v.kind==SandboxVehicleKind::Boat)carGroundHeight=std::max(0.02f,carGroundHeight-.15f);
  playerControlMode=PlayerControlMode::Vehicle;cameraYaw=car.yaw;cameraOrbit=0;cameraMode=0;cameraDistanceScale=1.0f;
  return true;
}

void exitToOnFootFromVehicle(){
  if(occupiedSandboxVehicle>=0&&occupiedSandboxVehicle<MAX_SANDBOX_VEHICLES){
    SandboxVehicle&v=sandboxVehicles[occupiedSandboxVehicle];
    v.x=car.x;v.z=car.z;v.yaw=car.yaw;v.vx=car.vx;v.vz=car.vz;v.occupied=false;v.y=carGroundHeight;
  }
  occupiedSandboxVehicle=-1;activeVehicleKind=SandboxVehicleKind::Car;
  exitVehicle();
}

void updateSandboxVehicles(float dt,const SceCtrlData&pad,uint32_t pressed){
  if(driveEnvironment!=DriveEnvironment::City)return;
  if(!sandboxLifeInitialized)initSandboxLife();
  // Unoccupied bodies coast / settle.
  for(int i=0;i<MAX_SANDBOX_VEHICLES;++i){
    SandboxVehicle&v=sandboxVehicles[i];
    if(!v.active){
      v.respawn-=dt;if(v.respawn<=0){
        v.active=true;v.exploded=v.flipped=v.occupied=false;v.health=100;
        v.x=v.spawnX;v.z=v.spawnZ;v.yaw=v.spawnYaw;v.vx=v.vz=v.yawRate=v.flip=0;
      }
      continue;
    }
    if(v.occupied)continue;
    if(std::fabs(v.vx)+std::fabs(v.vz)>.02f){
      v.x+=v.vx*dt;v.z+=v.vz*dt;v.yaw+=v.yawRate*dt;
      float damp=std::pow(.97f,dt*60.0f);v.vx*=damp;v.vz*=damp;v.yawRate*=damp;
    }
    if(v.flipped)v.flip=clampf(v.flip+dt*2.2f,0.0f,1.0f);
    if(v.exploded){v.respawn+=dt;if(v.respawn>6.0f){v.active=false;v.respawn=7.0f;}}
    // Keep boats near pond surface height.
    if(v.kind==SandboxVehicleKind::Boat){
      float pond1x=-275,pond1z=208,pond2x=286,pond2z=210;
      float d1=(v.x-pond1x)*(v.x-pond1x)+(v.z-pond1z)*(v.z-pond1z);
      float d2=(v.x-pond2x)*(v.x-pond2x)+(v.z-pond2z)*(v.z-pond2z);
      // Soft pull back if drifted too far from water.
      if(d1>35.0f*35.0f&&d2>38.0f*38.0f){
        float tx=d1<d2?pond1x:pond2x,tz=d1<d2?pond1z:pond2z;
        v.vx+=(tx-v.x)*.02f;v.vz+=(tz-v.z)*.02f;
      }
    }
  }
  // If player is driving a sandbox vehicle, retune handling lightly and sync body.
  if(playerControlMode==PlayerControlMode::Vehicle&&occupiedSandboxVehicle>=0){
    SandboxVehicle&v=sandboxVehicles[occupiedSandboxVehicle];
    v.x=car.x;v.z=car.z;v.yaw=car.yaw;v.vx=car.vx;v.vz=car.vz;
    // Soft speed caps / accel feel by kind (applied as velocity clamp).
    float fx=std::sin(car.yaw),fz=std::cos(car.yaw);
    float forward=car.vx*fx+car.vz*fz;
    float top=vehicleTopSpeed(v.kind);
    if(forward>top){car.vx-=fx*(forward-top);car.vz-=fz*(forward-top);}
    if(v.kind==SandboxVehicleKind::Boat){
      // Boats prefer water; heavy drag on land.
      float pond1x=-275,pond1z=208,pond2x=286,pond2z=210;
      float d1=(car.x-pond1x)*(car.x-pond1x)+(car.z-pond1z)*(car.z-pond1z);
      float d2=(car.x-pond2x)*(car.x-pond2x)+(car.z-pond2z)*(car.z-pond2z);
      bool inWater=d1<30.0f*30.0f||d2<33.0f*33.0f;
      if(!inWater){car.vx*=std::pow(.90f,dt*60);car.vz*=std::pow(.90f,dt*60);}
      else{car.vx*=std::pow(.994f,dt*60);car.vz*=std::pow(.994f,dt*60);}
    }else if(v.kind==SandboxVehicleKind::Buggy||v.kind==SandboxVehicleKind::Motorcycle){
      // These two light vehicles are deliberately planted/agile; the primary car
      // remains untouched and the truck keeps its loose drift calibration.
      float lateral=car.vx*std::cos(car.yaw)-car.vz*std::sin(car.yaw);
      float grip=v.kind==SandboxVehicleKind::Buggy?.72f:.82f;
      car.vx-=std::cos(car.yaw)*lateral*grip*clampf(dt*8.0f,0.0f,1.0f);
      car.vz+=std::sin(car.yaw)*lateral*grip*clampf(dt*8.0f,0.0f,1.0f);
      car.yawRate*=v.kind==SandboxVehicleKind::Buggy?.88f:.80f;
      car.steerAngle*=v.kind==SandboxVehicleKind::Buggy?1.08f:1.14f;
    }else if(v.kind==SandboxVehicleKind::Truck){
      car.vx*=std::pow(.997f,dt*60);car.vz*=std::pow(.997f,dt*60);
    }
  }
  (void)pad;(void)pressed;
}

void drawTrafficCarMesh(float r,float g,float b,int style){
  if(style==3){
    // boxy truck
    cube(0,0,0,2.1f,.85f,4.4f,r,g,b);cube(0,.95f,-.55f,1.9f,1.1f,2.4f,r*.85f,g*.85f,b*.85f);
    cube(0,.55f,1.35f,1.85f,.9f,1.5f,.08f,.10f,.12f);
    for(float x:{-1.05f,1.05f})for(float z:{-1.45f,1.35f})cube(x,-.35f,z,.38f,.55f,.55f,.04f,.04f,.045f);
  }else{
    cube(0,0,0,1.75f,.55f,3.45f,r,g,b);cube(0,.48f,-.15f,1.42f,.62f,1.65f,.08f,.14f,.18f);
    for(float x:{-.92f,.92f})for(float z:{-1.15f,1.15f})cube(x,-.23f,z,.30f,.58f,.58f,.035f,.038f,.042f);
  }
}

void drawTraffic(){
  if(driveEnvironment!=DriveEnvironment::City||!sandboxLifeInitialized)return;
  float focusX=playerControlMode==PlayerControlMode::OnFoot?person.x:(playerControlMode==PlayerControlMode::Aircraft?plane.x:car.x);
  float focusZ=playerControlMode==PlayerControlMode::OnFoot?person.z:(playerControlMode==PlayerControlMode::Aircraft?plane.z:car.z);
  for(int i=0;i<MAX_TRAFFIC;++i){
    const TrafficCar&t=trafficCars[i];if(!t.active)continue;
    float dx=t.x-focusX,dz=t.z-focusZ;if(dx*dx+dz*dz>210.0f*210.0f)continue;
    float y=cityGroundHeightAt(t.x,t.z);
    glPushMatrix();glTranslatef(t.x,y+.46f,t.z);glRotatef(t.yaw*180.0f/PI,0,1,0);
    float dim=t.wrecked?.32f:(1.0f-t.smoke*.28f);drawTrafficCarMesh(t.r*dim,t.g*dim,t.b*dim,t.style);
    if(t.smoke>.05f)cube(0,.85f,-.15f,.55f+t.smoke,.45f+t.smoke,.65f+t.smoke,.12f,.12f,.12f);
    if(t.wrecked){cube(0,.18f,.9f,1.15f,.14f,.82f,.10f,.035f,.018f);cube(.42f,.34f,-.55f,.5f,.20f,.6f,.08f,.03f,.015f);}glPopMatrix();
  }
}

void drawPedestrians(){
  if(driveEnvironment!=DriveEnvironment::City||!sandboxLifeInitialized)return;
  float focusX=playerControlMode==PlayerControlMode::OnFoot?person.x:car.x;
  float focusZ=playerControlMode==PlayerControlMode::OnFoot?person.z:car.z;
  for(int i=0;i<MAX_PEDESTRIANS;++i){
    const Pedestrian&p=pedestrians[i];if(!p.active)continue;
    float dx=p.x-focusX,dz=p.z-focusZ;if(dx*dx+dz*dz>160.0f*160.0f)continue;
    float y=cityGroundHeightAt(p.x,p.z);
    float stride=std::sin(p.phase)*.18f;
    glPushMatrix();glTranslatef(p.x,y,p.z);glRotatef(p.yaw*180.0f/PI,0,1,0);
    // Slimmer civilian silhouette.
    cube(0,1.15f,0,.42f,.78f,.28f,p.r,p.g,p.b);
    cube(0,1.72f,0,.36f,.36f,.36f,.62f,.44f,.32f);
    cube(-.28f,1.15f,stride,.12f,.62f,.14f,.62f,.44f,.32f);
    cube(.28f,1.15f,-stride,.12f,.62f,.14f,.62f,.44f,.32f);
    cube(-.12f,.48f,-stride,.16f,.82f,.18f,.12f,.14f,.18f);
    cube(.12f,.48f,stride,.16f,.82f,.18f,.12f,.14f,.18f);
    glPopMatrix();
  }
}

void drawSandboxVehicleMesh(const SandboxVehicle&v){
  switch(v.kind){
    case SandboxVehicleKind::Motorcycle:
      cube(0,.15f,0,.42f,.28f,1.85f,v.r,v.g,v.b);
      cube(0,.48f,-.15f,.30f,.35f,.55f,.08f,.08f,.09f);
      cube(0,.55f,.35f,.18f,.45f,.18f,.10f,.10f,.11f);
      cube(0,.05f,0.85f,.55f,.55f,.18f,.04f,.04f,.045f);
      cube(0,.05f,-0.85f,.55f,.55f,.18f,.04f,.04f,.045f);
      cube(.22f,.42f,.10f,.08f,.08f,.55f,.7f,.7f,.72f);
      break;
    case SandboxVehicleKind::Truck:
      cube(0,0,0,2.2f,.9f,4.6f,v.r,v.g,v.b);
      cube(0,1.05f,-.7f,2.0f,1.25f,2.5f,v.r*.88f,v.g*.88f,v.b*.88f);
      cube(0,.6f,1.45f,1.95f,1.0f,1.55f,.1f,.12f,.14f);
      for(float x:{-1.1f,1.1f})for(float z:{-1.5f,1.4f})cube(x,-.38f,z,.4f,.6f,.6f,.04f,.04f,.045f);
      break;
    case SandboxVehicleKind::Boat:
      cube(0,.05f,0,1.55f,.35f,3.8f,v.r,v.g,v.b);
      cube(0,.35f,-.2f,1.15f,.45f,2.0f,v.r*1.1f,v.g*1.05f,v.b*.9f);
      cube(0,.55f,.9f,.9f,.35f,1.0f,.85f,.88f,.9f);
      cube(0,.15f,1.7f,.55f,.2f,.55f,.08f,.1f,.12f);
      break;
    case SandboxVehicleKind::Buggy:
      cube(0,.05f,0,1.85f,.45f,2.9f,v.r,v.g,v.b);
      cube(0,.55f,-.1f,1.35f,.55f,1.4f,.12f,.14f,.1f);
      cube(0,.35f,1.0f,1.6f,.25f,.8f,v.r*.9f,v.g*.9f,v.b*.9f);
      for(float x:{-1.05f,1.05f})for(float z:{-1.05f,1.05f})cube(x,-.1f,z,.48f,.7f,.48f,.05f,.05f,.055f);
      cube(0,.85f,-.2f,.08f,.55f,1.5f,.7f,.7f,.72f);
      break;
    default:
      cube(0,0,0,1.75f,.55f,3.45f,v.r,v.g,v.b);
      cube(0,.48f,-.15f,1.42f,.62f,1.65f,.08f,.14f,.18f);
      for(float x:{-.92f,.92f})for(float z:{-1.15f,1.15f})cube(x,-.23f,z,.30f,.58f,.58f,.035f,.038f,.042f);
      break;
  }
}

void drawSandboxVehicles(){
  if(driveEnvironment!=DriveEnvironment::City||!sandboxLifeInitialized)return;
  float focusX=playerControlMode==PlayerControlMode::OnFoot?person.x:(playerControlMode==PlayerControlMode::Aircraft?plane.x:car.x);
  float focusZ=playerControlMode==PlayerControlMode::OnFoot?person.z:(playerControlMode==PlayerControlMode::Aircraft?plane.z:car.z);
  for(int i=0;i<MAX_SANDBOX_VEHICLES;++i){
    const SandboxVehicle&v=sandboxVehicles[i];
    if(!v.active||v.occupied)continue; // occupied body is drawn as player car/mesh path
    float dx=v.x-focusX,dz=v.z-focusZ;if(dx*dx+dz*dz>220.0f*220.0f)continue;
    float y=v.kind==SandboxVehicleKind::Boat?std::max(.05f,cityGroundHeightAt(v.x,v.z)*.15f+.08f):cityGroundHeightAt(v.x,v.z)+.46f;
    glPushMatrix();glTranslatef(v.x,y,v.z);glRotatef(v.yaw*180.0f/PI,0,1,0);
    if(v.flipped)glRotatef(v.flip*165.0f,1,0,.2f);
    drawSandboxVehicleMesh(v);glPopMatrix();
  }
  // If player is in a special vehicle, draw that mesh instead of normal car later.
}

void drawDynamicParked(){
  if(driveEnvironment!=DriveEnvironment::City||!sandboxLifeInitialized)return;
  float focusX=playerControlMode==PlayerControlMode::OnFoot?person.x:car.x;
  float focusZ=playerControlMode==PlayerControlMode::OnFoot?person.z:car.z;
  for(int i=0;i<MAX_DYNAMIC_PARKED;++i){
    const DynamicParked&d=dynamicParked[i];if(!d.active)continue;
    float dx=d.x-focusX,dz=d.z-focusZ;if(dx*dx+dz*dz>220.0f*220.0f)continue;
    float y=cityGroundHeightAt(d.x,d.z);
    glPushMatrix();glTranslatef(d.x,y+.46f,d.z);glRotatef(d.yaw*180.0f/PI,0,1,0);
    if(d.flipped)glRotatef(d.flip*170.0f,0,0,1);
    float dim=d.exploded?.35f:(1.0f-d.smoke*.25f);
    texturedCube(0,0,0,1.75f,.55f,3.45f,UV_METAL,d.r*dim,d.g*dim,d.b*dim);
    cube(0,.48f,-.15f,1.42f,.62f,1.65f,.08f*dim,.14f*dim,.18f*dim);
    for(float x:{-.92f,.92f})for(float z:{-1.15f,1.15f})cube(x,-.23f,z,.30f,.58f,.58f,.035f,.038f,.042f);
    if(d.smoke>.05f)cube(0,.7f,-.2f,.5f+d.smoke,.4f+d.smoke,.5f+d.smoke,.15f,.15f,.15f);
    if(d.exploded){cube(0,.2f,.9f,1.2f,.15f,.8f,.12f,.05f,.02f);cube(.4f,.35f,-.6f,.5f,.2f,.6f,.1f,.04f,.02f);}
    glPopMatrix();
  }
}

void drawPlayerSandboxVehicle(){
  if(occupiedSandboxVehicle<0||occupiedSandboxVehicle>=MAX_SANDBOX_VEHICLES)return;
  const SandboxVehicle&v=sandboxVehicles[occupiedSandboxVehicle];
  glPushMatrix();
  glTranslatef(car.x,carGroundHeight+carAirOffset+(v.kind==SandboxVehicleKind::Boat?.25f:.46f),car.z);
  glRotatef(car.yaw*180.0f/PI,0,1,0);
  glRotatef(carTerrainPitch*180.0f/PI,1,0,0);
  glRotatef((car.bodyRoll+carTerrainRoll)*180.0f/PI,0,0,1);
  // Tint with player paint a bit for ownership feel on car/buggy.
  SandboxVehicle tmp=v;
  if(v.kind==SandboxVehicleKind::Car||v.kind==SandboxVehicleKind::Buggy){
    const ColorOption&body=BODY_COLORS[selectedBodyColor];tmp.r=body.r;tmp.g=body.g;tmp.b=body.b;
  }
  drawSandboxVehicleMesh(tmp);
  glPopMatrix();
}



void drawParkedCar(const ParkedCar&parked){
  float y=cityGroundHeightAt(parked.x,parked.z);
  glPushMatrix();glTranslatef(parked.x,y+.46f,parked.z);glRotatef(parked.yaw,0,1,0);
  texturedCube(0,0,0,1.75f,.55f,3.45f,UV_METAL,parked.r,parked.g,parked.b);
  cube(0,.48f,-.15f,1.42f,.62f,1.65f,.08f,.14f,.18f);
  for(float x:{-.92f,.92f})for(float z:{-1.15f,1.15f})cube(x,-.23f,z,.30f,.58f,.58f,.035f,.038f,.042f);
  glPopMatrix();
}
void drawAirport(){
  texturedRect(AIRPORT_X-AIRPORT_RUNWAY_HALF,AIRPORT_RUNWAY_Z0,AIRPORT_X+AIRPORT_RUNWAY_HALF,AIRPORT_RUNWAY_Z1,.035f,UV_ROAD.u0,UV_ROAD.v0,UV_ROAD.u1,UV_ROAD.v1,12.0f);
  texturedRect(AIRPORT_X+18,118,AIRPORT_X+58,258,.038f,UV_ROAD.u0,UV_ROAD.v0,UV_ROAD.u1,UV_ROAD.v1,10.0f);
  glColor3f(.96f,.96f,.88f);glBegin(GL_QUADS);for(int i=0;i<8;++i){float z=AIRPORT_RUNWAY_Z0+13+i*22;glVertex3f(AIRPORT_X-1.1f,.07f,z);glVertex3f(AIRPORT_X+1.1f,.07f,z);glVertex3f(AIRPORT_X+1.1f,.07f,z+11);glVertex3f(AIRPORT_X-1.1f,.07f,z+11);}glEnd();
  cube(AIRPORT_X+45,4.0f,145,28,8,18,.60f,.64f,.67f);cube(AIRPORT_X+65,3.0f,188,20,6,24,.48f,.52f,.55f);cube(AIRPORT_X+55,11,115,4,22,4,.72f,.74f,.72f);cube(AIRPORT_X+55,23,115,8,2,8,.86f,.86f,.80f);
}
void drawPlane(){
  if(!plane.active)return;
  // yawInput/roll are positive for physical left. The chase view looks forward
  // from behind the aircraft, so its screen basis mirrors the model's local X.
  // Negate only at this model boundary: positive roll then puts the left wing
  // down on screen while yaw remains positive/left in world space.
  glPushMatrix();glTranslatef(plane.x,plane.y+.62f,plane.z);glRotatef(plane.yaw*180.0f/PI,0,1,0);glRotatef(-plane.pitch*180.0f/PI,1,0,0);glRotatef(-plane.roll*180.0f/PI,0,0,1);
  cube(0,0,0,1.35f,.45f,4.8f,.82f,.18f,.08f);cube(0,.18f,-.35f,7.4f,.10f,1.15f,.74f,.76f,.79f);cube(0,.45f,1.45f,2.1f,.16f,1.0f,.70f,.74f,.78f);cube(0,.22f,2.05f,.12f,1.35f,.18f,.70f,.74f,.78f);glPopMatrix();
}

void drawCity(){
  // City streaming must follow what the player is currently piloting.  Plane
  // bailouts intentionally retain their own body, while aircraft control moves
  // the active render/stream focus away from the parked car.
  // Stream/cull around the real view owner.  Aircraft view follows plane even
  // when its camera is offset, and a bailed-out plane no longer drags city LOD.
  const bool aircraftView=playerControlMode==PlayerControlMode::Aircraft;
  float renderFocusX=aircraftView?plane.x:(playerControlMode==PlayerControlMode::OnFoot?person.x:car.x);
  float renderFocusZ=aircraftView?plane.z:(playerControlMode==PlayerControlMode::OnFoot?person.z:car.z);
  // Chase-camera offset can be twelve metres behind a looping plane.  Stream
  // against both the craft and its current view anchor so the airport/world
  // cannot pop out while the camera is looking back across the flight path.
  const float streamCameraX=aircraftView?plane.x-std::sin(plane.yaw)*std::cos(plane.pitch)*12.0f:renderFocusX;
  const float streamCameraZ=aircraftView?plane.z-std::cos(plane.yaw)*std::cos(plane.pitch)*12.0f:renderFocusZ;
  auto nearStream=[&](float x,float z,float radius){float dx=x-streamCameraX,dz=z-streamCameraZ;return dx*dx+dz*dz<radius*radius;};
  auto nearFocus=[&](float x,float z,float radius){float dx=x-renderFocusX,dz=z-renderFocusZ;return dx*dx+dz*dz<radius*radius;};
  // Tile the ground only around the active player. The old 1000x640 fill made
  // 1,600 immediate-mode quads every City frame before any roads or props.
  constexpr float groundTile=40.0f;
  int groundMinX=(int)std::floor((renderFocusX-260.0f)/groundTile);
  int groundMaxX=(int)std::ceil((renderFocusX+260.0f)/groundTile);
  int groundMinZ=(int)std::floor((renderFocusZ-210.0f)/groundTile);
  int groundMaxZ=(int)std::ceil((renderFocusZ+210.0f)/groundTile);
  for(int gx=groundMinX;gx<groundMaxX;++gx)for(int gz=groundMinZ;gz<groundMaxZ;++gz){
    float x0=std::max(CITY_WORLD_MIN_X,gx*groundTile),x1=std::min(CITY_WORLD_MAX_X,(gx+1)*groundTile);
    float z0=std::max(CITY_WORLD_MIN_Z,gz*groundTile),z1=std::min(CITY_WORLD_MAX_Z,(gz+1)*groundTile);
    if(x1>x0&&z1>z0)texturedRect(x0,z0,x1,z1,0,UV_GRASS.u0,UV_GRASS.v0,UV_GRASS.u1,UV_GRASS.v1,groundTile);
  }
  // The plane camera can lead the aircraft during high-speed turns.  Fill only
  // a fixed 4x4 set of additional tiles around that view point; duplicate tiles
  // are harmless and the overhead is strictly bounded.
  if(aircraftView&&std::fabs(streamCameraX-renderFocusX)+std::fabs(streamCameraZ-renderFocusZ)>8.0f){
    int cameraMinX=(int)std::floor((streamCameraX-80.0f)/groundTile),cameraMaxX=(int)std::ceil((streamCameraX+80.0f)/groundTile);
    int cameraMinZ=(int)std::floor((streamCameraZ-70.0f)/groundTile),cameraMaxZ=(int)std::ceil((streamCameraZ+70.0f)/groundTile);
    for(int gx=cameraMinX;gx<cameraMaxX;++gx)for(int gz=cameraMinZ;gz<cameraMaxZ;++gz){
      float x0=std::max(CITY_WORLD_MIN_X,gx*groundTile),x1=std::min(CITY_WORLD_MAX_X,(gx+1)*groundTile);
      float z0=std::max(CITY_WORLD_MIN_Z,gz*groundTile),z1=std::min(CITY_WORLD_MAX_Z,(gz+1)*groundTile);
      if(x1>x0&&z1>z0)texturedRect(x0,z0,x1,z1,0,UV_GRASS.u0,UV_GRASS.v0,UV_GRASS.u1,UV_GRASS.v1,groundTile);
    }
  }
  if(nearFocus(-265,210,170.0f)){drawHill(-265,210,82,8.0f);drawPond(-275,208,40,27);}
  if(nearFocus(285,205,175.0f)){drawHill(285,205,88,7.0f);drawPond(286,210,45,30);}
  if(nearFocus(AIRPORT_X,190,190.0f)||nearStream(AIRPORT_X,190,202.0f))drawAirport();
  static const Vec2 bushes[]={{-240,-135},{-180,-135},{-340,135},{-240,135},{-180,135},
    {180,-138},{220,-138},{275,-138},{395,-138},{230,138},{290,138},{400,138},
    {-315,185},{-225,188},{155,185},{345,184},{175,-15},{175,15},{220,-15},{220,15},
    {280,-15},{280,15},{340,-15},{340,15},{400,-15},{400,15},{-185,-15},{-185,15}};
  for(int i=0;i<(int)(sizeof(bushes)/sizeof(bushes[0]));++i)
    if(nearFocus(bushes[i].x,bushes[i].z,145.0f)&&cityVegetationClear(bushes[i].x,bushes[i].z))drawBush(bushes[i].x,bushes[i].z,.75f+(i%3)*.12f);
  static const Vec2 cityTrees[]={{40,150},{70,150},{175,105},{175,-105},{-215,-105},{-215,-75},
    {-215,-45},{-215,-15},{-215,15},{-215,45},{-215,75},{-215,105},{-215,135},{-245,-15},
    {-245,15},{-275,-15},{-275,15},{450,-190},{450,190},{490,-190},{490,190},{530,-190},{530,190},
    {-360,250},{-330,255},{-300,260},{-235,270},{-190,250},{165,255},{220,270},{275,260},{335,250},{390,240},
    {-385,-265},{-330,-255},{-275,-250},{180,-260},{235,-255},{300,-260},{355,-250}};
  for(int i=0;i<(int)(sizeof(cityTrees)/sizeof(cityTrees[0]));++i)
    if(nearFocus(cityTrees[i].x,cityTrees[i].z,170.0f)&&cityVegetationClear(cityTrees[i].x,cityTrees[i].z))drawTree(cityTrees[i].x,cityTrees[i].z,.72f+(i%5)*.07f);
  // Five-road grid: a four-lane center boulevard, broad avenues, and tighter side streets.
  for(float road:CITY_ROADS){
    float half=cityRoadHalfWidth(road);
    texturedRect(road-half-2.5f,-162,road+half+2.5f,162,.012f,UV_SIDEWALK.u0,UV_SIDEWALK.v0,UV_SIDEWALK.u1,UV_SIDEWALK.v1,8.0f);
    texturedRect(-162,road-half-2.5f,162,road+half+2.5f,.014f,UV_SIDEWALK.u0,UV_SIDEWALK.v0,UV_SIDEWALK.u1,UV_SIDEWALK.v1,8.0f);
  }
  for(const CityRoadSegment&road:CITY_EXTENDED_ROADS)drawRoadSegment(road,true);
  drawCurvedRoad(WEST_CURVE_CONTROL,WEST_CURVE_COUNT,WEST_CURVE_HALF,true);
  drawCurvedRoad(EAST_CURVE_CONTROL,EAST_CURVE_COUNT,EAST_CURVE_HALF,true);
  drawCurvedRoad(HILL_CURVE_CONTROL,HILL_CURVE_COUNT,HILL_CURVE_HALF,true);
  drawCurvedRoad(EAST_HILL_CURVE_CONTROL,EAST_HILL_CURVE_COUNT,EAST_HILL_CURVE_HALF,true);
  drawCurvedRoad(SOUTH_CURVE_CONTROL,SOUTH_CURVE_COUNT,SOUTH_CURVE_HALF,true);
  for(float road:CITY_ROADS){
    float half=cityRoadHalfWidth(road);
    texturedRect(road-half,-162,road+half,162,.024f,UV_ROAD.u0,UV_ROAD.v0,UV_ROAD.u1,UV_ROAD.v1,8.0f);
    texturedRect(-162,road-half,162,road+half,.026f,UV_ROAD.u0,UV_ROAD.v0,UV_ROAD.u1,UV_ROAD.v1,8.0f);
  }
  for(const CityRoadSegment&road:CITY_EXTENDED_ROADS)drawRoadSegment(road,false);
  drawCurvedRoad(WEST_CURVE_CONTROL,WEST_CURVE_COUNT,WEST_CURVE_HALF,false);
  drawCurvedRoad(EAST_CURVE_CONTROL,EAST_CURVE_COUNT,EAST_CURVE_HALF,false);
  drawCurvedRoad(HILL_CURVE_CONTROL,HILL_CURVE_COUNT,HILL_CURVE_HALF,false);
  drawCurvedRoad(EAST_HILL_CURVE_CONTROL,EAST_HILL_CURVE_COUNT,EAST_HILL_CURVE_HALF,false);
  drawCurvedRoad(SOUTH_CURVE_CONTROL,SOUTH_CURVE_COUNT,SOUTH_CURVE_HALF,false);
  drawRoundabout(WEST_ROUNDABOUT_X,ROUNDABOUT_Z);drawRoundabout(EAST_ROUNDABOUT_X,ROUNDABOUT_Z);
  // The elevated deck includes guard rails and join geometry; only submit it
  // when it can affect the active camera/player area.
  if(renderFocusX>-420.0f&&renderFocusX<470.0f&&renderFocusZ>-265.0f&&renderFocusZ<285.0f)drawHighway();
  flatQuad(-19,-19,19,19,.028f,.31f,.33f,.36f);
  // Four marked parking/drift lots turn the previously empty blocks into usable space.
  for(const CityParking& lot:CITY_PARKING)
    texturedRect(lot.x-lot.width*.5f,lot.z-lot.depth*.5f,lot.x+lot.width*.5f,lot.z+lot.depth*.5f,.029f,UV_ROAD.u0,UV_ROAD.v0,UV_ROAD.u1,UV_ROAD.v1,8.0f);
  // Broad loading yards leave room for donuts and container slaloms beneath
  // and beyond the elevated eastern bridge.
  texturedRect(408,-166,447,-124,.03f,UV_ROAD.u0,UV_ROAD.v0,UV_ROAD.u1,UV_ROAD.v1,7.0f);
  texturedRect(454,-166,496,-124,.03f,UV_ROAD.u0,UV_ROAD.v0,UV_ROAD.u1,UV_ROAD.v1,7.0f);
  texturedRect(504,-166,527,-124,.03f,UV_ROAD.u0,UV_ROAD.v0,UV_ROAD.u1,UV_ROAD.v1,7.0f);
  texturedRect(408,124,447,166,.03f,UV_ROAD.u0,UV_ROAD.v0,UV_ROAD.u1,UV_ROAD.v1,7.0f);
  texturedRect(454,124,496,166,.03f,UV_ROAD.u0,UV_ROAD.v0,UV_ROAD.u1,UV_ROAD.v1,7.0f);
  texturedRect(504,124,527,166,.03f,UV_ROAD.u0,UV_ROAD.v0,UV_ROAD.u1,UV_ROAD.v1,7.0f);
  // Dashed amber center lines make direction and speed readable while drifting.
  glColor3f(.96f,.72f,.20f);glLineWidth(3.0f);glBegin(GL_LINES);
  for(float road:CITY_ROADS)for(int p=-156;p<156;p+=12){
    glVertex3f(road,.05f,(float)p);glVertex3f(road,.05f,(float)p+5);
    glVertex3f((float)p,.052f,road);glVertex3f((float)p+5,.052f,road);
  }
  glEnd();
  glColor3f(.90f,.92f,.94f);glLineWidth(2.0f);glBegin(GL_LINES);
  for(const CityParking& lot:CITY_PARKING)for(float x=lot.x-lot.width*.5f+4;x<lot.x+lot.width*.5f-2;x+=6){
    glVertex3f(x,.055f,lot.z-lot.depth*.5f+2);glVertex3f(x,.055f,lot.z-2);
    glVertex3f(x,.055f,lot.z+2);glVertex3f(x,.055f,lot.z+lot.depth*.5f-2);
  }
  // Extra lane separators visually distinguish the central boulevard.
  for(int p=-156;p<156;p+=12){
    glVertex3f(-4.2f,.056f,(float)p);glVertex3f(-4.2f,.056f,(float)p+5);
    glVertex3f(4.2f,.056f,(float)p);glVertex3f(4.2f,.056f,(float)p+5);
    glVertex3f((float)p,.056f,-4.2f);glVertex3f((float)p+5,.056f,-4.2f);
    glVertex3f((float)p,.056f,4.2f);glVertex3f((float)p+5,.056f,4.2f);
  }
  glEnd();
  // Colorful low-rise blocks with roof caps, doors, and bright window bands.
  drawParkDistrict();
  for(const IndustrialObstacle&obstacle:INDUSTRIAL_OBSTACLES)
    if(nearFocus(obstacle.x,obstacle.z,260.0f))drawIndustrialObstacle(obstacle);
  // Static PARKED_CARS replaced by dynamicParked for destruction payoff.
  drawDynamicParked();drawTraffic();drawPedestrians();drawSandboxVehicles();
  for(int buildingIndex=0;buildingIndex<(int)(sizeof(CITY_BUILDINGS)/sizeof(CITY_BUILDINGS[0]));++buildingIndex){
    const CityBuilding&building=CITY_BUILDINGS[buildingIndex];
    float dx=building.x-renderFocusX,dz=building.z-renderFocusZ,distance2=dx*dx+dz*dz;
    if(distance2>300.0f*300.0f)continue;
    if(buildingIndex==(int)(sizeof(CITY_BUILDINGS)/sizeof(CITY_BUILDINGS[0]))-1){
      if(distance2<210.0f*210.0f)drawChurch();
      else texturedCube(building.x,building.height*.5f,building.z,building.width,building.height,building.depth,UV_STONE,.82f,.80f,.74f);
      continue;
    }
    const AtlasUv&material=buildingIndex%3==0?UV_BRICK:(buildingIndex%3==1?UV_STONE:UV_GLASS);
    if(distance2>135.0f*135.0f){
      // One textured box replaces dozens of facade panels at distances where
      // individual destruction chunks are smaller than a Vita pixel.
      texturedCube(building.x,building.height*.5f,building.z,building.width,building.height,building.depth,
                   material,building.r,building.g,building.b);
      continue;
    }
    if(buildingCollapsed[buildingIndex]){
      float sink=clampf(buildingCollapse[buildingIndex],0.0f,1.0f);
      float h=building.height*(1.0f-sink*.85f);
      texturedCube(building.x,h*.35f,building.z,building.width*(1.0f+sink*.08f),h*.7f,building.depth*(1.0f+sink*.08f),
                   material,building.r*.45f,building.g*.4f,building.b*.38f);
      // Rubble skirt
      cube(building.x,.25f,building.z,building.width*1.15f,.5f,building.depth*1.15f,building.r*.3f,building.g*.28f,building.b*.25f);
      continue;
    }
    drawDestructibleBuilding(building,buildingIndex,material);
    cube(building.x,building.height+.22f,building.z,building.width*.88f,.44f,building.depth*.88f,
         building.r*.62f,building.g*.62f,building.b*.62f);
    if(!buildingChunkDestroyed(buildingIndex,0,0,1))cube(building.x,1.45f,building.z-building.depth*.505f,2.2f,2.9f,.15f,.18f,.12f,.08f);
    if(!buildingChunkDestroyed(buildingIndex,0,1,0))cube(building.x-building.width*.25f,building.height*.58f,building.z-building.depth*.51f,
         2.3f,1.25f,.13f,.72f,.88f,.96f);
    if(!buildingChunkDestroyed(buildingIndex,0,1,2))cube(building.x+building.width*.25f,building.height*.58f,building.z-building.depth*.51f,
         2.3f,1.25f,.13f,.72f,.88f,.96f);
  }
  if(!cityPropsInitialized)initCityProps();
  for(int i=0;i<cityLampCount;++i)if(nearFocus(cityLamps[i].x,cityLamps[i].z,175.0f))drawLamp(cityLamps[i]);
  for(int i=0;i<cityBenchCount;++i)if(nearFocus(cityBenches[i].x,cityBenches[i].z,175.0f))drawBench(cityBenches[i]);
  for(int i=0;i<cityBusStopCount;++i)if(nearFocus(cityBusStops[i].x,cityBusStops[i].z,190.0f))drawBusStop(cityBusStops[i]);
  for(int i=0;i<cityStopSignCount;++i)if(nearFocus(cityStopSigns[i].x,cityStopSigns[i].z,180.0f))drawStopSign(cityStopSigns[i]);
  for(int i=0;i<cityTrafficLightCount;++i)if(nearFocus(cityTrafficLights[i].x,cityTrafficLights[i].z,190.0f))drawTrafficLight(cityTrafficLights[i]);
  for(int i=0;i<cityStreetSignCount;++i)if(nearFocus(cityStreetSigns[i].x,cityStreetSigns[i].z,180.0f))drawStreetSign(cityStreetSigns[i]);
  for(int i=0;i<fencePieceCount;++i)if(nearFocus(fencePieces[i].x,fencePieces[i].z,190.0f))drawFencePiece(i);
  if(nearFocus(plane.x,plane.z,210.0f))drawPlane();
}

void drawTrack() {
  glDisable(GL_CULL_FACE);
  if(environmentTexture){glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,environmentTexture);}
  glColor3f(0.31f, 0.33f, 0.36f);
  glBegin(GL_QUADS);
  int edgeCount = trackClosed ? trackSampleCount : trackSampleCount - 1;
  for (int i = 0; i < edgeCount; ++i) {
    int j = (i + 1) % trackSampleCount;
    int k = trackClosed ? (j + 1) % trackSampleCount : (j + 1 < trackSampleCount ? j + 1 : j);
    float dx0 = track[j].x - track[i].x, dz0 = track[j].z - track[i].z;
    float l0 = std::sqrt(dx0*dx0 + dz0*dz0); if (l0 < .001f) continue; dx0 /= l0; dz0 /= l0;
    float nx0 = -dz0 * ROAD_HALF, nz0 = dx0 * ROAD_HALF;
    float dx1 = track[k].x - track[j].x, dz1 = track[k].z - track[j].z;
    float l1 = std::sqrt(dx1*dx1 + dz1*dz1);
    if (l1 < .001f) { dx1 = dx0; dz1 = dz0; } else { dx1 /= l1; dz1 /= l1; }
    float nx1 = -dz1 * ROAD_HALF, nz1 = dx1 * ROAD_HALF;
    glTexCoord2f(UV_ROAD.u0,UV_ROAD.v0);glVertex3f(track[i].x + nx0, .015f, track[i].z + nz0);
    glTexCoord2f(UV_ROAD.u1,UV_ROAD.v0);glVertex3f(track[i].x - nx0, .015f, track[i].z - nz0);
    glTexCoord2f(UV_ROAD.u1,UV_ROAD.v1);glVertex3f(track[j].x - nx1, .015f, track[j].z - nz1);
    glTexCoord2f(UV_ROAD.u0,UV_ROAD.v1);glVertex3f(track[j].x + nx1, .015f, track[j].z + nz1);
  }
  glEnd();
  if(environmentTexture)glDisable(GL_TEXTURE_2D);
  glColor3f(0.92f, 0.76f, 0.28f);
  glBegin(GL_LINES);
  for (int i = 0; i + 3 < trackSampleCount; i += 5) {
    glVertex3f(track[i].x, .035f, track[i].z);
    glVertex3f(track[i+3].x, .035f, track[i+3].z);
  }
  glEnd();
}

void drawCarShell(float front,float rear,float left,float right,float r,float g,float b){
  float lf=-1.08f+left*.26f,rf=1.08f-right*.26f,lr=-1.13f+left*.18f,rr=1.13f-right*.18f;
  float zf=1.95f-front*.52f,zr=-1.95f+rear*.42f,frontTop=.34f-front*.12f,rearTop=.32f-rear*.10f;
  glColor3f(r,g,b);glBegin(GL_QUADS);
  glVertex3f(lf,-.22f,zf);glVertex3f(rf,-.22f,zf);glVertex3f(rf,frontTop,zf);glVertex3f(lf,frontTop,zf);
  glVertex3f(rr,-.22f,zr);glVertex3f(lr,-.22f,zr);glVertex3f(lr,rearTop,zr);glVertex3f(rr,rearTop,zr);
  glVertex3f(lr,-.22f,zr);glVertex3f(lf,-.22f,zf);glVertex3f(lf,frontTop,zf);glVertex3f(lr,rearTop,zr);
  glVertex3f(rf,-.22f,zf);glVertex3f(rr,-.22f,zr);glVertex3f(rr,rearTop,zr);glVertex3f(rf,frontTop,zf);
  glVertex3f(lf,frontTop,zf);glVertex3f(rf,frontTop,zf);glVertex3f(rr,rearTop,zr);glVertex3f(lr,rearTop,zr);glEnd();
}

void drawCabinMesh(float damage,float r,float g,float b){
  float shift=(rightDamage-leftDamage)*.0012f;glPushMatrix();glTranslatef(shift,0,0);glColor3f(.10f,.16f,.19f);glBegin(GL_QUADS);
  glVertex3f(-.78f,.36f,.78f);glVertex3f(.78f,.36f,.78f);glVertex3f(.63f,1.03f,.40f);glVertex3f(-.63f,1.03f,.40f);
  glVertex3f(.63f,1.03f,-.55f);glVertex3f(-.63f,1.03f,-.55f);glVertex3f(-.82f,.36f,-1.05f);glVertex3f(.82f,.36f,-1.05f);
  glVertex3f(-.78f,.36f,.78f);glVertex3f(-.63f,1.03f,.40f);glVertex3f(-.63f,1.03f,-.55f);glVertex3f(-.82f,.36f,-1.05f);
  glVertex3f(.63f,1.03f,.40f);glVertex3f(.78f,.36f,.78f);glVertex3f(.82f,.36f,-1.05f);glVertex3f(.63f,1.03f,-.55f);glEnd();
  glColor3f(r*.72f,g*.72f,b);glBegin(GL_QUADS);glVertex3f(-.66f,1.04f,.40f);glVertex3f(.66f,1.04f,.40f);glVertex3f(.66f,1.04f,-.58f);glVertex3f(-.66f,1.04f,-.58f);glEnd();
  if(damage>.30f){glColor3f(.76f,.86f,.90f);glLineWidth(2);glBegin(GL_LINES);glVertex3f(-.12f,.72f,.795f);glVertex3f(.32f,.42f,.80f);glVertex3f(-.12f,.72f,.795f);glVertex3f(-.43f,.48f,.80f);glVertex3f(-.12f,.72f,.795f);glVertex3f(.05f,.39f,.80f);glEnd();}
  glPopMatrix();
}

void drawCar() {
  glPushMatrix();
  glTranslatef(car.x, carGroundHeight+carAirOffset+0.55f, car.z);
  glRotatef(car.yaw * 180.0f / PI, 0, 1, 0);
  glRotatef(carTerrainPitch * 180.0f / PI, 1, 0, 0);
  glRotatef(carTerrainRoll * 180.0f / PI, 0, 0, 1);
  float styleScaleX=selectedCarStyle==1?1.02f:(selectedCarStyle==2?1.10f:1.0f);
  float styleScaleY=selectedCarStyle==1?1.06f:(selectedCarStyle==2?.94f:1.0f);
  float styleScaleZ=selectedCarStyle==1?.91f:(selectedCarStyle==2?1.08f:1.0f);
  glScalef(styleScaleX,styleScaleY,styleScaleZ);

  // Wheels stay planted while the body rolls against the turn like suspension.
  drawWheel(-1.05f+leftDamage*.0015f,1.25f-frontDamage*.0035f,car.steerAngle-leftDamage*.0012f);
  drawWheel(1.05f-rightDamage*.0015f,1.25f-frontDamage*.0035f,car.steerAngle+rightDamage*.0012f);
  drawWheel(-1.05f+leftDamage*.0015f,-1.25f+rearDamage*.0028f,-leftDamage*.0010f);
  drawWheel(1.05f-rightDamage*.0015f,-1.25f+rearDamage*.0028f,rightDamage*.0010f);
  glPushMatrix();
  glRotatef(car.bodyPitch * 180.0f / PI, 1, 0, 0);
  glRotatef(car.bodyRoll * 180.0f / PI, 0, 0, 1);
  float damage=carDamage*.01f,front=frontDamage*.01f,rear=rearDamage*.01f,left=leftDamage*.01f,right=rightDamage*.01f;
  const ColorOption&bodyColor=BODY_COLORS[selectedBodyColor];const ColorOption&stripeColor=STRIPE_COLORS[selectedStripeColor];
  float damageDarken=1.0f-damage*.24f;
  float paintR=bodyColor.r*damageDarken,paintG=bodyColor.g*damageDarken,paintB=bodyColor.b*damageDarken;
  // Low, layered sports-car silhouette: splitter, chassis, hood, cabin and trunk.
  // A compact floor pan plus visible dark-red crumple rails replaces the old
  // oversized black chassis block that showed through damaged body panels.
  cube(0,-.20f,0,1.62f,.11f,3.48f,.075f,.080f,.085f);
  cube(-.70f,-.08f,0,.13f,.16f,3.72f,paintR*.38f,.026f,.018f);
  cube(.70f,-.08f,0,.13f,.16f,3.72f,paintR*.38f,.026f,.018f);
  cube(0,-.07f,1.58f,1.72f,.14f,.28f,paintR*.42f,.030f,.020f);
  cube(0,-.07f,-1.58f,1.72f,.14f,.28f,paintR*.42f,.030f,.020f);
  drawCarShell(front,rear,left,right,paintR,paintG,paintB);
  glPushMatrix();glTranslatef(front*.14f,.34f-front*.10f,1.05f-front*.12f);glRotatef(front*9.0f,1,0,0);
  cube(0,0,0,2.06f-front*.18f,.22f,1.55f-front*.32f,paintR*.96f,paintG,paintB);glPopMatrix();
  glPushMatrix();glTranslatef((rear-right+left)*.08f,.38f-rear*.08f,-1.42f+rear*.08f);glRotatef(-rear*8.0f,0,0,1);
  cube(0,0,0,2.08f-rear*.15f,.25f,1.05f-rear*.18f,paintR*.86f,paintG,paintB);glPopMatrix();
  drawCabinMesh(damage,paintR,paintG,paintB);
  if(selectedCarStyle==1){
    // Tall, short rally hatch silhouette with a rear roof extension and hatch glass.
    cube(0,.76f,-.73f,1.72f,.58f,1.08f,paintR*.82f,paintG*.82f,paintB*.82f);
    cube(0,.86f,-1.20f,1.48f,.39f,.08f,.14f,.25f,.31f);cube(0,1.08f,-.74f,1.62f,.10f,1.10f,paintR*.70f,paintG*.70f,paintB*.70f);
  }else if(selectedCarStyle==2){
    // Long-hood street muscle cues: square shoulders, hood scoop and ducktail.
    cube(-.92f,.31f,.95f,.30f,.34f,1.65f,paintR*.90f,paintG*.90f,paintB*.90f);cube(.92f,.31f,.95f,.30f,.34f,1.65f,paintR*.90f,paintG*.90f,paintB*.90f);
    cube(0,.53f,1.20f,.58f,.22f,.82f,paintR*.70f,paintG*.70f,paintB*.70f);cube(0,.62f,-1.87f,1.95f,.18f,.26f,paintR*.72f,paintG*.72f,paintB*.72f);
  }
  // Glass panels, side skirts, bumpers, grille, exhaust and mirrors.
  cube(0,.66f,.69f,1.52f,.38f,.08f,.20f,.34f,.41f);
  cube(0,.68f,-1.09f,1.50f,.34f,.08f,.16f,.27f,.34f);
  cube(-1.16f,-.05f,-.05f,.10f,.28f,3.25f,.10f,.10f,.11f);cube(1.16f,-.05f,-.05f,.10f,.28f,3.25f,.10f,.10f,.11f);
  cube(0,-.12f,-2.14f,2.18f,.22f,.18f,.08f,.08f,.085f);
  cube(0,.03f,2.13f,.92f,.20f,.09f,.035f,.035f,.04f);
  cube(-1.10f,.58f,.50f,.22f,.14f,.32f,paintR,paintG,paintB);cube(1.10f,.58f,.50f,.22f,.14f,.32f,paintR,paintG,paintB);
  cube(-.52f,-.18f,-2.28f,.20f,.12f,.24f,.34f,.35f,.36f);cube(.52f,-.18f,-2.28f,.20f,.12f,.24f,.34f,.35f,.36f);
  // Damage progressively misaligns the hood and front bumper; one lamp can fail.
  if(front>.22f){cube(-.52f+front*.10f,.49f-front*.09f,1.47f-front*.08f,.88f-front*.12f,.07f,.74f,.18f,.045f,.025f);}
  if(left>.22f){cube(-1.18f+left*.08f,.12f,-.05f,.06f,.15f,1.7f,.22f,.045f,.028f);}
  if(right>.22f){cube(1.18f-right*.08f,.12f,-.05f,.06f,.15f,1.7f,.22f,.045f,.028f);}
  glPushMatrix();glTranslatef((right-left)*.18f,-front*.22f,2.14f-front*.45f);glRotatef(front*27.0f,0,0,1);cube(0,0,0,2.20f-front*.48f,.18f,.20f,.06f,.06f,.065f);glPopMatrix();
  cube(-.72f, .08f-front*.05f, 2.18f-front*.12f, .46f-front*.10f, .18f, .08f, front>.55f?.18f:1.0f, front>.55f?.12f:.86f, front>.55f?.08f:.48f);
  cube(.72f, .08f, 2.18f, .46f, .18f, .08f, 1.0f, .86f, .48f);
  cube(-.72f, .05f, -2.13f, .42f, .20f, .08f, .95f, .03f, .02f);
  cube(.72f, .05f, -2.13f, .42f, .20f, .08f, .95f, .03f, .02f);
  // Hood stripe, roof highlight, rear spoiler and exhaust pair sharpen the silhouette.
  cube(0,.475f,1.10f,.18f,.025f,1.25f,stripeColor.r*(1.0f-damage*.18f),stripeColor.g*(1.0f-damage*.18f),stripeColor.b*(1.0f-damage*.18f));cube(0,.995f,-.28f,.72f,.025f,.92f,.55f,.57f,.60f);
  cube(0,.64f,-2.02f,1.62f,.10f,.22f,paintR*.65f,paintG,paintB);cube(-.63f,.43f,-1.94f,.09f,.43f,.09f,.08f,.08f,.085f);cube(.63f,.43f,-1.94f,.09f,.43f,.09f,.08f,.08f,.085f);
  glPopMatrix();
  glPopMatrix();
}

void drawRect(float x0, float y0, float x1, float y1, float r, float g, float b) {
  glColor3f(r, g, b);
  glBegin(GL_QUADS);
  glVertex3f(x0, y0, 0); glVertex3f(x1, y0, 0);
  glVertex3f(x1, y1, 0); glVertex3f(x0, y1, 0);
  glEnd();
}

// Tiny 5x7 block font keeps every builder action readable in the VitaGL overlay.
const char* glyph(char c){
  switch(c){
    case 'A':return"0111010001111111000110001";case 'B':return"1111010001111101000111110";
    case 'C':return"0111110000100001000001111";case 'D':return"1111010001100011000111110";
    case 'E':return"1111110000111101000011111";case 'F':return"1111110000111101000010000";
    case 'G':return"0111110000101111000101111";case 'H':return"1000110001111111000110001";
    case 'I':return"1111100100001000010011111";case 'J':return"0011100010000101001001100";
    case 'K':return"1000110010111001001010001";case 'L':return"1000010000100001000011111";
    case 'M':return"1000111011101011000110001";case 'N':return"1000111001101011001110001";
    case 'O':return"0111010001100011000101110";case 'P':return"1111010001111101000010000";
    case 'Q':return"0111010001100011001001101";
    case 'R':return"1111010001111101001010001";case 'S':return"0111110000011100000111110";
    case 'T':return"1111100100001000010000100";case 'U':return"1000110001100011000101110";
    case 'V':return"1000110001100010101000100";case 'W':return"1000110001101011101110001";
    case 'X':return"1000101010001000101010001";case 'Y':return"1000110001010100010000100";
    case 'Z':return"1111100010001000100011111";
    case '0':return"0111010001100011000101110";case '1':return"0010001100001000010001110";
    case '2':return"0111010001000100010011111";case '3':return"1111000001001100000111110";
    case '4':return"1001010010111110001000010";case '5':return"1111110000111100000111110";
    case '6':return"0111110000111101000101110";case '7':return"1111100010001000100001000";
    case '8':return"0111010001011101000101110";case '9':return"0111010001011110000101110";
    case '-':return"0000000000111110000000000";case ':':return"0000000100000000010000000";
    case '.':return"0000000000000000000000100";
    default:return"0000000000000000000000000";
  }
}
void drawLabel(float x,float y,const char* s,float scale=2.5f){
  for(;*s;++s,x+=6*scale){const char* g=glyph(*s);for(int r=0;r<5;++r)for(int c=0;c<5;++c)if(g[r*5+c]=='1')drawRect(x+c*scale,y+r*scale,x+(c+1)*scale,y+(r+1)*scale,1,1,1);}
}

void drawMinimap() {
  constexpr float left=36.0f,top=34.0f,right=278.0f,bottom=117.0f;
  // Heading-up local navigation: rotate the road world around the player and
  // show only nearby streets. Player stays centered and always points up-screen.
  float focusX=car.x,focusZ=car.z,heading=car.yaw;
  float localHalfX=115.0f,localHalfZ=72.0f;
  if(driveEnvironment!=DriveEnvironment::City&&trackSampleCount>0){localHalfX=58.0f;localHalfZ=42.0f;}
  const float sh=std::sin(heading),ch=std::cos(heading);
  auto mapPoint=[&](float x,float z,float&sx,float&sy){
    float dx=x-focusX,dz=z-focusZ;
    float localX=dx*ch-dz*sh,localZ=dx*sh+dz*ch;
    sx=(left+right)*.5f+localX/localHalfX*(right-left)*.5f;
    sy=(top+bottom)*.5f-localZ/localHalfZ*(bottom-top)*.5f;
  };
  auto mapX=[&](float x){float sx,sy;mapPoint(x,focusZ,sx,sy);return sx;};
  auto mapY=[&](float z){float sx,sy;mapPoint(focusX,z,sx,sy);return sy;};
  float minX=focusX-localHalfX*1.7f,maxX=focusX+localHalfX*1.7f,minZ=focusZ-localHalfZ*1.7f,maxZ=focusZ+localHalfZ*1.7f;

  drawRect(left,top,right,bottom,.055f,.075f,.08f);
  glColor3f(.48f,.52f,.52f);
  if(driveEnvironment==DriveEnvironment::City){
    glLineWidth(2.0f);
    glBegin(GL_LINES);
    for(float road:CITY_ROADS){
      float ax,ay,bx,by;mapPoint(road,minZ,ax,ay);mapPoint(road,maxZ,bx,by);glVertex3f(ax,ay,0);glVertex3f(bx,by,0);
      mapPoint(minX,road,ax,ay);mapPoint(maxX,road,bx,by);glVertex3f(ax,ay,0);glVertex3f(bx,by,0);
    }
    for(const CityRoadSegment&road:CITY_EXTENDED_ROADS){
      float ax,ay,bx,by;mapPoint(road.x0,road.z0,ax,ay);mapPoint(road.x1,road.z1,bx,by);glVertex3f(ax,ay,0);glVertex3f(bx,by,0);
    }
    for(int curve=0;curve<5;++curve){const Vec2*control=curve==0?WEST_CURVE_CONTROL:(curve==1?EAST_CURVE_CONTROL:(curve==2?HILL_CURVE_CONTROL:(curve==3?EAST_HILL_CURVE_CONTROL:SOUTH_CURVE_CONTROL)));
      int count=curve==0?WEST_CURVE_COUNT:(curve==1?EAST_CURVE_COUNT:(curve==2?HILL_CURVE_COUNT:(curve==3?EAST_HILL_CURVE_COUNT:SOUTH_CURVE_COUNT))),samples=(count-1)*CURVED_ROAD_STEPS;
      for(int sample=0;sample<samples;++sample){Vec2 a=curvedRoadPoint(control,count,(float)sample/CURVED_ROAD_STEPS);
        Vec2 b=curvedRoadPoint(control,count,(float)(sample+1)/CURVED_ROAD_STEPS);
        float ax,ay,bx,by;mapPoint(a.x,a.z,ax,ay);mapPoint(b.x,b.z,bx,by);glVertex3f(ax,ay,0);glVertex3f(bx,by,0);}}
    glColor3f(.72f,.54f,.16f);
    for(int sample=0;sample<HIGHWAY_SAMPLE_COUNT;++sample){Vec2 a=highwayPoint((float)sample/HIGHWAY_STEPS_PER_SEGMENT);
      Vec2 b=highwayPoint((float)(sample+1)/HIGHWAY_STEPS_PER_SEGMENT);float ax,ay,bx,by;mapPoint(a.x,a.z,ax,ay);mapPoint(b.x,b.z,bx,by);glVertex3f(ax,ay,0);glVertex3f(bx,by,0);}
    glEnd();
    glColor3f(.58f,.61f,.60f);glLineWidth(2);glBegin(GL_LINE_STRIP);
    for(int sample=0;sample<PARK_ROAD_SAMPLE_COUNT;++sample){Vec2 p=parkRoadPoint((float)sample/PARK_ROAD_STEPS_PER_SEGMENT);float px,py;mapPoint(p.x,p.z,px,py);glVertex3f(px,py,0);}glEnd();
    glColor3f(.26f,.29f,.29f);
    glBegin(GL_QUADS);
    for(const CityParking& lot:CITY_PARKING){
      float x0,y0,x1,y1,x2,y2,x3,y3;mapPoint(lot.x-lot.width*.5f,lot.z+lot.depth*.5f,x0,y0);mapPoint(lot.x+lot.width*.5f,lot.z+lot.depth*.5f,x1,y1);mapPoint(lot.x+lot.width*.5f,lot.z-lot.depth*.5f,x2,y2);mapPoint(lot.x-lot.width*.5f,lot.z-lot.depth*.5f,x3,y3);
      glVertex3f(x0,y0,0);glVertex3f(x1,y1,0);glVertex3f(x2,y2,0);glVertex3f(x3,y3,0);
    }
    glEnd();
  }else{
    glColor3f(.72f,.74f,.72f);glLineWidth(3.0f);glBegin(GL_LINE_STRIP);
    for(int i=0;i<trackSampleCount;++i){float px,py;mapPoint(track[i].x,track[i].z,px,py);glVertex3f(px,py,0);}
    if(trackClosed&&trackSampleCount>0){float px,py;mapPoint(track[0].x,track[0].z,px,py);glVertex3f(px,py,0);}
    glEnd();
  }
  float cx=(left+right)*.5f,cy=(top+bottom)*.5f;
  // Because mapPoint is heading-up, the player marker is a fixed north/up arrow.
  float fx=0.0f,fy=-6.5f;
  float sx=4.0f,sy=0.0f;
  glColor3f(1.0f,.25f,.05f);glBegin(GL_TRIANGLES);
  glVertex3f(cx+fx,cy+fy,0);glVertex3f(cx-fx*.55f+sx,cy-fy*.55f+sy,0);
  glVertex3f(cx-fx*.55f-sx,cy-fy*.55f-sy,0);glEnd();
  glLineWidth(1.0f);
}

void drawSpeedometer(){
  constexpr float cx=873,cy=477,radius=48;float ratio=clampf(currentSpeed/65.0f,0.0f,1.0f);
  drawRect(807,407,940,532,.07f,.09f,.10f);drawRect(807,407,940,412,.98f,.42f,.08f);
  glLineWidth(4);glColor3f(.68f,.72f,.73f);glBegin(GL_LINE_STRIP);
  for(int i=0;i<=32;++i){float a=-2.2f+i*(4.4f/32);glVertex3f(cx+std::sin(a)*radius,cy-std::cos(a)*radius,0);}glEnd();
  glLineWidth(2);glBegin(GL_LINES);for(int i=0;i<=13;++i){float a=-2.2f+i*(4.4f/13),inner=(i%2)?40.0f:36.0f;
    if(i>10)glColor3f(1.0f,.30f,.08f);else glColor3f(.86f,.88f,.88f);
    glVertex3f(cx+std::sin(a)*inner,cy-std::cos(a)*inner,0);glVertex3f(cx+std::sin(a)*radius,cy-std::cos(a)*radius,0);
  }glEnd();
  float needle=-2.2f+ratio*4.4f;glColor3f(1.0f,.28f,.05f);glLineWidth(5);glBegin(GL_LINES);
  glVertex3f(cx-std::sin(needle)*7,cy+std::cos(needle)*7,0);glVertex3f(cx+std::sin(needle)*37,cy-std::cos(needle)*37,0);glEnd();
  drawRect(cx-5,cy-5,cx+5,cy+5,.92f,.94f,.94f);char value[8];std::snprintf(value,sizeof(value),"%d",(int)currentSpeed);
  drawLabel(currentSpeed>=10?cx-17:cx-8,493,value,2.6f);drawLabel(cx-18,516,"MPH",1.25f);glLineWidth(1);
}

void drawCockpitOverlay(){
  // Left-hand-drive cockpit: the wheel and instrument binnacle line up with
  // the physical driver-side camera rather than sitting in screen center.
  if(cockpitTexture){
    glEnable(GL_TEXTURE_2D);glBindTexture(GL_TEXTURE_2D,cockpitTexture);glColor3f(1,1,1);glBegin(GL_QUADS);
    // Driver-focused crop: left gauges through center console, with the
    // passenger-side third outside the field of view.
    glTexCoord2f(.04f,0);glVertex3f(0,350,0);glTexCoord2f(.72f,0);glVertex3f(960,350,0);
    glTexCoord2f(.72f,1);glVertex3f(960,544,0);glTexCoord2f(.04f,1);glVertex3f(0,544,0);glEnd();glDisable(GL_TEXTURE_2D);
  }
  glColor3f(.055f,.06f,.065f);glBegin(GL_QUADS);
  glVertex3f(0,0,0);glVertex3f(38,0,0);glVertex3f(125,544,0);glVertex3f(0,544,0);
  glVertex3f(922,0,0);glVertex3f(960,0,0);glVertex3f(960,544,0);glVertex3f(835,544,0);
  glEnd();
  if(!cockpitTexture){drawRect(0,446,960,544,.055f,.06f,.065f);drawRect(120,438,840,458,.12f,.13f,.14f);drawRect(232,452,414,485,.075f,.08f,.085f);drawRect(500,454,612,488,.10f,.11f,.12f);}
  float wheelTurn=clampf(car.steerAngle/.75f,-1.0f,1.0f)*85.0f;glPushMatrix();glTranslatef(323,500,0);glRotatef(wheelTurn,0,0,1);
  glColor3f(.035f,.038f,.042f);glLineWidth(11);glBegin(GL_LINE_LOOP);for(int i=0;i<36;++i){float a=i*2*PI/36;glVertex3f(std::cos(a)*58,std::sin(a)*58,0);}glEnd();
  glLineWidth(8);glBegin(GL_LINES);for(int i=0;i<3;++i){float a=-PI*.5f+i*2*PI/3;glVertex3f(0,0,0);glVertex3f(std::cos(a)*49,std::sin(a)*49,0);}glEnd();
  drawRect(-14,-14,14,14,.18f,.19f,.20f);glPopMatrix();glLineWidth(1);
}

void drawChaosHud(){
  if(driveEnvironment!=DriveEnvironment::City)return;
  char chaosText[48],ccomboText[32];
  std::snprintf(chaosText,sizeof(chaosText),"CHAOS %d",(int)chaosScore);
  std::snprintf(ccomboText,sizeof(ccomboText),"x%.1f",chaosCombo);
  float pulse=chaosCombo>2.0f?.15f:0.0f;
  drawRect(22,150,250,220,.10f+pulse,.08f,.09f);
  drawRect(22,150,250,156,.98f,.32f,.08f);
  drawLabel(38,168,chaosText,2.0f);
  drawLabel(38,196,ccomboText,1.7f);
}

void drawHud() {
  char scoreText[32],comboText[32],cameraText[16],damageText[24],vehText[24];
  std::snprintf(scoreText, sizeof(scoreText), "SCORE %d", static_cast<int>(car.score));
  std::snprintf(comboText, sizeof(comboText), "COMBO %.1fX", car.combo);
  std::snprintf(damageText,sizeof(damageText),"DAMAGE %d",static_cast<int>(carDamage));
  const char*vk=activeVehicleKind==SandboxVehicleKind::Motorcycle?"BIKE":activeVehicleKind==SandboxVehicleKind::Truck?"TRUCK":activeVehicleKind==SandboxVehicleKind::Boat?"BOAT":activeVehicleKind==SandboxVehicleKind::Buggy?"BUGGY":"CAR";
  std::snprintf(vehText,sizeof(vehText),"%s",vk);
  float cardRight=hudShowsMinimap?292.0f:252.0f,cardBottom=hudShowsMinimap?128.0f:112.0f;
  drawRect(22,20,cardRight,cardBottom,.10f,.13f,.14f);drawRect(22,20,cardRight,26,.98f,.42f,.08f);
  if(hudShowsMinimap)drawMinimap();
  else{
    drawLabel(38, 50, scoreText, 2.35f);
    drawLabel(38, 82, comboText, 2.35f);
  }

  drawRect(730, 20, 938, 57, remotePeerKnown ? .10f : .24f,
           remotePeerKnown ? .48f : .24f, remotePeerKnown ? .16f : .24f);
  drawLabel(746, 32, remotePeerKnown ? "WIFI LINK" : "WIFI OFF", 1.8f);
  std::snprintf(cameraText,sizeof(cameraText),"CAM %d",cameraMode+1);
  drawRect(818,65,938,99,.10f,.13f,.14f);drawLabel(835,76,cameraText,1.8f);
  drawRect(730,107,938,143,carDamage>65?.42f:.10f,carDamage>65?.10f:.13f,.12f);
  drawLabel(746,118,damageText,1.8f);
  drawRect(730,150,938,186,.10f,.13f,.14f);drawLabel(746,161,vehText,1.7f);
  drawSpeedometer();
}

void drawOnFootHud(){
  drawRect(750,20,938,58,.09f,.12f,.13f);drawLabel(772,32,"ON FOOT",1.9f);
  drawRect(750,66,938,102,.09f,.12f,.13f);drawLabel(770,78,person.cameraMode==0?"CAM THIRD":"CAM FIRST",1.65f);
  drawRect(22,486,520,528,.09f,.12f,.13f);drawLabel(38,499,"X JUMP  DOWN RUN  L ADS  R FIRE  TRI GUN",1.05f);
  drawRect(690,112,938,150,.09f,.12f,.13f);drawLabel(708,124,selectedWeapon==WeaponType::RocketLauncher?"ROCKET LAUNCHER":"MACHINE GUN",1.55f);
  bool nearCar=personDistanceToCar()<=3.25f;
  bool nearToy=false;const char*toyName="";
  for(int i=0;i<MAX_SANDBOX_VEHICLES;++i){const SandboxVehicle&v=sandboxVehicles[i];if(!v.active||v.occupied||v.exploded)continue;
    float dx=v.x-person.x,dz=v.z-person.z;if(dx*dx+dz*dz<=3.6f*3.6f){nearToy=true;
      toyName=v.kind==SandboxVehicleKind::Motorcycle?"BIKE":v.kind==SandboxVehicleKind::Truck?"TRUCK":v.kind==SandboxVehicleKind::Boat?"BOAT":v.kind==SandboxVehicleKind::Buggy?"BUGGY":"CAR";break;}}
  if(nearToy){drawRect(280,468,680,522,.10f,.13f,.14f);drawRect(280,468,680,474,.98f,.42f,.08f);char msg[40];std::snprintf(msg,sizeof(msg),"SQUARE ENTER %s",toyName);drawLabel(310,488,msg,1.65f);}
  else if(nearCar){drawRect(300,468,660,522,.10f,.13f,.14f);drawRect(300,468,660,474,.98f,.42f,.08f);drawLabel(335,488,"SQUARE ENTER VEHICLE",1.75f);}
  if(plane.active){float pdx=person.x-plane.x,pdz=person.z-plane.z;if(pdx*pdx+pdz*pdz<=16.0f){drawRect(300,420,660,460,.10f,.13f,.14f);drawLabel(335,432,"SQUARE ENTER PLANE",1.55f);}}
  glColor3f(1.0f,.82f,.22f);glLineWidth(2);glBegin(GL_LINES);glVertex3f(468,272,0);glVertex3f(478,272,0);glVertex3f(482,272,0);glVertex3f(492,272,0);glVertex3f(480,260,0);glVertex3f(480,269,0);glVertex3f(480,275,0);glVertex3f(480,284,0);glEnd();glLineWidth(1);
  if(person.cameraMode==1){
    // Tighter weapon viewmodels + iron-sightish center.
    if(selectedWeapon==WeaponType::RocketLauncher){
      glColor3f(.10f,.14f,.09f);glBegin(GL_QUADS);glVertex3f(700,544,0);glVertex3f(960,544,0);glVertex3f(960,400,0);glVertex3f(780,430,0);glEnd();
      drawRect(800,420,960,465,.18f,.24f,.15f);drawRect(770,470,830,544,.07f,.09f,.07f);drawRect(910,390,960,470,.05f,.06f,.05f);
      if(muzzleFlashTimer>0)drawRect(880,360,940,420,1.0f,.55f,.08f);
    }else{
      drawRect(740,470,960,530,.06f,.065f,.07f);drawRect(830,430,960,500,.10f,.105f,.11f);drawRect(900,400,960,460,.04f,.045f,.05f);
      drawRect(920,415,948,455,.02f,.02f,.025f);
      if(muzzleFlashTimer>0)drawRect(890,385,950,445,1.0f,.62f,.1f);
    }
  }
}

void beginOverlay() {
  glDisable(GL_DEPTH_TEST);
  glMatrixMode(GL_PROJECTION); glLoadIdentity(); glOrthof(0, 960, 544, 0, -1, 1);
  glMatrixMode(GL_MODELVIEW); glLoadIdentity();
  glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
}

void endOverlay() { glDisable(GL_BLEND); glEnable(GL_DEPTH_TEST); }

void drawGround() {
  texturedRect(CITY_WORLD_MIN_X,CITY_WORLD_MIN_Z,CITY_WORLD_MAX_X,CITY_WORLD_MAX_Z,0,UV_GRASS.u0,UV_GRASS.v0,UV_GRASS.u1,UV_GRASS.v1,20.0f);
}

void renderMenuWorld() {
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glEnable(GL_DEPTH_TEST);
  glMatrixMode(GL_PROJECTION); glLoadIdentity();
  gluPerspective(43.0f, 960.0f/544.0f, .1f, 480.0f);
  glMatrixMode(GL_MODELVIEW); glLoadIdentity();
  float t=(float)(sceKernelGetProcessTimeWide()%18000000ULL)/18000000.0f*PI*2.0f;
  gluLookAt(std::sin(t)*61.0f,48.0f,std::cos(t)*61.0f,0,0,0,0,1,0);
  drawSky();
  if(driveEnvironment==DriveEnvironment::City)drawCity();else{drawGround();drawTrack();}
  drawCar();
}

void drawMenu() {
  renderMenuWorld();
  beginOverlay();
  // Dark glass veil/card over the live Figure 8 track, matching the original
  // game's menu composition instead of replacing the world with black.
  // Keep the track visible around a compact central menu panel.
  drawRect(175, 36, 785, 505, 0.10f, 0.13f, 0.14f);
  drawRect(0, 0, 960, 10, 0.98f, 0.42f, 0.08f);
  // Stylized Figure 8 title mark.
  glLineWidth(18.0f);
  glColor3f(0.95f, 0.22f, 0.07f);
  glBegin(GL_LINE_LOOP);
  for (int i = 0; i < 96; ++i) {
    float t = (float)i / 96.0f * PI * 2.0f;
    glVertex3f(480.0f + std::sin(t) * 105.0f, 125.0f + std::sin(t) * std::cos(t) * 72.0f, 0);
  }
  glEnd();

  const float y[5] = {192.0f, 246.0f, 300.0f, 354.0f, 408.0f};
  const char* labels[5]={"DRIVE","BUILD TRACK","CITY DRIVE","CUSTOMIZE","SETTINGS"};
  for (int i = 0; i < 5; ++i) {
    bool selected = menuSelection == i;
    drawRect(285, y[i], 675, y[i] + 43,
      selected ? 0.92f : 0.13f, selected ? 0.18f : 0.14f, selected ? 0.06f : 0.13f);
    float labelX=i==1?365.0f:(i==2?375.0f:(i==3?365.0f:(i==4?388.0f:395.0f)));
    drawLabel(labelX,y[i]+13,labels[i],2.35f);
  }
  glEnable(GL_DEPTH_TEST);
  maybeStreamFrame();
  vglSwapBuffers(GL_FALSE);
}

void advanceCustomization(int direction){
  if(customizeSelection==0)selectedCarStyle=(selectedCarStyle+direction+3)%3;
  else if(customizeSelection==1){int count=(int)(sizeof(BODY_COLORS)/sizeof(BODY_COLORS[0]));selectedBodyColor=(selectedBodyColor+direction+count)%count;}
  else if(customizeSelection==2){int count=(int)(sizeof(STRIPE_COLORS)/sizeof(STRIPE_COLORS[0]));selectedStripeColor=(selectedStripeColor+direction+count)%count;}
  else if(customizeSelection==3)selectedWheelStyle=(selectedWheelStyle+direction+3)%3;
  saveCustomization();
}

void drawCustomize(){
  glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);glEnable(GL_DEPTH_TEST);
  glMatrixMode(GL_PROJECTION);glLoadIdentity();gluPerspective(43.0f,960.0f/544.0f,.1f,120.0f);
  // Close, left-weighted showroom framing leaves room for the option rail while
  // making body and wheel changes obvious on the Vita's 5-inch display.
  glMatrixMode(GL_MODELVIEW);glLoadIdentity();gluLookAt(5.0f,2.9f,6.8f,1.35f,.35f,0,0,1,0);
  drawSky();texturedRect(-14,-14,14,14,0,UV_ROAD.u0,UV_ROAD.v0,UV_ROAD.u1,UV_ROAD.v1,7.0f);
  cube(0,.12f,0,6.2f,.22f,6.2f,.12f,.14f,.15f);
  CarState savedCar=car;float savedDamage=carDamage,savedFront=frontDamage,savedRear=rearDamage,savedLeft=leftDamage,savedRight=rightDamage,savedWheelSpin=wheelSpin;
  car=CarState{};car.yaw=(float)(sceKernelGetProcessTimeWide()%12000000ULL)/12000000.0f*PI*2.0f;
  carDamage=frontDamage=rearDamage=leftDamage=rightDamage=0;wheelSpin=0;drawCar();
  car=savedCar;carDamage=savedDamage;frontDamage=savedFront;rearDamage=savedRear;leftDamage=savedLeft;rightDamage=savedRight;wheelSpin=savedWheelSpin;

  beginOverlay();drawRect(555,25,940,519,.075f,.095f,.105f);drawRect(555,25,940,33,.98f,.42f,.08f);
  drawLabel(625,52,"CUSTOMIZE",2.8f);
  const char*labels[CUSTOMIZE_OPTION_COUNT]={"BODY TYPE","BODY COLOR","HOOD STRIPE","WHEELS","BACK"};
  const char*values[CUSTOMIZE_OPTION_COUNT]={CAR_STYLE_NAMES[selectedCarStyle],BODY_COLORS[selectedBodyColor].name,
    STRIPE_COLORS[selectedStripeColor].name,WHEEL_STYLE_NAMES[selectedWheelStyle],""};
  for(int i=0;i<CUSTOMIZE_OPTION_COUNT;++i){float y=104+i*78;bool selected=customizeSelection==i;
    drawRect(575,y,920,y+61,selected?.90f:.13f,selected?.20f:.14f,selected?.055f:.14f);
    drawLabel(592,y+9,labels[i],1.75f);if(i<4)drawLabel(592,y+34,values[i],1.55f);
  }
  const ColorOption&body=BODY_COLORS[selectedBodyColor];const ColorOption&stripe=STRIPE_COLORS[selectedStripeColor];
  drawRect(28,468,92,512,body.r,body.g,body.b);drawRect(100,468,164,512,stripe.r,stripe.g,stripe.b);
  drawLabel(180,480,"LEFT RIGHT CHANGE",1.65f);endOverlay();maybeStreamFrame();vglSwapBuffers(GL_FALSE);
}

void updateCustomize(uint32_t pressed){
  if(pressed&SCE_CTRL_UP)customizeSelection=(customizeSelection+CUSTOMIZE_OPTION_COUNT-1)%CUSTOMIZE_OPTION_COUNT;
  if(pressed&SCE_CTRL_DOWN)customizeSelection=(customizeSelection+1)%CUSTOMIZE_OPTION_COUNT;
  if(pressed&SCE_CTRL_LEFT)advanceCustomization(-1);
  if(pressed&SCE_CTRL_RIGHT)advanceCustomization(1);
  if(pressed&SCE_CTRL_CROSS){if(customizeSelection==4)gameMode=GameMode::Menu;else advanceCustomization(1);}
  if(pressed&(SCE_CTRL_START|SCE_CTRL_CIRCLE))gameMode=GameMode::Menu;
}

void drawSettings(){
  renderMenuWorld();beginOverlay();drawRect(205,72,755,474,.08f,.11f,.12f);drawRect(205,72,755,80,.98f,.42f,.08f);
  drawLabel(350,112,"SETTINGS",3.2f);drawLabel(294,197,"STEER ANGLE",2.5f);
  char angle[20];std::snprintf(angle,sizeof(angle),"%d DEG",(int)std::round(steeringAngleDegrees));drawLabel(410,245,angle,2.8f);
  drawRect(295,302,665,326,.16f,.18f,.19f);float amount=(steeringAngleDegrees-24.0f)/(52.0f-24.0f);drawRect(300,307,300+360*clampf(amount,0.0f,1.0f),321,.96f,.30f,.06f);
  for(int i=0;i<=7;++i)drawRect(298+i*52,298,302+i*52,330,.72f,.74f,.75f);
  drawLabel(275,355,"LEFT RIGHT ADJUST",1.9f);drawLabel(266,392,"SQUARE RESET 33 DEG",1.9f);drawLabel(316,429,"START BACK",1.9f);endOverlay();maybeStreamFrame();vglSwapBuffers(GL_FALSE);
}

void drawBuilder() {
  Vec2 end=track[trackSampleCount>0?trackSampleCount-1:0];
  Vec2 prev=track[trackSampleCount>1?trackSampleCount-2:0];
  float heading=trackSampleCount>1?std::atan2(end.x-prev.x,end.z-prev.z):0.0f;
  builderCameraTargetX+=(end.x-builderCameraTargetX)*.18f;
  builderCameraTargetZ+=(end.z-builderCameraTargetZ)*.18f;
  float wantedX=end.x-std::sin(heading)*27.0f+std::cos(heading)*17.0f;
  float wantedZ=end.z-std::cos(heading)*27.0f-std::sin(heading)*17.0f;
  builderCameraX+=(wantedX-builderCameraX)*.16f;
  builderCameraZ+=(wantedZ-builderCameraZ)*.16f;

  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glEnable(GL_DEPTH_TEST);
  glMatrixMode(GL_PROJECTION);glLoadIdentity();
  gluPerspective(48.0f,960.0f/544.0f,.1f,480.0f);
  glMatrixMode(GL_MODELVIEW);glLoadIdentity();
  gluLookAt(builderCameraX,24.0f,builderCameraZ,builderCameraTargetX,0,builderCameraTargetZ,0,1,0);
  drawSky();
  drawGround();drawTrack();
  cube(end.x,.45f,end.z,1.2f,.9f,1.2f,1.0f,.55f,.08f);

  beginOverlay();
  drawRect(0,0,960,9,.98f,.42f,.08f);
  // Compact translucent-style control rail: the road remains the main canvas.
  drawRect(665,25,940,519,.10f,.13f,.14f);
  char slotLabel[24];std::snprintf(slotLabel,sizeof(slotLabel),"SLOT %d",currentTrackSlot+1);
  static const float radii[]={10,16,24};char radiusLabel[28];
  std::snprintf(radiusLabel,sizeof(radiusLabel),"TURN RADIUS %d M",(int)radii[turnRadiusChoice]);
  const char* labels[BUILDER_OPTION_COUNT]={"STRAIGHT","TURN LEFT","TURN RIGHT",radiusLabel,"UNDO","CLEAR","DRIVE",slotLabel,"SAVE","LOAD","MENU"};
  const float top=28.0f,row=39.0f;
  for(int i=0;i<BUILDER_OPTION_COUNT;++i){float y=top+i*row;bool s=builderSelection==i;drawRect(680,y,925,y+32,s?.96f:.14f,s?.32f:.15f,s?.06f:.14f);drawLabel(696,y+9,labels[i],1.86f);}
  drawRect(665,482,940,519,.17f,.20f,.16f);drawLabel(680,493,builderStatus,1.65f);
  endOverlay();maybeStreamFrame();vglSwapBuffers(GL_FALSE);
}
void updateBuilder(uint32_t pressed) {
  static const int turnRadii[]={10,16,24};
  if (pressed & SCE_CTRL_START) { gameMode=GameMode::Menu; return; }
  if (pressed & SCE_CTRL_UP) builderSelection=(builderSelection+BUILDER_OPTION_COUNT-1)%BUILDER_OPTION_COUNT;
  if (pressed & SCE_CTRL_DOWN) builderSelection=(builderSelection+1)%BUILDER_OPTION_COUNT;
  if (pressed & SCE_CTRL_LEFT) {
    if(builderSelection==0) straightChoice=(straightChoice+3)%4;
    if(builderSelection==1||builderSelection==2) turnAngleChoice=(turnAngleChoice+5)%6;
    if(builderSelection==3) turnRadiusChoice=(turnRadiusChoice+2)%3;
    if(builderSelection==7){currentTrackSlot=(currentTrackSlot+TRACK_SLOT_COUNT-1)%TRACK_SLOT_COUNT;overwriteArmedSlot=-1;std::snprintf(builderStatus,sizeof(builderStatus),"SLOT %d",currentTrackSlot+1);}
  }
  if (pressed & SCE_CTRL_RIGHT) {
    if(builderSelection==0) straightChoice=(straightChoice+1)%4;
    if(builderSelection==1||builderSelection==2) turnAngleChoice=(turnAngleChoice+1)%6;
    if(builderSelection==3) turnRadiusChoice=(turnRadiusChoice+1)%3;
    if(builderSelection==7){currentTrackSlot=(currentTrackSlot+1)%TRACK_SLOT_COUNT;overwriteArmedSlot=-1;std::snprintf(builderStatus,sizeof(builderStatus),"SLOT %d",currentTrackSlot+1);}
  }
  if (!(pressed & SCE_CTRL_CROSS)) return;
  if(builderSelection==0)addSegment(0);
  else if(builderSelection==1)addSegment(-1);
  else if(builderSelection==2)addSegment(1);
  else if(builderSelection==3)std::snprintf(builderStatus,sizeof(builderStatus),"TURN RADIUS %d M",turnRadii[turnRadiusChoice]);
  else if(builderSelection==4&&segmentCount>0){--segmentCount;rebuildCustomTrack();std::snprintf(builderStatus,sizeof(builderStatus),"UNDO - %d PIECES",segmentCount);}
  else if(builderSelection==5){segmentCount=0;rebuildCustomTrack();std::snprintf(builderStatus,sizeof(builderStatus),"TRACK CLEARED");}
  else if(builderSelection==6){if(segmentCount>0){driveEnvironment=DriveEnvironment::CustomTrack;resetCarToTrack();gameMode=GameMode::Driving;}else std::snprintf(builderStatus,sizeof(builderStatus),"ADD ROAD FIRST");}
  else if(builderSelection==7)std::snprintf(builderStatus,sizeof(builderStatus),"SLOT %d",currentTrackSlot+1);
  else if(builderSelection==8)saveTrack();
  else if(builderSelection==9)loadTrack();
  else if(builderSelection==10)gameMode=GameMode::Menu;
}

bool cameraPathClear(float cameraX,float cameraY,float cameraZ){
  if(driveEnvironment!=DriveEnvironment::City)return true;
  for(int sample=2;sample<=24;++sample){
    float t=(float)sample/24.0f;
    float x=car.x+(cameraX-car.x)*t,z=car.z+(cameraZ-car.z)*t;
    float y=1.0f+(cameraY-1.0f)*t;
    for(const CityBuilding& building:CITY_BUILDINGS){
      if(y>building.height+1.0f)continue;
      if(std::fabs(x-building.x)<building.width*.5f+.55f&&
         std::fabs(z-building.z)<building.depth*.5f+.55f)return false;
    }
  }
  return true;
}

void collisionAwareCamera(float distance,float height,float& outputX,float& outputZ){
  auto clearAt=[&](float offset){float yaw=cameraYaw+offset;return cameraPathClear(car.x-std::sin(yaw)*distance,height,car.z-std::cos(yaw)*distance);};
  bool straightClear=clearAt(0.0f);
  if(std::fabs(cameraAvoidanceTarget)>.01f){cameraStraightClearFrames=straightClear?cameraStraightClearFrames+1:0;if(cameraStraightClearFrames>24){cameraAvoidanceTarget=0.0f;cameraStraightClearFrames=0;}}
  else if(!straightClear){static const float offsets[]={.24f,-.24f,.46f,-.46f,.70f,-.70f,.94f,-.94f};for(float offset:offsets)if(clearAt(offset)){cameraAvoidanceTarget=offset;break;}}
  if(std::fabs(cameraAvoidanceTarget)>.01f&&!clearAt(cameraAvoidanceTarget)){static const float offsets[]={.24f,-.24f,.46f,-.46f,.70f,-.70f,.94f,-.94f};for(float offset:offsets)if(clearAt(offset)){cameraAvoidanceTarget=offset;break;}}
  cameraAvoidanceAngle+=(cameraAvoidanceTarget-cameraAvoidanceAngle)*.11f;if(std::fabs(cameraAvoidanceAngle)<.002f)cameraAvoidanceAngle=0.0f;
  float yaw=cameraYaw+cameraAvoidanceAngle,desiredX=car.x-std::sin(yaw)*distance,desiredZ=car.z-std::cos(yaw)*distance,safeTarget=1.0f;
  if(!cameraPathClear(desiredX,height,desiredZ)){safeTarget=.12f;for(int sample=4;sample<=32;++sample){float t=(float)sample/32.0f,x=car.x+(desiredX-car.x)*t,z=car.z+(desiredZ-car.z)*t;if(!cameraPathClear(x,height,z))break;safeTarget=t;}}
  if(safeTarget<cameraDistanceScale)cameraDistanceScale=safeTarget;else cameraDistanceScale+=(safeTarget-cameraDistanceScale)*.09f;if(cameraDistanceScale>.998f)cameraDistanceScale=1.0f;
  outputX=car.x+(desiredX-car.x)*cameraDistanceScale;outputZ=car.z+(desiredZ-car.z)*cameraDistanceScale;
}

void constrainPersonCamera(float anchorX,float anchorY,float anchorZ,float&eyeX,float&eyeY,float&eyeZ){
  if(driveEnvironment==DriveEnvironment::City){float safe=1.0f;for(int sample=2;sample<=30;++sample){float t=(float)sample/30.0f,x=anchorX+(eyeX-anchorX)*t,y=anchorY+(eyeY-anchorY)*t,z=anchorZ+(eyeZ-anchorZ)*t;bool blocked=false;for(const CityBuilding&building:CITY_BUILDINGS)if(y<building.height+.5f&&std::fabs(x-building.x)<building.width*.5f+.38f&&std::fabs(z-building.z)<building.depth*.5f+.38f){blocked=true;break;}if(blocked){safe=std::max(.10f,t-.07f);break;}}eyeX=anchorX+(eyeX-anchorX)*safe;eyeY=anchorY+(eyeY-anchorY)*safe;eyeZ=anchorZ+(eyeZ-anchorZ)*safe;}eyeY=std::max(.32f,eyeY);
}

float planeDistanceToPerson(){float dx=person.x-plane.x,dz=person.z-plane.z;return std::sqrt(dx*dx+dz*dz);}
void resetPlane(){plane=PlaneState{};}

// Fixed-storage arcade flight model: velocity is autonomous after bailout, while
// orientation drives airspeed lift/drag/gravity so it cannot hover or static-drop.
void updatePlane(float dt,const SceCtrlData&pad,bool controlled){
  if(!plane.active){plane.respawn-=dt;if(plane.respawn<=0)resetPlane();return;}
  // Vita's left-stick axis is screen-oriented while this aircraft's yaw basis
  // is world-oriented; negate it so physical left now banks/yaws left in view.
  const float rawYaw=controlled?-((int)pad.lx-128)/127.0f:0.0f;
  // Vita reports stick-up below center; positive pitch is nose-up throughout
  // the flight model, renderer, and chase camera.
  const float rawPitch=controlled?((int)pad.ry-128)/127.0f:0.0f;
  const float yawInput=std::fabs(rawYaw)<.14f?0.0f:rawYaw;
  const float pitchInput=std::fabs(rawPitch)<.14f?0.0f:rawPitch;
  // R is hold-to-gas and L is hold-to-brake. Do not retain a stale throttle
  // after release: off-gas flight must be a genuine glide.
  const bool gasHeld=controlled&&(pad.buttons&SCE_CTRL_RTRIGGER);
  const bool brakeHeld=controlled&&(pad.buttons&SCE_CTRL_LTRIGGER);
  plane.throttle=gasHeld?1.0f:0.0f;
  const float throttle=plane.throttle;
  float airspeed=std::sqrt(plane.vx*plane.vx+plane.vy*plane.vy+plane.vz*plane.vz);
  // Negative left-stick input is a left yaw and left bank; keep the two signs paired.
  plane.yaw+=yawInput*dt*(.30f+clampf(airspeed,0.0f,60.0f)*.018f);
  plane.roll+=(yawInput*.78f-plane.roll)*clampf(dt*4.4f,0.0f,1.0f); // response rate improved; preserved bank target contract
  // Mild self-centering makes runway alignment and landing approaches less twitchy
  // without removing direct pilot authority or changing the verified trigger mapping.
  if(!yawInput)plane.roll+=(0.0f-plane.roll)*clampf(dt*.55f,0.0f,.04f);
  if(plane.airborne){
    // Direct pilot authority is stronger than neutral stability; release centers
    // naturally but never fights an active pitch command.
    plane.pitch+=pitchInput*dt*1.78f;
    if(!pitchInput)plane.pitch+=(0.0f-plane.pitch)*clampf(dt*.34f,0.0f,.03f);
    plane.pitch=clampf(plane.pitch,-.78f,.78f);
  }else plane.pitch+=(pitchInput*.46f-plane.pitch)*clampf(dt*3.4f,0.0f,1.0f);
  const float cp=std::cos(plane.pitch),fx=std::sin(plane.yaw)*cp,fy=std::sin(plane.pitch),fz=std::cos(plane.yaw)*cp;
  if(!plane.airborne){
    float groundForward=plane.vx*std::sin(plane.yaw)+plane.vz*std::cos(plane.yaw);
    // Hold R accelerates from rest; L actively decelerates instead of merely
    // clearing gas. This remains observable through THR and SPD on the HUD.
    const float runwayForce=throttle*21.0f-(brakeHeld?28.0f:0.0f)-.28f*groundForward;
    groundForward=clampf(groundForward+runwayForce*dt,0.0f,50.0f);
    plane.vx=std::sin(plane.yaw)*groundForward;plane.vz=std::cos(plane.yaw)*groundForward;plane.vy=0.0f;plane.speed=groundForward;
    if(groundForward>20.0f&&pitchInput>.10f){plane.airborne=true;plane.vy=2.4f;}
  }else{
    // Thrust, drag and gravity operate on persistent world velocity.  A modest
    // steering alignment makes aerobatics responsive without erasing inertia.
    const float airBrake=brakeHeld?20.0f:0.0f;
    // Powered flight has enough thrust to climb and turn; airbrake remains a
    // deliberate deceleration rather than an implicit glider state.
    plane.vx+=fx*(throttle*20.0f-airBrake)*dt;plane.vy+=fy*(throttle*20.0f-airBrake)*dt;plane.vz+=fz*(throttle*20.0f-airBrake)*dt;
    airspeed=std::sqrt(plane.vx*plane.vx+plane.vy*plane.vy+plane.vz*plane.vz);
    // Gentle velocity alignment retains momentum through bailout and lets pitch
    // genuinely control loops, rather than snapping the craft into a hover.
    const float align=clampf(dt*(.24f+airspeed*.008f),0.0f,.055f);
    plane.vx+=(fx*airspeed-plane.vx)*align;plane.vy+=(fy*airspeed-plane.vy)*align;plane.vz+=(fz*airspeed-plane.vz)*align;
    const float liftFactor=clampf((airspeed-13.0f)/38.0f,0.0f,1.0f);
    const bool stalled=airspeed<16.0f&&plane.pitch>.45f;
    // Wing lift plus a modest powered-climb contribution makes throttle useful
    // without allowing hover; loss of airspeed still produces a real descent.
    const float lift=(1.2f+11.6f*liftFactor)*std::max(.0f,cp)*(stalled?.22f:1.0f)+throttle*1.8f;
    plane.vy+=(lift-9.8f)*dt;
    const float drag=clampf(1.0f-dt*(.024f+airspeed*.0032f+std::fabs(plane.pitch)*.013f+(stalled?.055f:0.0f)),.72f,1.0f);
    plane.vx*=drag;plane.vy*=drag;plane.vz*=drag;
    airspeed=std::sqrt(plane.vx*plane.vx+plane.vy*plane.vy+plane.vz*plane.vz);
    if(airspeed>90.0f){const float scale=90.0f/airspeed;plane.vx*=scale;plane.vy*=scale;plane.vz*=scale;airspeed=90.0f;}
    plane.speed=airspeed;
  }
  plane.x+=plane.vx*dt;plane.z+=plane.vz*dt;plane.y+=plane.vy*dt;
  if(driveEnvironment==DriveEnvironment::City&&plane.y<34.0f){
    for(const CityBuilding&building:CITY_BUILDINGS){
      if(plane.y>building.height+.7f||std::fabs(plane.x-building.x)>building.width*.5f+1.1f||std::fabs(plane.z-building.z)>building.depth*.5f+2.3f)continue;
      damagePlane(140.0f,plane.x-plane.vx,plane.z-plane.vz);return;
    }
  }
  if(plane.y<=0.0f){
    const float impact=-plane.vy;plane.y=0.0f;plane.vy=0.0f;
    // A shallow touchdown rolls out; a hard/downside impact destroys the plane.
    if(plane.airborne&&impact>9.5f){damagePlane((impact-7.0f)*11.0f,plane.x-plane.vx,plane.z-plane.vz);if(!plane.active)return;}
    // Touchdown damping is a one-shot impact response. Applying it every
    // grounded frame erased R-trigger runway acceleration and mimicked dead gas.
    if(plane.active&&plane.airborne){plane.airborne=false;plane.pitch*=.22f;plane.roll*=.38f;plane.vx*=.76f;plane.vz*=.76f;plane.speed=std::sqrt(plane.vx*plane.vx+plane.vz*plane.vz);}
  }
  // City bounds are content bounds, not aircraft death walls. Only an extreme
  // safety radius recovers a lost aircraft, after ample space to turn home.
  float planeRadius=std::sqrt(plane.x*plane.x+plane.z*plane.z);
  if(plane.y>PLANE_CEILING){plane.y=PLANE_CEILING;plane.vy=std::min(plane.vy,0.0f);}
  if(planeRadius>PLANE_SAFE_WORLD_RADIUS)damagePlane(120.0f,plane.x-plane.vx,plane.z-plane.vz);
}

void renderGame() {
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glMatrixMode(GL_PROJECTION);



  glLoadIdentity();
  float fov=playerControlMode==PlayerControlMode::OnFoot?(person.cameraMode==1?72.0f:60.0f):(cameraMode==1?55.0f:(cameraMode==2?52.0f:(cameraMode==3?58.0f:(cameraMode==4?62.0f:48.0f))));
  gluPerspective(fov, 960.0f / 544.0f, 0.1f, 480.0f);
  glMatrixMode(GL_MODELVIEW);
  glLoadIdentity();

  if(playerControlMode==PlayerControlMode::OnFoot){
    // aimRecoil is positive-up and only affects the view; it decays to neutral.
    float renderedPitch=clampf(person.viewPitch+aimRecoil,-1.35f,1.35f);
    float cp=std::cos(renderedPitch),sp=std::sin(renderedPitch);
    float dirX=std::sin(person.viewYaw)*cp,dirY=sp,dirZ=std::cos(person.viewYaw)*cp;
    float upX=-std::sin(person.viewYaw)*sp,upY=cp,upZ=-std::cos(person.viewYaw)*sp;
    float bobY=std::sin(walkBob*2.0f)*.045f;
    float bobX=std::cos(walkBob)*.02f;
    float shakeX=(shootShake>0?std::sin(walkBob*30.0f)*shootShake*.12f:0.0f);
    float shakeY=(shootShake>0?std::cos(walkBob*27.0f)*shootShake*.08f:0.0f);
    float anchorX=person.x+bobX+shakeX,anchorY=person.y+1.66f+bobY+shakeY,anchorZ=person.z;
    if(person.cameraMode==1){
      // True eye-height FPS with head bob and recoil kick already in pitch.
      gluLookAt(anchorX,anchorY,anchorZ,anchorX+dirX*24,anchorY+dirY*24,anchorZ+dirZ*24,upX,upY,upZ);
    }else{
      // Closer over-shoulder third person (less floaty / top-down).
      float horizontalX=std::sin(person.viewYaw),horizontalZ=std::cos(person.viewYaw);
      float eyeX=person.x-horizontalX*4.8f+std::cos(person.viewYaw)*.85f;
      float eyeY=person.y+2.15f+bobY*.5f;
      float eyeZ=person.z-horizontalZ*4.8f-std::sin(person.viewYaw)*.85f;
      constrainPersonCamera(anchorX,anchorY,anchorZ,eyeX,eyeY,eyeZ);
      gluLookAt(eyeX,eyeY,eyeZ,anchorX+dirX*10,anchorY+dirY*8+.15f,anchorZ+dirZ*10,0,1,0);
    }
  }else if(playerControlMode==PlayerControlMode::Aircraft){
    // Level chase camera: it follows yaw but intentionally ignores aircraft
    // pitch/bank, keeping the horizon steady while the plane maneuvers.
    float fx=std::sin(plane.yaw),fz=std::cos(plane.yaw);
    gluLookAt(plane.x-fx*13,plane.y+5.0f,plane.z-fz*13,
              plane.x+fx*26,plane.y+2.2f,plane.z+fz*26,0,1,0);
  }else if(cameraMode==3||cameraMode==4){
    float fx=std::sin(car.yaw),fz=std::cos(car.yaw),rx=std::cos(car.yaw),rz=-std::sin(car.yaw);
    float cameraPitch=car.bodyPitch+carTerrainPitch,cameraRoll=car.bodyRoll+carTerrainRoll;
    float cp=std::cos(cameraPitch),sp=std::sin(cameraPitch),cr=std::cos(cameraRoll),sr=std::sin(cameraRoll);
    float fpx=fx*cp,fpy=-sp,fpz=fz*cp,upx=fx*sp,upy=cp,upz=fz*sp;
    float bodyUpX=upx*cr-rx*sr,bodyUpY=upy*cr,bodyUpZ=upz*cr-rz*sr;
    float bodyRightX=rx*cr+upx*sr,bodyRightY=upy*sr,bodyRightZ=rz*cr+upz*sr;
    // Cam 4 sits just ahead of the windshield and low enough to keep the hood
    // in the bottom of frame. Cam 5 sits at the left-hand driver's head.
    float forwardOffset=cameraMode==3?.86f:-.10f,upOffset=cameraMode==3?.66f:.78f,lateralOffset=cameraMode==4?-.52f:0.0f;
    float eyeX=car.x+fpx*forwardOffset+bodyUpX*upOffset+bodyRightX*lateralOffset;
    float eyeY=carGroundHeight+carAirOffset+.55f+fpy*forwardOffset+bodyUpY*upOffset+bodyRightY*lateralOffset;
    float eyeZ=car.z+fpz*forwardOffset+bodyUpZ*upOffset+bodyRightZ*lateralOffset;
    float downLook=cameraMode==3?.06f:.01f,lookX=fpx-bodyUpX*downLook,lookY=fpy-bodyUpY*downLook,lookZ=fpz-bodyUpZ*downLook;
    gluLookAt(eyeX,eyeY,eyeZ,eyeX+lookX*28,eyeY+lookY*28,eyeZ+lookZ*28,bodyUpX,bodyUpY,bodyUpZ);
  }else{
    float distance=cameraMode==1?8.5f:(cameraMode==2?13.0f:15.0f);
    float height=cameraMode==1?4.8f:(cameraMode==2?18.0f:8.2f);
    float desiredX=car.x,desiredZ=car.z;
    collisionAwareCamera(distance,height,desiredX,desiredZ);
    gluLookAt(desiredX,height+carGroundHeight+carAirOffset,desiredZ,car.x,1.0f+carGroundHeight+carAirOffset,car.z,0,1,0);
  }

  drawSky();
  if(driveEnvironment==DriveEnvironment::City)drawCity();
  else{drawGround();drawTrack();}
  drawSkidMarks();
  drawSmoke();
  drawRocketsAndExplosions();
  // City owns the aircraft's cull against the active camera focus; drawing it
  // again here used to double-submit the aircraft each City frame.
  if(driveEnvironment!=DriveEnvironment::City)drawPlane();
  if(playerControlMode==PlayerControlMode::OnFoot){drawCar();if(person.cameraMode==0){drawPerson();drawWeaponWorld();}}
  else if(playerControlMode==PlayerControlMode::Vehicle&&cameraMode!=4){
    if(occupiedSandboxVehicle>=0)drawPlayerSandboxVehicle(); else drawCar();
  }
  beginOverlay();
  if(playerControlMode==PlayerControlMode::OnFoot)drawOnFootHud();
  else if(playerControlMode==PlayerControlMode::Aircraft){char planeHud[48];std::snprintf(planeHud,sizeof(planeHud),"AIRCRAFT HP %d  SPD %d",(int)plane.health,(int)plane.speed);drawRect(22,20,340,64,.10f,.13f,.14f);drawLabel(38,32,planeHud,1.55f);drawRect(185,486,775,528,.10f,.13f,.14f);drawLabel(202,499,"R THROTTLE L BRAKE  LEFT STICK YAW/BANK  RIGHT STICK PITCH",1.02f);}
  else{if(cameraMode==4)drawCockpitOverlay();drawHud();}
  if(driveEnvironment==DriveEnvironment::City)drawChaosHud();
  endOverlay();
  maybeStreamFrame();
  vglSwapBuffers(GL_FALSE);
}
}

int main() {
  sceCtrlSetSamplingMode(SCE_CTRL_MODE_ANALOG);
  sceTouchSetSamplingState(SCE_TOUCH_PORT_FRONT,SCE_TOUCH_SAMPLING_STATE_START);
  sceTouchGetPanelInfo(SCE_TOUCH_PORT_FRONT,&frontTouchInfo);
  vglInit(0x1000000);
  glClearColor(0.30f, 0.48f, 0.64f, 1.0f);
  glEnable(GL_DEPTH_TEST);
  glDepthFunc(GL_LEQUAL);
  glDisable(GL_TEXTURE_2D);
  glDisable(GL_LIGHTING);
  loadEnvironmentTexture();
  loadJpegTexture("app0:assets/cockpit-dashboard.jpg",cockpitTexture);
  initWifiBridge();
  buildFigure8Track();
  loadSteeringSetting();
  loadCustomization();

  uint64_t last = sceKernelGetProcessTimeWide();
  uint32_t previousButtons = 0;
  while (running) {
    SceCtrlData pad{};
    sceCtrlPeekBufferPositive(0, &pad, 1);
    SceTouchData touch{};
    sceTouchPeek(SCE_TOUCH_PORT_FRONT,&touch,1);
    bool touchDown=touch.reportNum>0;
    if(gameMode==GameMode::Driving&&playerControlMode==PlayerControlMode::Vehicle&&touchDown&&!hudTouchWasDown){
      float touchSpanX=std::max(1,(int)frontTouchInfo.maxDispX-(int)frontTouchInfo.minDispX);
      float touchSpanY=std::max(1,(int)frontTouchInfo.maxDispY-(int)frontTouchInfo.minDispY);
      float tx=(touch.report[0].x-frontTouchInfo.minDispX)*960.0f/touchSpanX;
      float ty=(touch.report[0].y-frontTouchInfo.minDispY)*544.0f/touchSpanY;
      float touchRight=hudShowsMinimap?292.0f:252.0f,touchBottom=hudShowsMinimap?128.0f:112.0f;
      if(tx>=22&&tx<=touchRight&&ty>=20&&ty<=touchBottom)hudShowsMinimap=!hudShowsMinimap;
    }
    hudTouchWasDown=touchDown;
    pollWifiBridge();
    mergeRemoteInput(pad);
    uint64_t now = sceKernelGetProcessTimeWide();
    float dt = clampf((now - last) / 1000000.0f, 0.001f, 0.033f);
    last = now;
    uint32_t pressed = pad.buttons & ~previousButtons;
    if (gameMode == GameMode::Menu) {
      if (pressed & SCE_CTRL_UP) menuSelection=(menuSelection+4)%5;
      if (pressed & SCE_CTRL_DOWN) menuSelection=(menuSelection+1)%5;
      if (pressed & SCE_CTRL_CROSS) {
        if (menuSelection == 0) {
          buildFigure8Track();
          gameMode = GameMode::Driving;
        } else if(menuSelection==1) {
          segmentCount = 0;
          rebuildCustomTrack();
          builderSelection = 0;
          std::snprintf(builderStatus,sizeof(builderStatus),"BUILD YOUR TRACK");
          gameMode = GameMode::BuildTrack;
        } else if(menuSelection==2) {
          driveEnvironment=DriveEnvironment::City;
          cityPropsInitialized=false;initCityProps();
          resetDestruction();resetSandboxLife();initSandboxLife();
          resetCarToTrack();
          gameMode=GameMode::Driving;
        } else if(menuSelection==3){customizeSelection=0;gameMode=GameMode::Customize;}
        else gameMode=GameMode::Settings;
      }
      drawMenu();
    } else if(gameMode==GameMode::Customize){
      updateCustomize(pressed);drawCustomize();
    } else if(gameMode==GameMode::Settings){
      if(pressed&SCE_CTRL_LEFT){steeringAngleDegrees=clampf(steeringAngleDegrees-2.0f,24.0f,52.0f);saveSteeringSetting();}
      if(pressed&SCE_CTRL_RIGHT){steeringAngleDegrees=clampf(steeringAngleDegrees+2.0f,24.0f,52.0f);saveSteeringSetting();}
      if(pressed&SCE_CTRL_SQUARE){steeringAngleDegrees=DEFAULT_STEERING_ANGLE_DEGREES;saveSteeringSetting();}
      if(pressed&(SCE_CTRL_START|SCE_CTRL_CIRCLE))gameMode=GameMode::Menu;
      drawSettings();
    } else if (gameMode == GameMode::BuildTrack) {
      updateBuilder(pressed);
      drawBuilder();
    } else {
      if (pressed & SCE_CTRL_START) gameMode = GameMode::Menu;
      if(playerControlMode==PlayerControlMode::Vehicle){
        if (pressed & SCE_CTRL_SELECT){cameraMode=(cameraMode+1)%5;cameraDistanceScale=1.0f;}
        if (pressed & SCE_CTRL_TRIANGLE){resetCarToTrack();occupiedSandboxVehicle=-1;activeVehicleKind=SandboxVehicleKind::Car;}
        if(pressed&SCE_CTRL_SQUARE)exitToOnFootFromVehicle();
        if(playerControlMode==PlayerControlMode::Vehicle)updateCar(dt,pad);
      }else if(playerControlMode==PlayerControlMode::Aircraft){
        if(pressed&SCE_CTRL_SQUARE){
          // Bailout inherits plane world velocity; updatePlane continues below.
          playerControlMode=PlayerControlMode::OnFoot;person.x=plane.x;person.z=plane.z;person.y=plane.y;person.verticalVelocity=plane.vy;
        } else updatePlane(dt,pad,true);
      }else{
        if(pressed&SCE_CTRL_SELECT)person.cameraMode=(person.cameraMode+1)%2;
        if(pressed&SCE_CTRL_SQUARE){
          if(!tryEnterNearbySandboxVehicle()){
            if(personDistanceToCar()<=3.25f)enterVehicle();
            else if(plane.active&&planeDistanceToPerson()<=4.0f){playerControlMode=PlayerControlMode::Aircraft;}
          }
        }
        if(playerControlMode==PlayerControlMode::OnFoot){
          if(pressed&SCE_CTRL_TRIANGLE)selectedWeapon=selectedWeapon==WeaponType::RocketLauncher?WeaponType::MachineGun:WeaponType::RocketLauncher;
          if(selectedWeapon==WeaponType::RocketLauncher){if(pressed&SCE_CTRL_RTRIGGER)fireRocket();}
          else if((pad.buttons&SCE_CTRL_RTRIGGER)&&machineGunCooldown<=0){fireMachineGun();machineGunCooldown=(pad.buttons&SCE_CTRL_LTRIGGER)?.055f:.07f;}
          updatePerson(dt,pad,pressed);
          updateUnoccupiedCar(dt);
        }
      }
      // An unoccupied aircraft remains a live body: it glides, descends and
      // lands/crashes instead of freezing when the pilot jumps out.
      if(playerControlMode!=PlayerControlMode::Aircraft)updatePlane(dt,pad,false);
      if(driveEnvironment==DriveEnvironment::City){
        updateCityProps(dt);updateTraffic(dt);updatePedestrians(dt);
        updateDynamicParked(dt);updateSandboxVehicles(dt,pad,pressed);
        // Collapse animation + chaos combo decay.
        for(int bi=0;bi<CITY_BUILDING_COUNT;++bi)if(buildingCollapsed[bi]&&buildingCollapse[bi]<1.0f)buildingCollapse[bi]=clampf(buildingCollapse[bi]+dt*.55f,0.0f,1.0f);
        if(chaosDecay>0){chaosDecay-=dt;if(chaosDecay<=0)chaosCombo=std::max(1.0f,chaosCombo-dt*1.8f);}
        else chaosCombo=std::max(1.0f,chaosCombo-dt*.35f);
      }
      updateRocketsAndExplosions(dt);
      updateCarAir(dt);
      renderGame();
    }
    previousButtons = pad.buttons;
  }
  sceKernelExitProcess(0);
  return 0;
}
