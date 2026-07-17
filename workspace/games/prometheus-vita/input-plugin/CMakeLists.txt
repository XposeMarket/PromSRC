cmake_minimum_required(VERSION 3.10)

if(NOT DEFINED CMAKE_TOOLCHAIN_FILE)
  if(DEFINED ENV{VITASDK})
    set(CMAKE_TOOLCHAIN_FILE "$ENV{VITASDK}/share/vita.toolchain.cmake" CACHE PATH "toolchain file")
  else()
    message(FATAL_ERROR "Please define VITASDK")
  endif()
endif()

project(prometheus_vita_input C)
include("${VITASDK}/share/vita.cmake" REQUIRED)

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -O2 -Wall -Wextra")
add_executable(${PROJECT_NAME} main.c)
target_link_libraries(${PROJECT_NAME}
  SceCtrlForDriver_stub
  SceDisplayForDriver_stub
  SceIofilemgrForDriver_stub
  SceSysmemForDriver_stub
  SceNetPsForDriver_stub
  SceSysclibForDriver_stub
  SceThreadmgrForDriver_stub
)
set_target_properties(${PROJECT_NAME} PROPERTIES LINK_FLAGS "-nostdlib")
vita_create_self(${PROJECT_NAME}.skprx ${PROJECT_NAME} CONFIG plugin.yml UNSAFE)
vita_create_stubs(stubs ${PROJECT_NAME} ${CMAKE_CURRENT_SOURCE_DIR}/plugin.yml KERNEL)
add_custom_target(${PROJECT_NAME}_stubs ALL
  DEPENDS lib${PROJECT_NAME}_stub.a lib${PROJECT_NAME}_stub_weak.a)
