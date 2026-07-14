cmake_minimum_required(VERSION 3.10)

if(NOT DEFINED CMAKE_TOOLCHAIN_FILE)
  if(DEFINED ENV{VITASDK})
    set(CMAKE_TOOLCHAIN_FILE "$ENV{VITASDK}/share/vita.toolchain.cmake" CACHE PATH "VitaSDK toolchain")
  else()
    message(FATAL_ERROR "VITASDK is not set. Export VITASDK=/usr/local/vitasdk")
  endif()
endif()

project(figure8_vita C CXX)
include("$ENV{VITASDK}/share/vita.cmake" REQUIRED)

set(VITA_APP_NAME "Figure 8 Drift")
set(VITA_TITLEID "FIG8VITA1")
set(VITA_VERSION "01.00")

set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -std=gnu++17 -O2 -ffast-math -fno-exceptions -fno-rtti -Wall")

add_executable(${PROJECT_NAME}
  src/main.cpp
)

target_link_libraries(${PROJECT_NAME}
  vitaGL
  vitashark
  SceShaccCgExt
  SceShaccCg_stub
  taihen_stub
  SceKernelDmacMgr_stub
  SceGxm_stub
  SceDisplay_stub
  SceSysmodule_stub
  SceCtrl_stub
  SceTouch_stub
  SceAppMgr_stub
  SceAppUtil_stub
  SceCommonDialog_stub
  SceLibKernel_stub
  mathneon
  stdc++
  m
  c
  z
)

vita_create_self(${PROJECT_NAME}.self ${PROJECT_NAME} UNSAFE)
vita_create_vpk(${PROJECT_NAME}.vpk ${VITA_TITLEID} ${PROJECT_NAME}.self
  VERSION ${VITA_VERSION}
  NAME ${VITA_APP_NAME}
)
