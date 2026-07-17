cmake_minimum_required(VERSION 3.10)
if(NOT DEFINED CMAKE_TOOLCHAIN_FILE)
  set(CMAKE_TOOLCHAIN_FILE "$ENV{VITASDK}/share/vita.toolchain.cmake" CACHE PATH "toolchain")
endif()
project(prometheus_vita_control C)
include("${VITASDK}/share/vita.cmake" REQUIRED)
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -O2 -Wall -Wextra")
add_executable(${PROJECT_NAME} main.c)
target_link_directories(${PROJECT_NAME} PRIVATE ../input-plugin/build/stubs)
target_link_libraries(${PROJECT_NAME}
  prometheus_vita_input_stub
  SceLibKernel_stub
  SceKernelThreadMgr_stub
  SceProcessmgr_stub
  SceIofilemgr_stub
  SceSysmodule_stub
  taihen_stub
)
set_target_properties(${PROJECT_NAME} PROPERTIES LINK_FLAGS "-nostdlib")
vita_create_self(${PROJECT_NAME}.suprx ${PROJECT_NAME} CONFIG plugin.yml UNSAFE)
