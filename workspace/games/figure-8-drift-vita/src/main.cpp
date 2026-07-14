#include <vitaGL.h>
#include <psp2/ctrl.h>
#include <psp2/kernel/processmgr.h>
#include <psp2/kernel/threadmgr.h>
#include <psp2/io/dirent.h>
#include <psp2/io/fcntl.h>
#include <psp2/io/stat.h>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace {
constexpr float PI = 3.14159265358979323846f;
constexpr float ROAD_HALF = 6.0f;
constexpr int MAX_TRACK_SAMPLES = 1400;
constexpr int FIGURE8_SAMPLES = 360;
constexpr int MAX_SEGMENTS = 64;

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
bool running = true;
enum class GameMode { Menu, Driving, BuildTrack };
GameMode gameMode = GameMode::Menu;
int menuSelection = 0;
int builderSelection = 0;
constexpr int BUILDER_OPTION_COUNT = 9;
int straightChoice = 1;
int turnAngleChoice = 3;
int turnRadiusChoice = 1;
float builderCameraX = 0.0f;
float builderCameraZ = -15.0f;
float builderCameraTargetX = 0.0f;
float builderCameraTargetZ = 0.0f;
char builderStatus[40] = "BUILD YOUR TRACK";
constexpr const char* TRACK_SAVE_PATH = "ux0:data/figure8-drift/track.dat";

constexpr int MAX_SKID_POINTS = 1400;
struct SkidPoint { float lx, lz, rx, rz, alpha; };
SkidPoint skidPoints[MAX_SKID_POINTS];
int skidStart = 0;
int skidCount = 0;
float skidEmitDistance = 0.0f;

void addSkidPoint(float lateral, float forward);
void drawSkidMarks();

float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
void resetCarToTrack() {
  car = CarState{};
  car.x = track[0].x;
  car.z = track[0].z;
  if (trackSampleCount > 1)
    car.yaw = std::atan2(track[1].x - track[0].x, track[1].z - track[0].z);
  cameraOrbit = 0.0f;
  cameraYaw = car.yaw;
}

void buildFigure8Track() {
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
bool saveTrack() {
  if (segmentCount <= 0) { std::snprintf(builderStatus,sizeof(builderStatus),"NOTHING TO SAVE"); return false; }
  sceIoMkdir("ux0:data/figure8-drift", 0777);
  FILE* f=std::fopen(TRACK_SAVE_PATH,"wb");
  if(!f){std::snprintf(builderStatus,sizeof(builderStatus),"SAVE FAILED");return false;}
  TrackSaveHeader h{{'F','8','T','R','A','C','K','1'},1,segmentCount};
  bool ok=std::fwrite(&h,sizeof(h),1,f)==1 && std::fwrite(segments,sizeof(TrackSegment),segmentCount,f)==(size_t)segmentCount;
  std::fclose(f);
  std::snprintf(builderStatus,sizeof(builderStatus),ok?"TRACK SAVED":"SAVE FAILED");
  return ok;
}
bool loadTrack() {
  FILE* f=std::fopen(TRACK_SAVE_PATH,"rb");
  if(!f){std::snprintf(builderStatus,sizeof(builderStatus),"NO SAVED TRACK");return false;}
  TrackSaveHeader h{};
  bool ok=std::fread(&h,sizeof(h),1,f)==1 && std::memcmp(h.magic,"F8TRACK1",8)==0 && h.version==1 && h.count>0 && h.count<=MAX_SEGMENTS;
  if(ok){segmentCount=h.count;ok=std::fread(segments,sizeof(TrackSegment),segmentCount,f)==(size_t)segmentCount;}
  std::fclose(f);
  if(ok){rebuildCustomTrack();std::snprintf(builderStatus,sizeof(builderStatus),"TRACK LOADED");}
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

  // Keep the established acceleration and speed envelope. Drive force acts at
  // the car heading, while the axle model can move the chassis sideways.
  float acceleration = throttle * 43.0f - brake * 38.0f;
  if (brake && forward < 1.0f) acceleration = -brake * 15.0f;
  car.vx += fx * acceleration * dt;
  car.vz += fz * acceleration * dt;
  float rolling = std::pow(0.991f, dt * 60.0f);
  car.vx *= rolling;
  car.vz *= rolling;
  forward = car.vx * fx + car.vz * fz;
  if (forward > 40.0f) { car.vx -= fx * (forward - 40.0f); car.vz -= fz * (forward - 40.0f); forward = 40.0f; }
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
  float maxSteer = 0.58f + (0.38f - 0.58f) * speedRatio;
  float steerTarget = steerShaped * maxSteer;
  car.steerAngle += (steerTarget - car.steerAngle) * clampf(dt * 13.0f, 0.0f, 1.0f);

  // Throttle can progressively loosen the tail in a committed corner. Circle
  // releases it further, while retaining enough rear force to catch the slide.
  float cornerLoad = clampf((steerAmount - 0.30f) / 0.70f, 0.0f, 1.0f)
                   * clampf((std::fabs(forward) - 7.0f) / 17.0f, 0.0f, 1.0f);
  float rearGripTarget = handbrake ? 0.34f : (1.0f - cornerLoad * (throttle > 0.0f ? 0.34f : 0.16f));
  float rearGripRate = handbrake ? 12.0f : 10.0f;
  car.rearGripBlend += (rearGripTarget - car.rearGripBlend) * clampf(dt * rearGripRate, 0.0f, 1.0f);

  float frontYaw = car.yaw + car.steerAngle;
  float frx = std::cos(frontYaw), frz = -std::sin(frontYaw);
  float frontVx = car.vx + rx * car.yawRate * frontAxle;
  float frontVz = car.vz + rz * car.yawRate * frontAxle;
  float rearVx = car.vx - rx * car.yawRate * rearAxle;
  float rearVz = car.vz - rz * car.yawRate * rearAxle;
  float frontSlip = frontVx * frx + frontVz * frz;
  float rearSlip = rearVx * rx + rearVz * rz;

  float frontForce = clampf(-frontSlip * 4.2f, -28.0f, 28.0f);
  float rearForce = clampf(-rearSlip * (4.8f * car.rearGripBlend), -32.0f, 32.0f);
  car.vx += (frx * frontForce * 0.45f + rx * rearForce * 0.40f) * dt;
  car.vz += (frz * frontForce * 0.45f + rz * rearForce * 0.40f) * dt;

  // Use bicycle geometry as the primary yaw command. Axle-force torque is only
  // a small slide influence, so it cannot cancel steering or create endless spin.
  float direction = forward < -0.2f ? -1.0f : 1.0f;
  float turnSpeed = std::max(std::fabs(forward), 2.5f);
  float desiredYawRate = direction * (turnSpeed / wheelbase) * std::tan(car.steerAngle) * 0.90f;
  if (handbrake) desiredYawRate *= 1.16f;
  desiredYawRate = clampf(desiredYawRate, -2.05f, 2.05f);
  float axleYawInfluence = (frontForce * frontAxle - rearForce * rearAxle) / 55.0f;
  car.yawRate += axleYawInfluence * dt;
  float yawAuthority = handbrake ? 5.0f : 8.5f;
  car.yawRate += (desiredYawRate - car.yawRate) * clampf(dt * yawAuthority, 0.0f, 1.0f);
  car.yawRate *= std::pow(handbrake ? 0.994f : 0.997f, dt * 60.0f);
  car.yawRate = clampf(car.yawRate, -2.20f, 2.20f);
  if (std::fabs(forward) < 0.7f) car.yawRate *= std::pow(0.84f, dt * 60.0f);
  car.yaw += car.yawRate * dt;

  if (handbrake) {
    // Rear grip release adds no energy and keeps the previous mild speed loss.
    car.vx *= std::pow(0.993f, dt * 60.0f);
    car.vz *= std::pow(0.993f, dt * 60.0f);
  }

  // Re-sample chassis-space motion for scoring, tire marks and body roll.
  fx = std::sin(car.yaw); fz = std::cos(car.yaw);
  rx = std::cos(car.yaw); rz = -std::sin(car.yaw);
  forward = car.vx * fx + car.vz * fz;
  lateral = car.vx * rx + car.vz * rz;
  float rollTarget = clampf(-car.yawRate * 0.075f + lateral * 0.009f, -0.18f, 0.18f);
  car.bodyRoll += (rollTarget - car.bodyRoll) * clampf(dt * 7.0f, 0.0f, 1.0f);

  car.x += car.vx * dt;
  car.z += car.vz * dt;

  float roadDist = trackDistance(car.x, car.z);
  bool drifting = std::fabs(lateral) > 1.5f && std::fabs(forward) > 7.0f && (handbrake || std::fabs(steer) > 0.2f);
  if (drifting && roadDist < ROAD_HALF + 1.5f) {
    car.combo = clampf(car.combo + dt * 0.55f, 1.0f, 5.0f);
    car.score += std::fabs(lateral * forward) * 0.052f * car.combo;
  } else {
    car.combo = clampf(car.combo - dt * 0.9f, 1.0f, 5.0f);
  }
  if (roadDist > ROAD_HALF + 2.0f) {
    car.vx *= std::pow(0.94f, dt * 60.0f);
    car.vz *= std::pow(0.94f, dt * 60.0f);
  }
  addSkidPoint(lateral, forward);
  // Right stick temporarily orbits the chase camera. Releasing it springs the
  // camera back behind the car quickly, rather than leaving a persistent offset.
  float cameraStick = ((int)pad.rx - 128) / 127.0f;
  if (std::fabs(cameraStick) < 0.14f) cameraStick = 0.0f;
  if (cameraStick != 0.0f)
    cameraOrbit = clampf(cameraOrbit + cameraStick * dt * 3.0f, -2.35f, 2.35f);
  else
    cameraOrbit += (0.0f - cameraOrbit) * clampf(dt * 12.0f, 0.0f, 1.0f);
  if (std::fabs(cameraOrbit) < 0.002f) cameraOrbit = 0.0f;
  float cameraTarget = car.yaw + cameraOrbit;
  float cameraDelta = std::atan2(std::sin(cameraTarget - cameraYaw), std::cos(cameraTarget - cameraYaw));
  cameraYaw += cameraDelta * clampf(dt * 10.0f, 0.0f, 1.0f);
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
  skidPoints[index]={car.x-rx*.82f-fx*1.18f,car.z-rz*.82f-fz*1.18f,car.x+rx*.82f-fx*1.18f,car.z+rz*.82f-fz*1.18f,clampf(std::fabs(lateral)/7.0f,.28f,.82f)};
}

void drawSkidMarks() {
  glLineWidth(3.0f);glBegin(GL_LINES);
  for(int n=1;n<skidCount;++n){
    const SkidPoint&a=skidPoints[(skidStart+n-1)%MAX_SKID_POINTS];const SkidPoint&b=skidPoints[(skidStart+n)%MAX_SKID_POINTS];
    float dx=b.lx-a.lx,dz=b.lz-a.lz;if(dx*dx+dz*dz>16.0f)continue;
    float shade=.025f+(1.0f-b.alpha)*.04f;glColor3f(shade,shade,shade);
    glVertex3f(a.lx,.047f,a.lz);glVertex3f(b.lx,.047f,b.lz);glVertex3f(a.rx,.047f,a.rz);glVertex3f(b.rx,.047f,b.rz);
  }
  glEnd();
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

void drawTrack() {
  glDisable(GL_CULL_FACE);
  glColor3f(0.14f, 0.15f, 0.16f);
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
    glVertex3f(track[i].x + nx0, .015f, track[i].z + nz0);
    glVertex3f(track[i].x - nx0, .015f, track[i].z - nz0);
    glVertex3f(track[j].x - nx1, .015f, track[j].z - nz1);
    glVertex3f(track[j].x + nx1, .015f, track[j].z + nz1);
  }
  glEnd();
  glColor3f(0.92f, 0.76f, 0.28f);
  glBegin(GL_LINES);
  for (int i = 0; i + 3 < trackSampleCount; i += 5) {
    glVertex3f(track[i].x, .035f, track[i].z);
    glVertex3f(track[i+3].x, .035f, track[i+3].z);
  }
  glEnd();
}

void drawCar() {
  glPushMatrix();
  glTranslatef(car.x, 0.55f, car.z);
  glRotatef(car.yaw * 180.0f / PI, 0, 1, 0);

  // Wheels stay planted while the body rolls against the turn like suspension.
  cube(-1.05f, -.2f, 1.25f, .32f, .65f, .65f, .03f, .03f, .03f);
  cube(1.05f, -.2f, 1.25f, .32f, .65f, .65f, .03f, .03f, .03f);
  cube(-1.05f, -.2f, -1.25f, .32f, .65f, .65f, .03f, .03f, .03f);
  cube(1.05f, -.2f, -1.25f, .32f, .65f, .65f, .03f, .03f, .03f);
  glPushMatrix();
  glRotatef(car.bodyRoll * 180.0f / PI, 0, 0, 1);
  cube(0, 0, 0, 2.4f, .65f, 4.2f, 0.92f, 0.18f, 0.08f);
  cube(0, .55f, -.25f, 1.75f, .7f, 1.9f, 0.12f, 0.17f, 0.19f);
  // Simple lamps add a more readable front/rear silhouette.
  cube(-.72f, .05f, 2.13f, .42f, .20f, .08f, 1.0f, .86f, .48f);
  cube(.72f, .05f, 2.13f, .42f, .20f, .08f, 1.0f, .86f, .48f);
  cube(-.72f, .05f, -2.13f, .42f, .20f, .08f, .95f, .03f, .02f);
  cube(.72f, .05f, -2.13f, .42f, .20f, .08f, .95f, .03f, .02f);
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
    case 'R':return"1111010001111101001010001";case 'S':return"0111110000011100000111110";
    case 'T':return"1111100100001000010000100";case 'U':return"1000110001100011000101110";
    case 'V':return"1000110001100010101000100";case 'Y':return"1000110001010100010000100";
    case '0':return"0111010001100011000101110";case '1':return"0010001100001000010001110";
    case '2':return"0111010001000100010011111";case '3':return"1111000001001100000111110";
    case '4':return"1001010010111110001000010";case '5':return"1111110000111100000111110";
    case '6':return"0111110000111101000101110";case '7':return"1111100010001000100001000";
    case '8':return"0111010001011101000101110";case '9':return"0111010001011110000101110";
    case '-':return"0000000000111110000000000";case ':':return"0000000100000000010000000";
    default:return"0000000000000000000000000";
  }
}
void drawLabel(float x,float y,const char* s,float scale=2.5f){
  for(;*s;++s,x+=6*scale){const char* g=glyph(*s);for(int r=0;r<5;++r)for(int c=0;c<5;++c)if(g[r*5+c]=='1')drawRect(x+c*scale,y+r*scale,x+(c+1)*scale,y+(r+1)*scale,1,1,1);}
}

void beginOverlay() {
  glDisable(GL_DEPTH_TEST);
  glMatrixMode(GL_PROJECTION); glLoadIdentity(); glOrthof(0, 960, 544, 0, -1, 1);
  glMatrixMode(GL_MODELVIEW); glLoadIdentity();
  glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
}

void endOverlay() { glDisable(GL_BLEND); glEnable(GL_DEPTH_TEST); }

void drawGround() {
  glColor3f(0.055f, 0.12f, 0.05f);
  glBegin(GL_QUADS);
  glVertex3f(-180,0,-180); glVertex3f(180,0,-180); glVertex3f(180,0,180); glVertex3f(-180,0,180);
  glEnd();
}

void renderMenuWorld() {
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glEnable(GL_DEPTH_TEST);
  glMatrixMode(GL_PROJECTION); glLoadIdentity();
  gluPerspective(43.0f, 960.0f/544.0f, .1f, 300.0f);
  glMatrixMode(GL_MODELVIEW); glLoadIdentity();
  float t=(float)(sceKernelGetProcessTimeWide()%18000000ULL)/18000000.0f*PI*2.0f;
  gluLookAt(std::sin(t)*61.0f,48.0f,std::cos(t)*61.0f,0,0,0,0,1,0);
  drawGround(); drawTrack(); drawCar();
}

void drawMenu() {
  renderMenuWorld();
  beginOverlay();
  // Dark glass veil/card over the live Figure 8 track, matching the original
  // game's menu composition instead of replacing the world with black.
  // Keep the track visible around a compact central menu panel.
  drawRect(175, 36, 785, 505, 0.035f, 0.04f, 0.035f);
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

  const float y[2] = {280.0f, 380.0f};
  for (int i = 0; i < 2; ++i) {
    bool selected = menuSelection == i;
    drawRect(285, y[i], 675, y[i] + 68,
      selected ? 0.92f : 0.13f, selected ? 0.18f : 0.14f, selected ? 0.06f : 0.13f);
    // PLAY uses a universal triangle icon; BUILD TRACK uses track blocks.
    if (i == 0) {
      glColor3f(1, 1, 1); glBegin(GL_TRIANGLES);
      glVertex3f(455, y[i] + 15, 0); glVertex3f(455, y[i] + 53, 0); glVertex3f(500, y[i] + 34, 0); glEnd();
    } else {
      glColor3f(selected ? 1.0f : 0.65f, selected ? 1.0f : 0.67f, selected ? 1.0f : 0.65f);
      glLineWidth(9.0f); glBegin(GL_LINE_STRIP);
      glVertex3f(420, y[i] + 49, 0); glVertex3f(460, y[i] + 19, 0); glVertex3f(500, y[i] + 49, 0); glVertex3f(540, y[i] + 19, 0); glEnd();
    }
  }
  glEnable(GL_DEPTH_TEST);
  vglSwapBuffers(GL_FALSE);
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
  gluPerspective(48.0f,960.0f/544.0f,.1f,300.0f);
  glMatrixMode(GL_MODELVIEW);glLoadIdentity();
  gluLookAt(builderCameraX,24.0f,builderCameraZ,builderCameraTargetX,0,builderCameraTargetZ,0,1,0);
  drawGround();drawTrack();
  cube(end.x,.45f,end.z,1.2f,.9f,1.2f,1.0f,.55f,.08f);

  beginOverlay();
  drawRect(0,0,960,9,.98f,.42f,.08f);
  // Compact translucent-style control rail: the road remains the main canvas.
  drawRect(665,25,940,519,.035f,.04f,.035f);
  const char* labels[BUILDER_OPTION_COUNT]={"STRAIGHT","TURN LEFT","TURN RIGHT","UNDO","CLEAR","DRIVE","SAVE","LOAD","MENU"};
  const float top=42.0f,row=48.0f;
  for(int i=0;i<BUILDER_OPTION_COUNT;++i){float y=top+i*row;bool s=builderSelection==i;drawRect(680,y,925,y+39,s?.96f:.14f,s?.32f:.15f,s?.06f:.14f);drawLabel(696,y+12,labels[i],2.15f);}
  drawRect(665,482,940,519,.08f,.09f,.07f);drawLabel(680,493,builderStatus,1.65f);
  endOverlay();vglSwapBuffers(GL_FALSE);
}

void updateBuilder(uint32_t pressed) {
  if (pressed & SCE_CTRL_START) { gameMode=GameMode::Menu; return; }
  if (pressed & SCE_CTRL_UP) builderSelection=(builderSelection+BUILDER_OPTION_COUNT-1)%BUILDER_OPTION_COUNT;
  if (pressed & SCE_CTRL_DOWN) builderSelection=(builderSelection+1)%BUILDER_OPTION_COUNT;
  if (pressed & SCE_CTRL_LEFT) {
    if(builderSelection==0) straightChoice=(straightChoice+3)%4;
    if(builderSelection==1||builderSelection==2) turnAngleChoice=(turnAngleChoice+5)%6;
  }
  if (pressed & SCE_CTRL_RIGHT) {
    if(builderSelection==0) straightChoice=(straightChoice+1)%4;
    if(builderSelection==1||builderSelection==2) turnAngleChoice=(turnAngleChoice+1)%6;
  }
  if (!(pressed & SCE_CTRL_CROSS)) return;
  if(builderSelection==0)addSegment(0);
  else if(builderSelection==1)addSegment(-1);
  else if(builderSelection==2)addSegment(1);
  else if(builderSelection==3&&segmentCount>0){--segmentCount;rebuildCustomTrack();std::snprintf(builderStatus,sizeof(builderStatus),"UNDO - %d PIECES",segmentCount);}
  else if(builderSelection==4){segmentCount=0;rebuildCustomTrack();std::snprintf(builderStatus,sizeof(builderStatus),"TRACK CLEARED");}
  else if(builderSelection==5){if(segmentCount>0){resetCarToTrack();gameMode=GameMode::Driving;}else std::snprintf(builderStatus,sizeof(builderStatus),"ADD ROAD FIRST");}
  else if(builderSelection==6)saveTrack();
  else if(builderSelection==7)loadTrack();
  else if(builderSelection==8)gameMode=GameMode::Menu;
}

void renderGame() {
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glMatrixMode(GL_PROJECTION);
  glLoadIdentity();
  gluPerspective(48.0f, 960.0f / 544.0f, 0.1f, 240.0f);
  glMatrixMode(GL_MODELVIEW);
  glLoadIdentity();

  float behindX = car.x - std::sin(cameraYaw) * 15.0f;
  float behindZ = car.z - std::cos(cameraYaw) * 15.0f;
  gluLookAt(behindX, 8.2f, behindZ, car.x, 1.0f, car.z, 0, 1, 0);

  glColor3f(0.07f, 0.14f, 0.06f);
  glBegin(GL_QUADS);
  glVertex3f(-130, 0, -130); glVertex3f(130, 0, -130); glVertex3f(130, 0, 130); glVertex3f(-130, 0, 130);
  glEnd();
  drawTrack();
  drawSkidMarks();
  drawCar();
  vglSwapBuffers(GL_FALSE);
}
}

int main() {
  sceCtrlSetSamplingMode(SCE_CTRL_MODE_ANALOG);
  vglInit(0x1000000);
  glClearColor(0.035f, 0.05f, 0.04f, 1.0f);
  glEnable(GL_DEPTH_TEST);
  glDepthFunc(GL_LEQUAL);
  glDisable(GL_TEXTURE_2D);
  glDisable(GL_LIGHTING);
  buildFigure8Track();

  uint64_t last = sceKernelGetProcessTimeWide();
  uint32_t previousButtons = 0;
  while (running) {
    SceCtrlData pad{};
    sceCtrlPeekBufferPositive(0, &pad, 1);
    uint64_t now = sceKernelGetProcessTimeWide();
    float dt = clampf((now - last) / 1000000.0f, 0.001f, 0.033f);
    last = now;
    uint32_t pressed = pad.buttons & ~previousButtons;
    if (gameMode == GameMode::Menu) {
      if (pressed & (SCE_CTRL_UP | SCE_CTRL_DOWN)) menuSelection = 1 - menuSelection;
      if (pressed & SCE_CTRL_CROSS) {
        if (menuSelection == 0) {
          buildFigure8Track();
          gameMode = GameMode::Driving;
        } else {
          segmentCount = 0;
          rebuildCustomTrack();
          builderSelection = 0;
          std::snprintf(builderStatus,sizeof(builderStatus),"BUILD YOUR TRACK");
          gameMode = GameMode::BuildTrack;
        }
      }
      drawMenu();
    } else if (gameMode == GameMode::BuildTrack) {
      updateBuilder(pressed);
      drawBuilder();
    } else {
      if (pressed & SCE_CTRL_START) gameMode = GameMode::Menu;
      if (pressed & SCE_CTRL_TRIANGLE) resetCarToTrack();
      updateCar(dt, pad);
      renderGame();
    }
    previousButtons = pad.buttons;
  }
  sceKernelExitProcess(0);
  return 0;
}
