cmake_minimum_required(VERSION 3.10)
if(NOT DEFINED CMAKE_TOOLCHAIN_FILE)
  set(CMAKE_TOOLCHAIN_FILE "$ENV{VITASDK}/share/vita.toolchain.cmake" CACHE PATH "VitaSDK toolchain")
endif()
project(prometheus_vita C CXX)
include("$ENV{VITASDK}/share/vita.cmake" REQUIRED)
set(VITA_APP_NAME "Prometheus")
set(VITA_TITLEID "PROMVITA1")
set(VITA_VERSION "00.23")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -std=gnu++17 -O2 -fno-exceptions -fno-rtti -Wall")
add_executable(${PROJECT_NAME} src/main.cpp)
target_link_libraries(${PROJECT_NAME}
  vita2d png jpeg freetype
  SceGxm_stub SceKernelDmacMgr_stub ScePgf_stub SceAppMgr_stub
  curl zstd ssl crypto z
  SceNet_stub SceNetCtl_stub SceHttp_stub SceSsl_stub
  SceSysmodule_stub SceCtrl_stub SceTouch_stub SceRtc_stub SceDisplay_stub SceAppUtil_stub
  SceCommonDialog_stub SceIme_stub SceLibKernel_stub
  stdc++ m c
)
vita_create_self(${PROJECT_NAME}.self ${PROJECT_NAME} UNSAFE)
vita_create_vpk(${PROJECT_NAME}.vpk ${VITA_TITLEID} ${PROJECT_NAME}.self VERSION ${VITA_VERSION} NAME ${VITA_APP_NAME})
