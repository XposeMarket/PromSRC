cmake_minimum_required(VERSION 3.10)
if(NOT DEFINED CMAKE_TOOLCHAIN_FILE)
  if(DEFINED ENV{VITASDK})
    set(CMAKE_TOOLCHAIN_FILE "$ENV{VITASDK}/share/vita.toolchain.cmake" CACHE PATH "VitaSDK toolchain")
  else()
    message(FATAL_ERROR "Export VITASDK=/usr/local/vitasdk")
  endif()
endif()
project(vitalink_probe C)
include("$ENV{VITASDK}/share/vita.cmake" REQUIRED)
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -std=c11 -O2 -Wall -Wextra")
add_executable(${PROJECT_NAME} src/main.c src/bt_adapter.c)
target_link_libraries(${PROJECT_NAME}
  vita2d png jpeg freetype
  SceGxm_stub SceKernelDmacMgr_stub ScePgf_stub
  SceCtrl_stub
  SceDisplay_stub
  SceLibKernel_stub
  SceSysmem_stub
  SceIofilemgr_stub
  SceSysmodule_stub
  SceAppMgr_stub
  SceAppUtil_stub
  SceCommonDialog_stub
  SceNet_stub
  SceNetCtl_stub
  stdc++ m c)
vita_create_self(${PROJECT_NAME}.self ${PROJECT_NAME} UNSAFE)
vita_create_vpk(${PROJECT_NAME}.vpk VTLINK001 ${PROJECT_NAME}.self
  VERSION 01.00
  NAME "VitaLink Probe"
  FILE assets/sce_sys/icon0.png sce_sys/icon0.png)
