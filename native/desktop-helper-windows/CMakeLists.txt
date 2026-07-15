cmake_minimum_required(VERSION 3.24)
project(prometheus_desktop_helper LANGUAGES CXX)

add_executable(prometheus-desktop-helper main.cpp)
target_compile_features(prometheus-desktop-helper PRIVATE cxx_std_20)
target_compile_definitions(prometheus-desktop-helper PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(prometheus-desktop-helper PRIVATE advapi32 bcrypt d3d11 dxgi iphlpapi windowsapp windowscodecs ole32 shcore ws2_32)

if(MSVC)
  target_compile_options(prometheus-desktop-helper PRIVATE /W4 /EHsc /permissive- /utf-8)
endif()

install(TARGETS prometheus-desktop-helper RUNTIME DESTINATION bin)
