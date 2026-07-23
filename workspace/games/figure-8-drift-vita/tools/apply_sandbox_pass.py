#!/usr/bin/env python3
"""Surgical sandbox pass for Figure 8 Drift main.cpp.

Adds:
  - AI traffic + pedestrians
  - Multi-vehicle toys (bike/truck/boat/buggy) with Square enter/exit
  - Destructible parked cars, building collapse, chaos score
  - Better on-foot walk + FPS shooting feel
"""
from __future__ import annotations

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
MAIN = ROOT / "src" / "main.cpp"


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"MISSING anchor for {label}:\n{old[:180]!r}")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected 1 match for {label}, found {count}")
    return text.replace(old, new, 1)


def insert_after(text: str, anchor: str, insertion: str, label: str) -> str:
    if anchor not in text:
        raise SystemExit(f"MISSING insert anchor for {label}:\n{anchor[:180]!r}")
    idx = text.find(anchor)
    if text.find(anchor, idx + 1) != -1:
        raise SystemExit(f"Ambiguous insert anchor for {label}")
    at = idx + len(anchor)
    return text[:at] + insertion + text[at:]


SANDBOX_STATE = r'''
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
  bool active,honked;
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

'''

SANDBOX_FUNCS = r'''
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
    }else if(v.kind==SandboxVehicleKind::Motorcycle){
      // Snappier steer already from base model; slight extra yaw authority.
      car.yawRate*=1.0f; // placeholder keep stable
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
    drawTrafficCarMesh(t.r,t.g,t.b,t.style);glPopMatrix();
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

'''


def main() -> int:
    text = MAIN.read_text(encoding="utf-8")
    original = text

    # 1) Insert sandbox state after plane constants / before CityBuilding is already used
    # Place after PARKED_CAR_COUNT block so CITY_BUILDING_COUNT exists.
    text = insert_after(
        text,
        "constexpr int PARKED_CAR_COUNT=sizeof(PARKED_CARS)/sizeof(PARKED_CARS[0]);\n",
        SANDBOX_STATE,
        "sandbox-state",
    )

    # 2) Improve PersonState defaults slightly via walk fields already present.
    # Patch updatePerson for better feel.
    old_person = '''void updatePerson(float dt,const SceCtrlData&pad,uint32_t pressed){
  // Vita on-foot axes are opposite the raw convention used by the controller
  // bridge. Flip both look axes and horizontal movement to match the stick.
  float lookX=-((int)pad.rx-128)/127.0f,lookY=-((int)pad.ry-128)/127.0f;
  if(std::fabs(lookX)<.12f)lookX=0;
  if(std::fabs(lookY)<.12f)lookY=0;
  person.viewYaw+=lookX*dt*3.25f;person.viewPitch=clampf(person.viewPitch+lookY*dt*2.55f,-1.45f,1.45f);
  float strafe=-((int)pad.lx-128)/127.0f,forward=-((int)pad.ly-128)/127.0f;
  if(std::fabs(strafe)<.14f)strafe=0;
  if(std::fabs(forward)<.14f)forward=0;
  float moveX=std::sin(person.viewYaw)*forward+std::cos(person.viewYaw)*strafe;
  float moveZ=std::cos(person.viewYaw)*forward-std::sin(person.viewYaw)*strafe;
  float length=std::sqrt(moveX*moveX+moveZ*moveZ);if(length>1.0f){moveX/=length;moveZ/=length;length=1.0f;}
  float speed=(pad.buttons&SCE_CTRL_DOWN)?11.3f:5.85f;
  if(length>.01f){
    if(person.cameraMode==1)person.bodyYaw=std::atan2(moveX,moveZ);
    person.walkPhase+=dt*speed*2.35f;
    float nextX=person.x+moveX*speed*dt;if(!personPositionBlocked(nextX,person.z))person.x=nextX;
    float nextZ=person.z+moveZ*speed*dt;if(!personPositionBlocked(person.x,nextZ))person.z=nextZ;
  }
  if(driveEnvironment==DriveEnvironment::City){bool onRamp=false;float highwayHeight=highwayLayerHeightAt(person.x,person.z,onRamp);
    if(!personOnHighway&&onRamp&&highwayHeight>.02f&&highwayHeight<2.15f)personOnHighway=true;
    if(personOnHighway&&onRamp&&highwayHeight>=0&&highwayHeight<.12f)personOnHighway=false;
    if(personOnHighway&&highwayHeight<0)personOnHighway=false;
    personGroundHeight=personOnHighway&&highwayHeight>=0?highwayHeight:personSupportHeight(person.x,person.z);
  }else personGroundHeight=0.0f;
  if(person.cameraMode==0)person.bodyYaw=person.viewYaw;
  if((pressed&SCE_CTRL_CROSS)&&person.grounded){person.verticalVelocity=7.65f;person.grounded=false;}
  if(!person.grounded){person.verticalVelocity-=16.5f*dt;person.y+=person.verticalVelocity*dt;if(person.y<=personGroundHeight){person.y=personGroundHeight;person.verticalVelocity=0;person.grounded=true;}}
  else person.y+=(personGroundHeight-person.y)*clampf(dt*10.0f,0.0f,1.0f);
}'''

    new_person = '''void updatePerson(float dt,const SceCtrlData&pad,uint32_t pressed){
  // Vita on-foot axes are opposite the raw convention used by the controller
  // bridge. Flip both look axes and horizontal movement to match the stick.
  float lookX=-((int)pad.rx-128)/127.0f,lookY=-((int)pad.ry-128)/127.0f;
  if(std::fabs(lookX)<.10f)lookX=0;
  if(std::fabs(lookY)<.10f)lookY=0;
  // Slight aim accel + recoil settle for gunfeel.
  float lookSens=person.cameraMode==1?3.85f:3.35f;
  person.viewYaw+=lookX*dt*lookSens;
  person.viewPitch=clampf(person.viewPitch+lookY*dt*2.95f+aimRecoil,-1.35f,1.35f);
  aimRecoil+=(0.0f-aimRecoil)*clampf(dt*10.0f,0.0f,1.0f);
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
}'''
    text = must_replace(text, old_person, new_person, "updatePerson")

    # 3) Better person mesh
    old_draw_person = '''void drawPerson(){
  glPushMatrix();glTranslatef(person.x,person.y,person.z);glRotatef(person.bodyYaw*180.0f/PI,0,1,0);
  float stride=std::sin(person.walkPhase)*.22f;
  // Compact stylized character with independently moving limbs; simple enough
  // for Vita but clearly readable from the third-person camera.
  cube(0,1.23f,0,.64f,.92f,.34f,.12f,.20f,.32f);cube(0,1.92f,0,.48f,.48f,.48f,.66f,.45f,.31f);
  cube(-.43f,1.27f,stride,.18f,.82f,.20f,.66f,.45f,.31f);cube(.43f,1.27f,-stride,.18f,.82f,.20f,.66f,.45f,.31f);
  cube(-.19f,.53f,-stride,.22f,.95f,.25f,.08f,.10f,.13f);cube(.19f,.53f,stride,.22f,.95f,.25f,.08f,.10f,.13f);
  cube(-.19f,.07f,-stride+.08f,.30f,.16f,.48f,.035f,.04f,.045f);cube(.19f,.07f,stride+.08f,.30f,.16f,.48f,.035f,.04f,.045f);
  glPopMatrix();
}'''
    new_draw_person = '''void drawPerson(){
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
}'''
    text = must_replace(text, old_draw_person, new_draw_person, "drawPerson")

    # 4) resetDestruction also resets sandbox chaos/buildings collapse state partially
    old_reset_d = '''void resetDestruction(){
  std::memset(buildingDamage,0,sizeof(buildingDamage));std::memset(rockets,0,sizeof(rockets));
  std::memset(bullets,0,sizeof(bullets));
  std::memset(explosionParticles,0,sizeof(explosionParticles));std::memset(explosionBlasts,0,sizeof(explosionBlasts));
  rocketCursor=bulletCursor=explosionParticleCursor=explosionBlastCursor=0;
  machineGunCooldown=muzzleFlashTimer=0;
}'''
    new_reset_d = '''void resetDestruction(){
  std::memset(buildingDamage,0,sizeof(buildingDamage));std::memset(rockets,0,sizeof(rockets));
  std::memset(bullets,0,sizeof(bullets));
  std::memset(explosionParticles,0,sizeof(explosionParticles));std::memset(explosionBlasts,0,sizeof(explosionBlasts));
  rocketCursor=bulletCursor=explosionParticleCursor=explosionBlastCursor=0;
  machineGunCooldown=muzzleFlashTimer=0;
  std::memset(buildingCollapse,0,sizeof(buildingCollapse));
  std::memset(buildingCollapsed,0,sizeof(buildingCollapsed));
  chaosScore=0;chaosCombo=1.0f;chaosDecay=0;
}'''
    text = must_replace(text, old_reset_d, new_reset_d, "resetDestruction")

    # 5) damageBuildingAt triggers collapse + chaos
    old_dmg = '''void damageBuildingAt(int buildingIndex,float hitX,float hitY,float hitZ,int side,bool rocketDamage){
  if(buildingIndex<0||buildingIndex>=CITY_BUILDING_COUNT-1)return; // bespoke church remains structural for now
  int row=0,column=0;buildingHitPanel(buildingIndex,hitX,hitY,hitZ,side,row,column);
  if(!rocketDamage){buildingDamage[buildingIndex]|=1ULL<<buildingChunkBit(side,row,column);return;}
  // Rockets tear out a nine-block section and throw matching masonry debris.
  int startRow=std::max(0,std::min(BUILDING_DAMAGE_ROWS-3,row-1));
  int startColumn=std::max(0,std::min(BUILDING_DAMAGE_COLS-3,column-1));
  for(int rr=startRow;rr<startRow+3;++rr)for(int cc=startColumn;cc<startColumn+3;++cc)
    buildingDamage[buildingIndex]|=1ULL<<buildingChunkBit(side,rr,cc);
}'''
    new_dmg = '''void damageBuildingAt(int buildingIndex,float hitX,float hitY,float hitZ,int side,bool rocketDamage){
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
}'''
    text = must_replace(text, old_dmg, new_dmg, "damageBuildingAt")

    # 6) Longer fence wreck lifetime
    text = must_replace(
        text,
        "if(prop.life>4.2f){prop.active=false;prop.respawn=1.8f;}",
        "if(prop.life>(fencePieceCount>0?9.5f:4.2f)){prop.active=false;prop.respawn=prop.life>8.0f?4.5f:1.8f;}",
        "prop-lifetime",
    )
    # Better: specifically in updateKnockable keep longer for all knocked props
    text = must_replace(
        text,
        "if(prop.life>(fencePieceCount>0?9.5f:4.2f)){prop.active=false;prop.respawn=prop.life>8.0f?4.5f:1.8f;}",
        "if(prop.life>9.0f){prop.active=false;prop.respawn=5.5f;}",
        "prop-lifetime-final",
    )

    # 7) Fire rocket/mg recoil + chaos hooks in projectile update
    old_fire_r = '''void fireRocket(){
  float cp=std::cos(person.viewPitch),sp=std::sin(person.viewPitch),dx=std::sin(person.viewYaw)*cp,dy=sp,dz=std::cos(person.viewYaw)*cp;
  Rocket&r=rockets[rocketCursor++%MAX_ROCKETS];r.x=person.x+dx*1.15f;r.y=person.y+1.58f+dy*.55f;r.z=person.z+dz*1.15f;
  r.vx=dx*34.0f;r.vy=dy*34.0f;r.vz=dz*34.0f;r.yaw=person.viewYaw;r.pitch=person.viewPitch;r.life=5.0f;r.active=true;
  spawnRocketMuzzleBurst(r.x,r.y,r.z,dx,dy,dz);
}'''
    new_fire_r = '''void fireRocket(){
  float cp=std::cos(person.viewPitch),sp=std::sin(person.viewPitch),dx=std::sin(person.viewYaw)*cp,dy=sp,dz=std::cos(person.viewYaw)*cp;
  // Spawn from eye/muzzle with slight right-hand offset so FPS rockets don't clip the camera.
  float rx=std::cos(person.viewYaw),rz=-std::sin(person.viewYaw);
  Rocket&r=rockets[rocketCursor++%MAX_ROCKETS];
  r.x=person.x+dx*1.35f+rx*.28f;r.y=person.y+1.58f+dy*.55f;r.z=person.z+dz*1.35f+rz*.28f;
  r.vx=dx*38.0f;r.vy=dy*38.0f;r.vz=dz*38.0f;r.yaw=person.viewYaw;r.pitch=person.viewPitch;r.life=5.0f;r.active=true;
  spawnRocketMuzzleBurst(r.x,r.y,r.z,dx,dy,dz);
  aimRecoil-=.085f;shootShake=.22f;addChaos(2.0f);
}'''
    text = must_replace(text, old_fire_r, new_fire_r, "fireRocket")

    old_fire_mg = '''void fireMachineGun(){
  float cp=std::cos(person.viewPitch),sp=std::sin(person.viewPitch),dx=std::sin(person.viewYaw)*cp,dy=sp,dz=std::cos(person.viewYaw)*cp;
  Bullet&b=bullets[bulletCursor++%MAX_BULLETS];b.x=person.x+dx*.95f;b.y=person.y+1.55f+dy*.35f;b.z=person.z+dz*.95f;
  b.vx=dx*96.0f;b.vy=dy*96.0f;b.vz=dz*96.0f;b.life=1.8f;b.active=true;muzzleFlashTimer=.055f;
}'''
    new_fire_mg = '''void fireMachineGun(){
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
  aimRecoil-=.018f;shootShake=std::max(shootShake,.08f);addChaos(.35f);
}'''
    text = must_replace(text, old_fire_mg, new_fire_mg, "fireMachineGun")

    # 8) Hook explosions into parked/sandbox damage
    text = must_replace(
        text,
        "if(projectileHitsPlayerCar(r.x,r.y,r.z,previousX,previousZ,1.65f)){\n"
        "      spawnExplosion(r.x,r.y,r.z);pushPlayerCar(previousX,previousZ,24.0f,9.0f);blastCityProps(r.x,r.z,8.5f,28.0f);r.active=false;continue;\n"
        "    }",
        "if(projectileHitsPlayerCar(r.x,r.y,r.z,previousX,previousZ,1.65f)){\n"
        "      spawnExplosion(r.x,r.y,r.z);pushPlayerCar(previousX,previousZ,24.0f,9.0f);blastCityProps(r.x,r.z,8.5f,28.0f);"
        "damageDynamicParkedAt(r.x,r.z,9.0f,30.0f,true);damageSandboxVehicleAt(r.x,r.z,9.0f,30.0f,true);addChaos(18.0f);r.active=false;continue;\n"
        "    }",
        "rocket-car-hit",
    )
    text = must_replace(
        text,
        "if(driveEnvironment==DriveEnvironment::City&&hitCityPropWithProjectile(r.x,r.y,r.z,previousX,previousZ,true)){\n"
        "      spawnExplosion(r.x,r.y,r.z);blastCityProps(r.x,r.z,8.5f,28.0f);blastPlayerCar(r.x,r.z,8.5f,20.0f,7.5f);r.active=false;continue;\n"
        "    }",
        "if(driveEnvironment==DriveEnvironment::City&&hitCityPropWithProjectile(r.x,r.y,r.z,previousX,previousZ,true)){\n"
        "      spawnExplosion(r.x,r.y,r.z);blastCityProps(r.x,r.z,8.5f,28.0f);blastPlayerCar(r.x,r.z,8.5f,20.0f,7.5f);"
        "damageDynamicParkedAt(r.x,r.z,9.0f,28.0f,true);damageSandboxVehicleAt(r.x,r.z,9.0f,28.0f,true);addChaos(12.0f);r.active=false;continue;\n"
        "    }",
        "rocket-prop-hit",
    )
    text = must_replace(
        text,
        "damageBuildingAt(hit,impactX,impactY,impactZ,side,true);spawnExplosion(impactX,impactY,impactZ);spawnBuildingDebris(hit,impactX,impactY,impactZ,side);\n"
        "      blastCityProps(impactX,impactZ,9.0f,30.0f);blastPlayerCar(impactX,impactZ,10.0f,23.0f,8.0f);r.active=false;continue;}",
        "damageBuildingAt(hit,impactX,impactY,impactZ,side,true);spawnExplosion(impactX,impactY,impactZ);spawnBuildingDebris(hit,impactX,impactY,impactZ,side);\n"
        "      blastCityProps(impactX,impactZ,9.0f,30.0f);blastPlayerCar(impactX,impactZ,10.0f,23.0f,8.0f);"
        "damageDynamicParkedAt(impactX,impactZ,10.0f,32.0f,true);damageSandboxVehicleAt(impactX,impactZ,10.0f,32.0f,true);r.active=false;continue;}",
        "rocket-building-hit",
    )
    text = must_replace(
        text,
        "if(r.y<=.05f||r.life<=0||std::fabs(r.x)>560||std::fabs(r.z)>320){if(r.y<=.05f&&r.life>0){spawnExplosion(r.x,.2f,r.z);blastPlayerCar(r.x,r.z,9.0f,20.0f,7.0f);}r.active=false;}",
        "if(r.y<=.05f||r.life<=0||std::fabs(r.x)>560||std::fabs(r.z)>320){if(r.y<=.05f&&r.life>0){spawnExplosion(r.x,.2f,r.z);blastPlayerCar(r.x,r.z,9.0f,20.0f,7.0f);damageDynamicParkedAt(r.x,r.z,9.0f,24.0f,true);damageSandboxVehicleAt(r.x,r.z,9.0f,24.0f,true);addChaos(8.0f);}r.active=false;}",
        "rocket-ground-hit",
    )
    text = must_replace(
        text,
        "if(hit>=0){int side=std::fabs(b.vx)>std::fabs(b.vz)?(b.vx>0?2:3):(b.vz>0?0:1);damageBuildingAt(hit,b.x,b.y,b.z,side,false);b.active=false;continue;}",
        "if(hit>=0){int side=std::fabs(b.vx)>std::fabs(b.vz)?(b.vx>0?2:3):(b.vz>0?0:1);damageBuildingAt(hit,b.x,b.y,b.z,side,false);b.active=false;continue;}\n"
        "    if(driveEnvironment==DriveEnvironment::City){damageDynamicParkedAt(b.x,b.z,1.4f,8.0f,false);damageSandboxVehicleAt(b.x,b.z,1.4f,8.0f,false);}",
        "bullet-parked",
    )

    # 9) Insert sandbox function implementations before drawParkedCar
    text = insert_after(
        text,
        "void drawIndustrialObstacle(const IndustrialObstacle&obstacle){\n"
        "  texturedCube(obstacle.x,obstacle.height*.5f,obstacle.z,obstacle.width,obstacle.height,obstacle.depth,\n"
        "               UV_METAL,obstacle.r,obstacle.g,obstacle.b);\n"
        "  cube(obstacle.x,obstacle.height+.04f,obstacle.z,obstacle.width*.96f,.08f,obstacle.depth*.96f,\n"
        "       obstacle.r*.72f,obstacle.g*.72f,obstacle.b*.72f);\n"
        "}\n",
        "\n" + SANDBOX_FUNCS + "\n",
        "sandbox-funcs",
    )

    # 10) drawCity: skip static parked cars (dynamic ones replace them), draw life systems
    text = must_replace(
        text,
        "for(const ParkedCar&parked:PARKED_CARS)if(nearFocus(parked.x,parked.z,220.0f))drawParkedCar(parked);",
        "// Static PARKED_CARS replaced by dynamicParked for destruction payoff.\n"
        "  drawDynamicParked();drawTraffic();drawPedestrians();drawSandboxVehicles();",
        "draw-city-life",
    )

    # 11) Building draw: collapse sink
    old_bdraw = '''    drawDestructibleBuilding(building,buildingIndex,material);
    cube(building.x,building.height+.22f,building.z,building.width*.88f,.44f,building.depth*.88f,
         building.r*.62f,building.g*.62f,building.b*.62f);'''
    new_bdraw = '''    if(buildingCollapsed[buildingIndex]){
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
         building.r*.62f,building.g*.62f,building.b*.62f);'''
    text = must_replace(text, old_bdraw, new_bdraw, "collapsed-building-draw")

    # 12) On-foot camera bob + FPS improvements
    old_cam = '''  if(playerControlMode==PlayerControlMode::OnFoot){
    float cp=std::cos(person.viewPitch),sp=std::sin(person.viewPitch);
    float dirX=std::sin(person.viewYaw)*cp,dirY=sp,dirZ=std::cos(person.viewYaw)*cp;
    float upX=-std::sin(person.viewYaw)*sp,upY=cp,upZ=-std::cos(person.viewYaw)*sp;
    float anchorX=person.x,anchorY=person.y+1.63f,anchorZ=person.z;
    if(person.cameraMode==1)gluLookAt(anchorX,anchorY,anchorZ,anchorX+dirX*24,anchorY+dirY*24,anchorZ+dirZ*24,upX,upY,upZ);
    else{
      // Cam-2-style locked follow: fixed behind the player's facing direction,
      // slightly elevated/top-down, while pitch changes the aim point.
      float horizontalX=std::sin(person.viewYaw),horizontalZ=std::cos(person.viewYaw);
      float eyeX=person.x-horizontalX*8.5f,eyeY=person.y+4.8f,eyeZ=person.z-horizontalZ*8.5f;
      constrainPersonCamera(anchorX,anchorY,anchorZ,eyeX,eyeY,eyeZ);
      gluLookAt(eyeX,eyeY,eyeZ,anchorX+dirX*12,anchorY+dirY*12,anchorZ+dirZ*12,0,1,0);
    }
  }'''
    new_cam = '''  if(playerControlMode==PlayerControlMode::OnFoot){
    float cp=std::cos(person.viewPitch),sp=std::sin(person.viewPitch);
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
  }'''
    text = must_replace(text, old_cam, new_cam, "onfoot-camera")

    # FOV for FPS
    text = must_replace(
        text,
        "float fov=playerControlMode==PlayerControlMode::OnFoot?65.0f:(cameraMode==1?55.0f:(cameraMode==2?52.0f:(cameraMode==3?58.0f:(cameraMode==4?62.0f:48.0f))));",
        "float fov=playerControlMode==PlayerControlMode::OnFoot?(person.cameraMode==1?72.0f:60.0f):(cameraMode==1?55.0f:(cameraMode==2?52.0f:(cameraMode==3?58.0f:(cameraMode==4?62.0f:48.0f))));",
        "fov",
    )

    # 13) Render path: special vehicle mesh, chaos hud
    text = must_replace(
        text,
        "if(playerControlMode==PlayerControlMode::OnFoot){drawCar();if(person.cameraMode==0){drawPerson();drawWeaponWorld();}}\n"
        "  else if(playerControlMode==PlayerControlMode::Vehicle&&cameraMode!=4)drawCar();",
        "if(playerControlMode==PlayerControlMode::OnFoot){drawCar();if(person.cameraMode==0){drawPerson();drawWeaponWorld();}}\n"
        "  else if(playerControlMode==PlayerControlMode::Vehicle&&cameraMode!=4){\n"
        "    if(occupiedSandboxVehicle>=0)drawPlayerSandboxVehicle(); else drawCar();\n"
        "  }",
        "render-vehicle-mesh",
    )
    text = must_replace(
        text,
        "if(playerControlMode==PlayerControlMode::OnFoot)drawOnFootHud();\n"
        "  else if(playerControlMode==PlayerControlMode::Aircraft){char planeHud[48];std::snprintf(planeHud,sizeof(planeHud),\"AIRCRAFT HP %d  SPD %d\",(int)plane.health,(int)plane.speed);drawRect(22,20,340,64,.10f,.13f,.14f);drawLabel(38,32,planeHud,1.55f);drawRect(185,486,775,528,.10f,.13f,.14f);drawLabel(202,499,\"R THROTTLE L BRAKE  LEFT STICK YAW/BANK  RIGHT STICK PITCH\",1.02f);}\n"
        "  else{if(cameraMode==4)drawCockpitOverlay();drawHud();}",
        "if(playerControlMode==PlayerControlMode::OnFoot)drawOnFootHud();\n"
        "  else if(playerControlMode==PlayerControlMode::Aircraft){char planeHud[48];std::snprintf(planeHud,sizeof(planeHud),\"AIRCRAFT HP %d  SPD %d\",(int)plane.health,(int)plane.speed);drawRect(22,20,340,64,.10f,.13f,.14f);drawLabel(38,32,planeHud,1.55f);drawRect(185,486,775,528,.10f,.13f,.14f);drawLabel(202,499,\"R THROTTLE L BRAKE  LEFT STICK YAW/BANK  RIGHT STICK PITCH\",1.02f);}\n"
        "  else{if(cameraMode==4)drawCockpitOverlay();drawHud();}\n"
        "  if(driveEnvironment==DriveEnvironment::City)drawChaosHud();",
        "chaos-hud-draw",
    )

    # 14) On-foot HUD vehicle prompts
    old_hud = '''void drawOnFootHud(){
  drawRect(750,20,938,58,.09f,.12f,.13f);drawLabel(772,32,"ON FOOT",1.9f);
  drawRect(750,66,938,102,.09f,.12f,.13f);drawLabel(770,78,person.cameraMode==0?"CAM THIRD":"CAM FIRST",1.65f);
  drawRect(22,486,470,528,.09f,.12f,.13f);drawLabel(38,499,"X JUMP  DPAD DOWN RUN  R FIRE  TRI SWITCH",1.12f);
  drawRect(690,112,938,150,.09f,.12f,.13f);drawLabel(708,124,selectedWeapon==WeaponType::RocketLauncher?"ROCKET LAUNCHER":"MACHINE GUN",1.55f);
  if(personDistanceToCar()<=3.25f){drawRect(300,468,660,522,.10f,.13f,.14f);drawRect(300,468,660,474,.98f,.42f,.08f);drawLabel(335,488,"SQUARE ENTER VEHICLE",1.75f);
  glColor3f(1.0f,.82f,.22f);glLineWidth(2);glBegin(GL_LINES);glVertex3f(468,272,0);glVertex3f(478,272,0);glVertex3f(482,272,0);glVertex3f(492,272,0);glVertex3f(480,260,0);glVertex3f(480,269,0);glVertex3f(480,275,0);glVertex3f(480,284,0);glEnd();glLineWidth(1);
  if(person.cameraMode==1){
    if(selectedWeapon==WeaponType::RocketLauncher){
      glColor3f(.11f,.16f,.10f);glBegin(GL_QUADS);glVertex3f(720,544,0);glVertex3f(960,544,0);glVertex3f(960,438,0);glVertex3f(820,452,0);glEnd();
      drawRect(815,438,960,470,.16f,.22f,.14f);drawRect(790,475,835,544,.08f,.10f,.075f);drawRect(918,420,960,486,.055f,.065f,.055f);
    }else{
      drawRect(760,487,960,525,.07f,.075f,.08f);drawRect(850,450,960,495,.11f,.115f,.12f);drawRect(916,425,960,466,.045f,.05f,.055f);
      if(muzzleFlashTimer>0)drawRect(900,405,944,449,1.0f,.58f,.06f);
    }
  }
}'''
    # The original has a missing brace in my paste - use exact file content
    old_hud = '''void drawOnFootHud(){
  drawRect(750,20,938,58,.09f,.12f,.13f);drawLabel(772,32,"ON FOOT",1.9f);
  drawRect(750,66,938,102,.09f,.12f,.13f);drawLabel(770,78,person.cameraMode==0?"CAM THIRD":"CAM FIRST",1.65f);
  drawRect(22,486,470,528,.09f,.12f,.13f);drawLabel(38,499,"X JUMP  DPAD DOWN RUN  R FIRE  TRI SWITCH",1.12f);
  drawRect(690,112,938,150,.09f,.12f,.13f);drawLabel(708,124,selectedWeapon==WeaponType::RocketLauncher?"ROCKET LAUNCHER":"MACHINE GUN",1.55f);
  if(personDistanceToCar()<=3.25f){drawRect(300,468,660,522,.10f,.13f,.14f);drawRect(300,468,660,474,.98f,.42f,.08f);drawLabel(335,488,"SQUARE ENTER VEHICLE",1.75f);}
  glColor3f(1.0f,.82f,.22f);glLineWidth(2);glBegin(GL_LINES);glVertex3f(468,272,0);glVertex3f(478,272,0);glVertex3f(482,272,0);glVertex3f(492,272,0);glVertex3f(480,260,0);glVertex3f(480,269,0);glVertex3f(480,275,0);glVertex3f(480,284,0);glEnd();glLineWidth(1);
  if(person.cameraMode==1){
    if(selectedWeapon==WeaponType::RocketLauncher){
      glColor3f(.11f,.16f,.10f);glBegin(GL_QUADS);glVertex3f(720,544,0);glVertex3f(960,544,0);glVertex3f(960,438,0);glVertex3f(820,452,0);glEnd();
      drawRect(815,438,960,470,.16f,.22f,.14f);drawRect(790,475,835,544,.08f,.10f,.075f);drawRect(918,420,960,486,.055f,.065f,.055f);
    }else{
      drawRect(760,487,960,525,.07f,.075f,.08f);drawRect(850,450,960,495,.11f,.115f,.12f);drawRect(916,425,960,466,.045f,.05f,.055f);
      if(muzzleFlashTimer>0)drawRect(900,405,944,449,1.0f,.58f,.06f);
    }
  }
}'''
    new_hud = '''void drawOnFootHud(){
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
  if(plane.active&&planeDistanceToPerson()<=4.0f){drawRect(300,420,660,460,.10f,.13f,.14f);drawLabel(335,432,"SQUARE ENTER PLANE",1.55f);}
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
}'''
    text = must_replace(text, old_hud, new_hud, "onfoot-hud")

    # 15) Main loop hooks
    text = must_replace(
        text,
        "driveEnvironment=DriveEnvironment::City;\n"
        "          cityPropsInitialized=false;initCityProps();\n"
        "          resetDestruction();\n"
        "          resetCarToTrack();\n"
        "          gameMode=GameMode::Driving;",
        "driveEnvironment=DriveEnvironment::City;\n"
        "          cityPropsInitialized=false;initCityProps();\n"
        "          resetDestruction();resetSandboxLife();initSandboxLife();\n"
        "          resetCarToTrack();\n"
        "          gameMode=GameMode::Driving;",
        "city-enter-init",
    )

    text = must_replace(
        text,
        "if(playerControlMode==PlayerControlMode::Vehicle){\n"
        "        if (pressed & SCE_CTRL_SELECT){cameraMode=(cameraMode+1)%5;cameraDistanceScale=1.0f;}\n"
        "        if (pressed & SCE_CTRL_TRIANGLE) resetCarToTrack();\n"
        "        if(pressed&SCE_CTRL_SQUARE)exitVehicle();\n"
        "        if(playerControlMode==PlayerControlMode::Vehicle)updateCar(dt,pad);\n"
        "      }",
        "if(playerControlMode==PlayerControlMode::Vehicle){\n"
        "        if (pressed & SCE_CTRL_SELECT){cameraMode=(cameraMode+1)%5;cameraDistanceScale=1.0f;}\n"
        "        if (pressed & SCE_CTRL_TRIANGLE){resetCarToTrack();occupiedSandboxVehicle=-1;activeVehicleKind=SandboxVehicleKind::Car;}\n"
        "        if(pressed&SCE_CTRL_SQUARE)exitToOnFootFromVehicle();\n"
        "        if(playerControlMode==PlayerControlMode::Vehicle)updateCar(dt,pad);\n"
        "      }",
        "vehicle-exit",
    )

    text = must_replace(
        text,
        "if((pressed&SCE_CTRL_SQUARE)&&personDistanceToCar()<=3.25f)enterVehicle();\n"
        "        else if((pressed&SCE_CTRL_SQUARE)&&plane.active&&planeDistanceToPerson()<=4.0f){playerControlMode=PlayerControlMode::Aircraft;}\n"
        "        if(playerControlMode==PlayerControlMode::OnFoot){\n"
        "          if(pressed&SCE_CTRL_TRIANGLE)selectedWeapon=selectedWeapon==WeaponType::RocketLauncher?WeaponType::MachineGun:WeaponType::RocketLauncher;\n"
        "          if(selectedWeapon==WeaponType::RocketLauncher){if(pressed&SCE_CTRL_RTRIGGER)fireRocket();}\n"
        "          else if((pad.buttons&SCE_CTRL_RTRIGGER)&&machineGunCooldown<=0){fireMachineGun();machineGunCooldown=.075f;}\n"
        "          updatePerson(dt,pad,pressed);\n"
        "          updateUnoccupiedCar(dt);\n"
        "        }",
        "if(pressed&SCE_CTRL_SQUARE){\n"
        "          if(!tryEnterNearbySandboxVehicle()){\n"
        "            if(personDistanceToCar()<=3.25f)enterVehicle();\n"
        "            else if(plane.active&&planeDistanceToPerson()<=4.0f){playerControlMode=PlayerControlMode::Aircraft;}\n"
        "          }\n"
        "        }\n"
        "        if(playerControlMode==PlayerControlMode::OnFoot){\n"
        "          if(pressed&SCE_CTRL_TRIANGLE)selectedWeapon=selectedWeapon==WeaponType::RocketLauncher?WeaponType::MachineGun:WeaponType::RocketLauncher;\n"
        "          if(selectedWeapon==WeaponType::RocketLauncher){if(pressed&SCE_CTRL_RTRIGGER)fireRocket();}\n"
        "          else if((pad.buttons&SCE_CTRL_RTRIGGER)&&machineGunCooldown<=0){fireMachineGun();machineGunCooldown=(pad.buttons&SCE_CTRL_LTRIGGER)?.055f:.07f;}\n"
        "          updatePerson(dt,pad,pressed);\n"
        "          updateUnoccupiedCar(dt);\n"
        "        }",
        "onfoot-enter-fire",
    )

    text = must_replace(
        text,
        "if(driveEnvironment==DriveEnvironment::City)updateCityProps(dt);\n"
        "      updateRocketsAndExplosions(dt);\n"
        "      updateCarAir(dt);",
        "if(driveEnvironment==DriveEnvironment::City){\n"
        "        updateCityProps(dt);updateTraffic(dt);updatePedestrians(dt);\n"
        "        updateDynamicParked(dt);updateSandboxVehicles(dt,pad,pressed);\n"
        "        // Collapse animation + chaos combo decay.\n"
        "        for(int bi=0;bi<CITY_BUILDING_COUNT;++bi)if(buildingCollapsed[bi]&&buildingCollapse[bi]<1.0f)buildingCollapse[bi]=clampf(buildingCollapse[bi]+dt*.55f,0.0f,1.0f);\n"
        "        if(chaosDecay>0){chaosDecay-=dt;if(chaosDecay<=0)chaosCombo=std::max(1.0f,chaosCombo-dt*1.8f);}\n"
        "        else chaosCombo=std::max(1.0f,chaosCombo-dt*.35f);\n"
        "      }\n"
        "      updateRocketsAndExplosions(dt);\n"
        "      updateCarAir(dt);",
        "main-update-life",
    )

    # Forward declarations needed: maybeCollapseBuilding uses spawn* which are defined later.
    # Our SANDBOX_FUNCS are inserted before drawParkedCar which is AFTER spawn functions - good.
    # But SANDBOX_STATE is early and references CITY_BUILDING_COUNT - good.
    # maybeCollapseBuilding is in SANDBOX_FUNCS after spawnExplosion - good.
    # damageBuildingAt calls maybeCollapseBuilding which is defined LATER - need forward decl.
    # We already have forward decls at top of SANDBOX_FUNCS.

    # Problem: damageBuildingAt is BEFORE SANDBOX_FUNCS insertion point, and calls maybeCollapseBuilding/addChaos.
    # addChaos is defined in SANDBOX_STATE as inline function - good, early.
    # maybeCollapseBuilding is only forward-declared in SANDBOX_FUNCS which is LATE.
    # Need early forward declarations after state.

    text = insert_after(
        text,
        "bool sandboxLifeInitialized=false;\n\nvoid addChaos(float amount){\n  chaosScore+=amount*chaosCombo;\n  float nextCombo=chaosCombo+amount*.035f;\n  if(nextCombo<1.0f)nextCombo=1.0f;if(nextCombo>8.0f)nextCombo=8.0f;\n  chaosCombo=nextCombo;\n  chaosDecay=4.5f;\n  car.score+=amount*chaosCombo*.35f;\n}\n",
        "\nvoid maybeCollapseBuilding(int buildingIndex,float hitX,float hitY,float hitZ);\n"
        "void damageDynamicParkedAt(float x,float z,float radius,float force,bool explosive);\n"
        "void damageSandboxVehicleAt(float x,float z,float radius,float force,bool explosive);\n"
        "void initSandboxLife();\nvoid resetSandboxLife();\n",
        "early-forward-decls",
    )

    # personPositionBlocked still uses static PARKED_CARS - keep that for collision with spawn points.
    # Also need dynamic parked collision for person - optional enhancement in personPositionBlocked.
    old_ppb = '''  for(const ParkedCar&parked:PARKED_CARS){
    float yaw=parked.yaw*PI/180.0f,dx=x-parked.x,dz=z-parked.z;
    float localX=dx*std::cos(yaw)-dz*std::sin(yaw),localZ=dx*std::sin(yaw)+dz*std::cos(yaw);
    if(std::fabs(localX)<1.15f&&std::fabs(localZ)<2.0f&&person.y<cityGroundHeightAt(parked.x,parked.z)+1.25f)return true;
  }
  return false;
}'''
    new_ppb = '''  for(int i=0;i<MAX_DYNAMIC_PARKED;++i){const DynamicParked&parked=dynamicParked[i];if(!parked.active)continue;
    float yaw=parked.yaw,dx=x-parked.x,dz=z-parked.z;
    float localX=dx*std::cos(yaw)-dz*std::sin(yaw),localZ=dx*std::sin(yaw)+dz*std::cos(yaw);
    if(std::fabs(localX)<1.15f&&std::fabs(localZ)<2.0f&&person.y<cityGroundHeightAt(parked.x,parked.z)+1.25f)return true;
  }
  for(int i=0;i<MAX_SANDBOX_VEHICLES;++i){const SandboxVehicle&v=sandboxVehicles[i];if(!v.active||v.occupied)continue;
    float dx=x-v.x,dz=z-v.z;if(dx*dx+dz*dz<1.6f*1.6f)return true;
  }
  return false;
}'''
    text = must_replace(text, old_ppb, new_ppb, "person-blocked-dynamic")

    # personSupportHeight parked cars
    old_psh = '''  for(const ParkedCar&parked:PARKED_CARS){float yaw=parked.yaw*PI/180.0f,pdx=x-parked.x,pdz=z-parked.z;
    float px=pdx*std::cos(yaw)-pdz*std::sin(yaw),pz=pdx*std::sin(yaw)+pdz*std::cos(yaw);
    if(std::fabs(px)<.92f&&std::fabs(pz)<1.72f)support=std::max(support,cityGroundHeightAt(parked.x,parked.z)+1.35f);
  }'''
    new_psh = '''  for(int i=0;i<MAX_DYNAMIC_PARKED;++i){const DynamicParked&parked=dynamicParked[i];if(!parked.active||parked.flipped)continue;
    float yaw=parked.yaw,pdx=x-parked.x,pdz=z-parked.z;
    float px=pdx*std::cos(yaw)-pdz*std::sin(yaw),pz=pdx*std::sin(yaw)+pdz*std::cos(yaw);
    if(std::fabs(px)<.92f&&std::fabs(pz)<1.72f)support=std::max(support,cityGroundHeightAt(parked.x,parked.z)+1.35f);
  }'''
    text = must_replace(text, old_psh, new_psh, "person-support-dynamic")

    # Vehicle HUD label when in special vehicle + chaos HUD impl (needs drawRect/drawLabel)
    text = must_replace(
        text,
        "void drawHud() {\n"
        "  char scoreText[32],comboText[32],cameraText[16],damageText[24];\n"
        "  std::snprintf(scoreText, sizeof(scoreText), \"SCORE %d\", static_cast<int>(car.score));\n"
        "  std::snprintf(comboText, sizeof(comboText), \"COMBO %.1fX\", car.combo);\n"
        "  std::snprintf(damageText,sizeof(damageText),\"DAMAGE %d\",static_cast<int>(carDamage));",
        "void drawChaosHud(){\n"
        "  if(driveEnvironment!=DriveEnvironment::City)return;\n"
        "  char chaosText[48],ccomboText[32];\n"
        "  std::snprintf(chaosText,sizeof(chaosText),\"CHAOS %d\",(int)chaosScore);\n"
        "  std::snprintf(ccomboText,sizeof(ccomboText),\"x%.1f\",chaosCombo);\n"
        "  float pulse=chaosCombo>2.0f?.15f:0.0f;\n"
        "  drawRect(22,150,250,220,.10f+pulse,.08f,.09f);\n"
        "  drawRect(22,150,250,156,.98f,.32f,.08f);\n"
        "  drawLabel(38,168,chaosText,2.0f);\n"
        "  drawLabel(38,196,ccomboText,1.7f);\n"
        "}\n"
        "\n"
        "void drawHud() {\n"
        "  char scoreText[32],comboText[32],cameraText[16],damageText[24],vehText[24];\n"
        "  std::snprintf(scoreText, sizeof(scoreText), \"SCORE %d\", static_cast<int>(car.score));\n"
        "  std::snprintf(comboText, sizeof(comboText), \"COMBO %.1fX\", car.combo);\n"
        "  std::snprintf(damageText,sizeof(damageText),\"DAMAGE %d\",static_cast<int>(carDamage));\n"
        "  const char*vk=activeVehicleKind==SandboxVehicleKind::Motorcycle?\"BIKE\":activeVehicleKind==SandboxVehicleKind::Truck?\"TRUCK\":activeVehicleKind==SandboxVehicleKind::Boat?\"BOAT\":activeVehicleKind==SandboxVehicleKind::Buggy?\"BUGGY\":\"CAR\";\n"
        "  std::snprintf(vehText,sizeof(vehText),\"%s\",vk);",
        "drawhud-veh",
    )
    text = must_replace(
        text,
        "drawRect(730,107,938,143,carDamage>65?.42f:.10f,carDamage>65?.10f:.13f,.12f);\n"
        "  drawLabel(746,118,damageText,1.8f);\n"
        "  drawSpeedometer();\n"
        "}",
        "drawRect(730,107,938,143,carDamage>65?.42f:.10f,carDamage>65?.10f:.13f,.12f);\n"
        "  drawLabel(746,118,damageText,1.8f);\n"
        "  drawRect(730,150,938,186,.10f,.13f,.14f);drawLabel(746,161,vehText,1.7f);\n"
        "  drawSpeedometer();\n"
        "}",
        "drawhud-vehlabel",
    )

    if text == original:
        raise SystemExit("No changes applied")

    MAIN.write_text(text, encoding="utf-8")
    print(f"Patched {MAIN} ({len(original)} -> {len(text)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
