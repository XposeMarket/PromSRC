#include <psp2/kernel/modulemgr.h>
#include <psp2/kernel/clib.h>
#include <psp2/kernel/processmgr.h>
#include <psp2/kernel/threadmgr.h>
#include <psp2/io/fcntl.h>
#include <psp2/io/dirent.h>
#include <psp2/io/stat.h>
#include <psp2/sysmodule.h>
#include <psp2/net/net.h>
#include <psp2common/net.h>
#include <taihen.h>
#include <stdint.h>
#include <string.h>

#define INPUT_PORT 18791
#define PACKET_MAGIC 0x50495650u
#define PACKET_VERSION 2
#define ACK_MAGIC 0x4B415650u
#define KEEP_AWAKE_FLAG 0x80000000u
#define KEEP_AWAKE_WINDOW_US (12u*1000u*1000u)
#define HOLD_SAMPLES 12
#define FRAME_PORT 18790
#define FRAME_WIDTH 240
#define FRAME_HEIGHT 136
#define FRAME_BYTES (FRAME_WIDTH*FRAME_HEIGHT*2)
#define FRAME_PAYLOAD 1100
#define UPLOAD_PORT 18790

int promVitaSetButtons(uint32_t buttons, uint32_t samples);
int promVitaSetAnalog(uint32_t lx, uint32_t ly, uint32_t rx, uint32_t ry,
                      uint32_t samples);
int promVitaCaptureFrame(void *dst, uint32_t capacity);

#pragma pack(push, 1)
typedef struct InputPacket {
  uint32_t magic; uint16_t version; uint16_t size; uint32_t sequence;
  uint32_t buttons; uint8_t lx,ly,rx,ry; uint32_t checksum;
} InputPacket;
typedef struct AckPacket {
  uint32_t magic; uint16_t version; uint16_t size; uint32_t sequence;
  uint32_t status; int32_t button_result; int32_t analog_result;
  uint32_t checksum;
} AckPacket;
typedef struct FrameHeader {
  uint32_t magic; uint16_t version,size; uint32_t frame_id;
  uint16_t chunk_index,chunk_count,payload_size,width,height,format;
} FrameHeader;
typedef struct UploadHeader { uint32_t magic;uint16_t version,kind;uint32_t total_size,checksum,reserved; } UploadHeader;
typedef struct UploadAck { uint32_t magic,status,received,checksum; } UploadAck;
#pragma pack(pop)

static volatile int running;
static SceUID worker_uid=-1;
static SceUID upload_uid=-1;
static uint8_t frame_pixels[FRAME_BYTES];
static SceNetSockaddrIn stream_peer;
static int stream_peer_known;
static uint32_t frame_id;
static int (*net_socket)(const char*,int,int,int);
static int (*net_bind)(int,const SceNetSockaddr*,unsigned int);
static int (*net_recvfrom)(int,void*,unsigned int,int,SceNetSockaddr*,unsigned int*);
static int (*net_sendto)(int,const void*,unsigned int,int,const SceNetSockaddr*,unsigned int);
static int (*net_close)(int);
static int (*net_listen)(int,int);
static int (*net_accept)(int,SceNetSockaddr*,unsigned int*);
static int (*net_recv)(int,void*,unsigned int,int);
static int (*net_send)(int,const void*,unsigned int,int);
static int (*promoter_init)(void);
static int (*promoter_promote)(const char*,int);
static int (*promoter_exit)(void);

static int resolve_network(void){
  const uint32_t lib=0x6BF8B2A2;
  if(taiGetModuleExportFunc("SceNet",lib,0xF084FCE3,(uintptr_t*)&net_socket)<0)return -1;
  if(taiGetModuleExportFunc("SceNet",lib,0x1296A94B,(uintptr_t*)&net_bind)<0)return -2;
  if(taiGetModuleExportFunc("SceNet",lib,0xB226138B,(uintptr_t*)&net_recvfrom)<0)return -3;
  if(taiGetModuleExportFunc("SceNet",lib,0x52DB31D5,(uintptr_t*)&net_sendto)<0)return -4;
  if(taiGetModuleExportFunc("SceNet",lib,0x29822B4D,(uintptr_t*)&net_close)<0)return -5;
  if(taiGetModuleExportFunc("SceNet",lib,0x7A8DA094,(uintptr_t*)&net_listen)<0)return -6;
  if(taiGetModuleExportFunc("SceNet",lib,0x1ADF9BB1,(uintptr_t*)&net_accept)<0)return -7;
  if(taiGetModuleExportFunc("SceNet",lib,0x023643B7,(uintptr_t*)&net_recv)<0)return -8;
  if(taiGetModuleExportFunc("SceNet",lib,0xE3DD8CD9,(uintptr_t*)&net_send)<0)return -9;
  return 0;
}

static int receive_exact(int socket,void*buffer,unsigned int bytes){
  unsigned int done=0;while(done<bytes){int n=net_recv(socket,(uint8_t*)buffer+done,bytes-done,0);if(n<=0)return n;done+=n;}return done;
}

static int promote_staged_game(void){
  static uint32_t paf_args[]={0x180000,-1,-1,1,-1,-1};int paf_result=-1;uint32_t paf_out[4]={sizeof(paf_out),(uint32_t)&paf_result,-1,-1};
  int result=sceSysmoduleLoadModuleInternalWithArg(SCE_SYSMODULE_INTERNAL_PAF,sizeof(paf_args),paf_args,(const SceSysmoduleOpt*)paf_out);
  if(result<0&&result!=(int)0x805A1002)return result;
  result=sceSysmoduleLoadModuleInternal(SCE_SYSMODULE_INTERNAL_PROMOTER_UTIL);
  if(result<0&&result!=(int)0x805A1002)return result;
  const uint32_t lib=0x31F237B6;
  if(taiGetModuleExportFunc("ScePromoterUtil",lib,0x93451536,(uintptr_t*)&promoter_init)<0)return -20;
  if(taiGetModuleExportFunc("ScePromoterUtil",lib,0x86641BC6,(uintptr_t*)&promoter_promote)<0)return -21;
  if(taiGetModuleExportFunc("ScePromoterUtil",lib,0xC95D24A6,(uintptr_t*)&promoter_exit)<0)return -22;
  result=promoter_init();if(result<0)return result;
  result=promoter_promote("ux0:data/prometheus_pkg",1);int exit_result=promoter_exit();
  return result<0?result:exit_result;
}

static int upload_thread(SceSize args,void*argp){
  (void)args;(void)argp;sceKernelDelayThread(10*1000*1000);
  while(running){
    if(resolve_network()<0){sceKernelDelayThread(1000*1000);continue;}
    int server=net_socket("prom_vita_upload",SCE_NET_AF_INET,SCE_NET_SOCK_STREAM,SCE_NET_IPPROTO_TCP);
    if(server<0){sceKernelDelayThread(1000*1000);continue;}
    SceNetSockaddrIn addr;sceClibMemset(&addr,0,sizeof(addr));addr.sin_len=sizeof(addr);addr.sin_family=SCE_NET_AF_INET;
    addr.sin_port=__builtin_bswap16(UPLOAD_PORT);addr.sin_addr.s_addr=SCE_NET_INADDR_ANY;
    if(net_bind(server,(const SceNetSockaddr*)&addr,sizeof(addr))<0||net_listen(server,1)<0){net_close(server);sceKernelDelayThread(1000*1000);continue;}
    while(running){
      int client=net_accept(server,0,0);if(client<0){sceKernelDelayThread(100*1000);continue;}
      UploadHeader header;UploadAck ack={0x41555650u,1,0,0};
      if(receive_exact(client,&header,sizeof(header))==(int)sizeof(header)&&header.magic==0x50555650u&&header.version==1&&
         header.kind>=1&&header.kind<=9&&header.total_size>0&&header.total_size<=32*1024*1024){
        if(header.kind==6){uint8_t command;receive_exact(client,&command,1);ack.received=1;int promote=promote_staged_game();ack.status=promote<0?(uint32_t)promote:0;ack.checksum=(uint32_t)promote;net_send(client,&ack,sizeof(ack),0);net_close(client);continue;}
        sceIoMkdir("ux0:data/prometheus_pkg",0777);sceIoMkdir("ux0:data/prometheus_pkg/sce_sys",0777);sceIoMkdir("ux0:data/prometheus_pkg/sce_sys/package",0777);sceIoMkdir("ux0:data/prometheus_pkg/assets",0777);
        const char*temp=header.kind==1?"ux0:downloads/figure8_vita.upload":header.kind==2?"ux0:downloads/prometheus_vita.upload":header.kind==3?"ux0:data/prometheus_pkg/eboot.upload":header.kind==4?"ux0:data/prometheus_pkg/sce_sys/param.upload":header.kind==5?"ux0:data/prometheus_pkg/sce_sys/package/head.upload":header.kind==7?"ur0:tai/prometheus_vita_control.upload":header.kind==8?"ur0:tai/prometheus_vita_input.upload":"ux0:data/prometheus_pkg/assets/environment-atlas.upload";
        const char*final=header.kind==1?"ux0:downloads/figure8_vita.vpk":header.kind==2?"ux0:downloads/prometheus_vita.vpk":header.kind==3?"ux0:data/prometheus_pkg/eboot.bin":header.kind==4?"ux0:data/prometheus_pkg/sce_sys/param.sfo":header.kind==5?"ux0:data/prometheus_pkg/sce_sys/package/head.bin":header.kind==7?"ur0:tai/prometheus_vita_control.suprx":header.kind==8?"ur0:tai/prometheus_vita_input.skprx":"ux0:data/prometheus_pkg/assets/environment-atlas.jpg";
        const char*backup=header.kind==7?"ur0:tai/prometheus_vita_control.previous.suprx":header.kind==8?"ur0:tai/prometheus_vita_input.previous.skprx":0;
        SceUID fd=sceIoOpen(temp,SCE_O_WRONLY|SCE_O_CREAT|SCE_O_TRUNC,0666);uint8_t block[8192];uint32_t hash=2166136261u;
        if(fd>=0){ack.status=0;while(ack.received<header.total_size){unsigned int wanted=header.total_size-ack.received;if(wanted>sizeof(block))wanted=sizeof(block);
          int n=receive_exact(client,block,wanted);if(n!=(int)wanted){ack.status=2;break;}if(sceIoWrite(fd,block,wanted)!=(int)wanted){ack.status=3;break;}
          for(unsigned int i=0;i<wanted;++i){hash^=block[i];hash*=16777619u;}ack.received+=wanted;}
          sceIoClose(fd);ack.checksum=hash;
          if(ack.status==0&&hash==header.checksum){
            if(backup){sceIoRemove(backup);int saved=sceIoRename(final,backup)>=0;if(sceIoRename(temp,final)<0){ack.status=5;if(saved)sceIoRename(backup,final);}}
            else{sceIoRemove(final);if(sceIoRename(temp,final)<0)ack.status=5;}
          }
          else{if(ack.status==0)ack.status=4;sceIoRemove(temp);}
        }
      }
      net_send(client,&ack,sizeof(ack),0);net_close(client);
    }
    net_close(server);
  }return 0;
}

static uint32_t checksum(const void*value,unsigned int size){
  const uint8_t*b=(const uint8_t*)value;uint32_t h=2166136261u;
  for(unsigned int i=0;i<size-sizeof(uint32_t);++i){h^=b[i];h*=16777619u;}return h;
}

static int control_thread(SceSize args,void*argp){
  (void)args;(void)argp;sceKernelDelayThread(8*1000*1000);
  while(running){
    if(resolve_network()<0){sceKernelDelayThread(1000*1000);continue;}
    int sock=net_socket("prom_vita_wifi",SCE_NET_AF_INET,SCE_NET_SOCK_DGRAM,SCE_NET_IPPROTO_UDP);
    if(sock<0){sceKernelDelayThread(1000*1000);continue;}
    SceNetSockaddrIn addr;sceClibMemset(&addr,0,sizeof(addr));addr.sin_len=sizeof(addr);
    addr.sin_family=SCE_NET_AF_INET;addr.sin_port=__builtin_bswap16(INPUT_PORT);addr.sin_addr.s_addr=SCE_NET_INADDR_ANY;
    if(net_bind(sock,(const SceNetSockaddr*)&addr,sizeof(addr))<0){net_close(sock);sceKernelDelayThread(1000*1000);continue;}
    int stream_ticks=0,power_ticks=0;uint16_t stream_chunk=0,stream_count=0;uint32_t last_bridge_packet_us=0;
    while(running){
      InputPacket packet;SceNetSockaddrIn sender;unsigned int sender_len=sizeof(sender);sceClibMemset(&sender,0,sizeof(sender));
      int received=net_recvfrom(sock,&packet,sizeof(packet),SCE_NET_MSG_DONTWAIT,(SceNetSockaddr*)&sender,&sender_len);
      if(received==(int)sizeof(packet)&&packet.magic==PACKET_MAGIC&&packet.version==PACKET_VERSION&&
         packet.size==sizeof(packet)&&packet.checksum==checksum(&packet,sizeof(packet))){
        last_bridge_packet_us=sceKernelGetProcessTimeLow();
        stream_peer=sender;stream_peer.sin_port=__builtin_bswap16(FRAME_PORT);stream_peer_known=1;
        AckPacket ack;sceClibMemset(&ack,0,sizeof(ack));ack.magic=ACK_MAGIC;ack.version=1;ack.size=sizeof(ack);
        ack.sequence=packet.sequence;ack.status=(packet.buttons&KEEP_AWAKE_FLAG)?2:1;
        if(!(packet.buttons&KEEP_AWAKE_FLAG)){
          ack.button_result=promVitaSetButtons(packet.buttons,HOLD_SAMPLES);
          ack.analog_result=promVitaSetAnalog(packet.lx,packet.ly,packet.rx,packet.ry,HOLD_SAMPLES);
        }
        ack.checksum=checksum(&ack,sizeof(ack));
        net_sendto(sock,&ack,sizeof(ack),0,(const SceNetSockaddr*)&sender,sender_len);
      }
      if(++power_ticks>=200){
        power_ticks=0;uint32_t now=sceKernelGetProcessTimeLow();
        if(last_bridge_packet_us&&now-last_bridge_packet_us<KEEP_AWAKE_WINDOW_US)
          sceKernelPowerTick(SCE_KERNEL_POWER_TICK_DEFAULT);
      }
      if(stream_peer_known&&stream_chunk<stream_count){
        unsigned int offset=stream_chunk*FRAME_PAYLOAD;uint16_t payload=(FRAME_BYTES-offset)<FRAME_PAYLOAD?(FRAME_BYTES-offset):FRAME_PAYLOAD;
        uint8_t datagram[sizeof(FrameHeader)+FRAME_PAYLOAD];
        FrameHeader header={0x52465650u,1,sizeof(FrameHeader),frame_id,stream_chunk,stream_count,payload,FRAME_WIDTH,FRAME_HEIGHT,1};
        sceClibMemcpy(datagram,&header,sizeof(header));sceClibMemcpy(datagram+sizeof(header),frame_pixels+offset,payload);
        net_sendto(sock,datagram,sizeof(header)+payload,0,(const SceNetSockaddr*)&stream_peer,sizeof(stream_peer));
        if(++stream_chunk>=stream_count){++frame_id;stream_ticks=0;}
      }else if(stream_peer_known&&++stream_ticks>=20){
        stream_ticks=0;int bytes=promVitaCaptureFrame(frame_pixels,sizeof(frame_pixels));
        if(bytes==FRAME_BYTES){stream_count=(FRAME_BYTES+FRAME_PAYLOAD-1)/FRAME_PAYLOAD;stream_chunk=0;}
      }
      sceKernelDelayThread(5*1000);
    }
    net_close(sock);
  }
  promVitaSetButtons(0,1);promVitaSetAnalog(128,128,128,128,1);return 0;
}

int module_start(SceSize args,void*argp){
  (void)args;(void)argp;running=1;
  worker_uid=sceKernelCreateThread("prom_vita_wifi_thread",control_thread,0x60,0x4000,0,0,0);
  if(worker_uid<0)return SCE_KERNEL_START_FAILED;
  if(sceKernelStartThread(worker_uid,0,0)<0)return SCE_KERNEL_START_FAILED;
  upload_uid=sceKernelCreateThread("prom_vita_upload_thread",upload_thread,0x62,0x5000,0,0,0);
  if(upload_uid>=0)sceKernelStartThread(upload_uid,0,0);
  return SCE_KERNEL_START_SUCCESS;
}
int module_stop(SceSize args,void*argp){
  (void)args;(void)argp;running=0;return SCE_KERNEL_STOP_SUCCESS;
}
void _start() __attribute__((weak,alias("module_start")));
