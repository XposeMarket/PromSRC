#include <winsock2.h>
#include <ws2ipdef.h>
#include <windows.h>
#include <sddl.h>
#include <iphlpapi.h>
#include <d3d11.h>
#include <bcrypt.h>
#include <wincodec.h>
#include <dwmapi.h>
#include <wrl/client.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <UIAutomation.h>
#include <oleauto.h>

#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>

#include <algorithm>
#include <atomic>
#include <functional>
#include <memory>
#include <thread>
#include <chrono>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <map>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;
using namespace winrt;
namespace wgc = winrt::Windows::Graphics::Capture;
namespace wgdx = winrt::Windows::Graphics::DirectX;
namespace wgd3d = winrt::Windows::Graphics::DirectX::Direct3D11;
namespace wf = winrt::Windows::Foundation;

namespace {

std::string json_escape(const std::string& value) {
  std::ostringstream out;
  for (const unsigned char ch : value) {
    switch (ch) {
      case '"': out << "\\\""; break;
      case '\\': out << "\\\\"; break;
      case '\b': out << "\\b"; break;
      case '\f': out << "\\f"; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (ch < 0x20) {
          char buf[7]{};
          sprintf_s(buf, "\\u%04x", ch);
          out << buf;
        } else out << ch;
    }
  }
  return out.str();
}

std::string utf8(const std::wstring& value) {
  if (value.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string result(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
  return result;
}

long long number_field(const std::string& json, const char* field, long long fallback = 0) {
  const std::regex pattern(std::string("\\\"") + field + "\\\"\\s*:\\s*(-?[0-9]+)", std::regex::icase);
  std::smatch match;
  return std::regex_search(json, match, pattern) ? std::stoll(match[1].str()) : fallback;
}

std::string string_field(const std::string& json, const char* field) {
  const std::regex pattern(std::string("\\\"") + field + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"", std::regex::icase);
  std::smatch match;
  return std::regex_search(json, match, pattern) ? match[1].str() : std::string{};
}

std::string decode_base64(const std::string& value) {
  static const std::string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  int accumulator = 0;
  int bits = -8;
  for (const unsigned char ch : value) {
    if (ch == '=') break;
    const auto pos = alphabet.find(static_cast<char>(ch));
    if (pos == std::string::npos) continue;
    accumulator = (accumulator << 6) | static_cast<int>(pos);
    bits += 6;
    if (bits >= 0) {
      out.push_back(static_cast<char>((accumulator >> bits) & 0xff));
      bits -= 8;
    }
  }
  return out;
}

std::wstring utf16_from_utf8(const std::string& value) {
  if (value.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
  if (size <= 0) throw std::runtime_error("Invalid UTF-8 text payload");
  std::wstring result(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size);
  return result;
}

std::string read_binary_file(const std::wstring& file_path) {
  std::ifstream input(file_path, std::ios::binary);
  if (!input) throw std::runtime_error("Could not open elevated command request file");
  return std::string(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>());
}

std::string sha256_hex(const std::string& value) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  DWORD object_size = 0;
  DWORD hash_size = 0;
  DWORD received = 0;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) {
    throw std::runtime_error("Could not initialize SHA-256");
  }
  if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&object_size), sizeof(object_size), &received, 0) != 0
      || BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH, reinterpret_cast<PUCHAR>(&hash_size), sizeof(hash_size), &received, 0) != 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    throw std::runtime_error("Could not inspect SHA-256 provider");
  }
  std::vector<unsigned char> object(object_size);
  std::vector<unsigned char> digest(hash_size);
  if (BCryptCreateHash(algorithm, &hash, object.data(), object_size, nullptr, 0, 0) != 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    throw std::runtime_error("Could not create SHA-256 hash");
  }
  if (BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())), static_cast<ULONG>(value.size()), 0) != 0
      || BCryptFinishHash(hash, digest.data(), hash_size, 0) != 0) {
    BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    throw std::runtime_error("Could not calculate request SHA-256");
  }
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  std::ostringstream output;
  output << std::hex << std::setfill('0');
  for (const unsigned char byte : digest) output << std::setw(2) << static_cast<int>(byte);
  return output.str();
}

bool is_running_as_administrator() {
  SID_IDENTIFIER_AUTHORITY authority = SECURITY_NT_AUTHORITY;
  PSID administrators = nullptr;
  if (!AllocateAndInitializeSid(&authority, 2, SECURITY_BUILTIN_DOMAIN_RID,
        DOMAIN_ALIAS_RID_ADMINS, 0, 0, 0, 0, 0, 0, &administrators)) return false;
  BOOL member = FALSE;
  CheckTokenMembership(nullptr, administrators, &member);
  FreeSid(administrators);
  return member == TRUE;
}

void write_elevated_result(const std::wstring& result_path, const std::string& json) {
  std::ofstream output(result_path, std::ios::binary | std::ios::trunc);
  if (!output) throw std::runtime_error("Could not write elevated command result");
  output << json;
  output.flush();
}

int run_elevated_command(const std::wstring& request_path, const std::wstring& expected_hash, const std::wstring& result_path) {
  try {
    if (!is_running_as_administrator()) throw std::runtime_error("Elevated helper did not receive an administrator token");
    const std::string request = read_binary_file(request_path);
    std::string expected = utf8(expected_hash);
    std::transform(expected.begin(), expected.end(), expected.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
    if (sha256_hex(request) != expected) throw std::runtime_error("Elevated command request integrity check failed");

    const std::wstring command = utf16_from_utf8(decode_base64(string_field(request, "commandBase64")));
    const std::wstring cwd = utf16_from_utf8(decode_base64(string_field(request, "cwdBase64")));
    const std::string shell = string_field(request, "shell");
    const DWORD timeout_ms = static_cast<DWORD>(std::clamp<long long>(number_field(request, "timeoutMs", 120000), 1000, 86400000));
    if (command.empty() || cwd.empty()) throw std::runtime_error("Elevated command request is incomplete");

    std::wstring command_line;
    if (shell == "cmd") {
      command_line = L"cmd.exe /d /s /c " + command;
    } else if (shell == "bash") {
      command_line = L"bash.exe -lc \"" + command + L"\"";
    } else {
      command_line = L"powershell.exe -NoProfile -ExecutionPolicy Bypass -Command " + command;
    }
    std::vector<wchar_t> mutable_command(command_line.begin(), command_line.end());
    mutable_command.push_back(L'\0');

    SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    const std::wstring stdout_path = result_path + L".stdout";
    const std::wstring stderr_path = result_path + L".stderr";
    HANDLE stdout_file = CreateFileW(stdout_path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, &security, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    HANDLE stderr_file = CreateFileW(stderr_path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, &security, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    HANDLE null_input = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &security, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (stdout_file == INVALID_HANDLE_VALUE || stderr_file == INVALID_HANDLE_VALUE || null_input == INVALID_HANDLE_VALUE) {
      if (stdout_file != INVALID_HANDLE_VALUE) CloseHandle(stdout_file);
      if (stderr_file != INVALID_HANDLE_VALUE) CloseHandle(stderr_file);
      if (null_input != INVALID_HANDLE_VALUE) CloseHandle(null_input);
      throw std::runtime_error("Could not create elevated command capture files");
    }

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = null_input;
    startup.hStdOutput = stdout_file;
    startup.hStdError = stderr_file;
    PROCESS_INFORMATION process{};
    const BOOL created = CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, cwd.c_str(), &startup, &process);
    CloseHandle(stdout_file);
    CloseHandle(stderr_file);
    CloseHandle(null_input);
    if (!created) throw std::runtime_error("Could not start elevated command (Windows error " + std::to_string(GetLastError()) + ")");

    const DWORD wait_result = WaitForSingleObject(process.hProcess, timeout_ms);
    bool timed_out = wait_result == WAIT_TIMEOUT;
    if (timed_out) {
      TerminateProcess(process.hProcess, 124);
      WaitForSingleObject(process.hProcess, 5000);
    }
    DWORD exit_code = 1;
    GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);

    write_elevated_result(result_path,
      std::string("{\"ok\":true,\"elevated\":true,\"exitCode\":") + std::to_string(exit_code)
      + ",\"timedOut\":" + (timed_out ? "true" : "false") + "}");
    return timed_out ? 124 : static_cast<int>(exit_code);
  } catch (const std::exception& error) {
    try {
      write_elevated_result(result_path, std::string("{\"ok\":false,\"elevated\":true,\"error\":\"") + json_escape(error.what()) + "\"}");
    } catch (...) {}
    return 2;
  }
}

std::wstring normalized_full_path(const std::wstring& input) {
  const DWORD required = GetFullPathNameW(input.c_str(), 0, nullptr, nullptr);
  if (!required) throw std::runtime_error("Could not normalize broker path");
  std::wstring output(static_cast<size_t>(required), L'\0');
  const DWORD written = GetFullPathNameW(input.c_str(), required, output.data(), nullptr);
  if (!written || written >= required) throw std::runtime_error("Could not normalize broker path");
  output.resize(written);
  std::transform(output.begin(), output.end(), output.begin(), ::towlower);
  return output;
}

bool path_is_inside(const std::wstring& root, const std::wstring& candidate) {
  std::wstring base = normalized_full_path(root);
  const std::wstring target = normalized_full_path(candidate);
  if (!base.empty() && base.back() != L'\\') base.push_back(L'\\');
  return target.size() > base.size() && target.compare(0, base.size(), base) == 0;
}

std::wstring client_process_path(HANDLE pipe) {
  ULONG pid = 0;
  if (!GetNamedPipeClientProcessId(pipe, &pid) || !pid) throw std::runtime_error("Could not identify elevated broker client");
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) throw std::runtime_error("Could not inspect elevated broker client");
  std::wstring image(32768, L'\0');
  DWORD size = static_cast<DWORD>(image.size());
  const BOOL ok = QueryFullProcessImageNameW(process, 0, image.data(), &size);
  CloseHandle(process);
  if (!ok) throw std::runtime_error("Could not resolve elevated broker client image");
  image.resize(size);
  return normalized_full_path(image);
}

bool process_owns_listening_port(DWORD pid, unsigned short port) {
  ULONG ipv4_size = 0;
  GetExtendedTcpTable(nullptr, &ipv4_size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0);
  std::vector<unsigned char> ipv4_buffer(ipv4_size);
  if (GetExtendedTcpTable(ipv4_buffer.data(), &ipv4_size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0) == NO_ERROR) {
    const auto* table = reinterpret_cast<const MIB_TCPTABLE_OWNER_PID*>(ipv4_buffer.data());
    for (DWORD index = 0; index < table->dwNumEntries; ++index) {
      const auto& row = table->table[index];
      if (row.dwOwningPid == pid && ntohs(static_cast<u_short>(row.dwLocalPort)) == port) return true;
    }
  }

  ULONG ipv6_size = 0;
  GetExtendedTcpTable(nullptr, &ipv6_size, FALSE, AF_INET6, TCP_TABLE_OWNER_PID_LISTENER, 0);
  std::vector<unsigned char> ipv6_buffer(ipv6_size);
  if (GetExtendedTcpTable(ipv6_buffer.data(), &ipv6_size, FALSE, AF_INET6, TCP_TABLE_OWNER_PID_LISTENER, 0) == NO_ERROR) {
    const auto* table = reinterpret_cast<const MIB_TCP6TABLE_OWNER_PID*>(ipv6_buffer.data());
    for (DWORD index = 0; index < table->dwNumEntries; ++index) {
      const auto& row = table->table[index];
      if (row.dwOwningPid == pid && ntohs(static_cast<u_short>(row.dwLocalPort)) == port) return true;
    }
  }
  return false;
}

std::string read_pipe_message(HANDLE pipe) {
  std::string message;
  char buffer[4096];
  DWORD received = 0;
  while (message.size() < 1024 * 1024) {
    const BOOL ok = ReadFile(pipe, buffer, sizeof(buffer), &received, nullptr);
    if (received) message.append(buffer, buffer + received);
    if (ok) break;
    if (GetLastError() != ERROR_MORE_DATA) throw std::runtime_error("Could not read elevated broker request");
  }
  if (message.size() >= 1024 * 1024) throw std::runtime_error("Elevated broker request is too large");
  return message;
}

int run_elevated_broker(const std::wstring& pipe_name, const std::wstring& queue_dir,
                        const std::wstring& allowed_client, const std::wstring& user_sid, unsigned short gateway_port) {
  if (!is_running_as_administrator()) return 3;
  const std::wstring allowed_image = normalized_full_path(allowed_client);
  const std::wstring sddl = L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;" + user_sid + L")";
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr)) return 4;
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};

  for (;;) {
    HANDLE pipe = CreateNamedPipeW(pipe_name.c_str(), PIPE_ACCESS_DUPLEX,
      PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
      1, 4096, 4096, 0, &security);
    if (pipe == INVALID_HANDLE_VALUE) {
      LocalFree(descriptor);
      return 5;
    }
    const BOOL connected = ConnectNamedPipe(pipe, nullptr) ? TRUE : GetLastError() == ERROR_PIPE_CONNECTED;
    if (!connected) {
      CloseHandle(pipe);
      continue;
    }

    std::string response = "{\"ok\":false,\"error\":\"Elevated broker request failed\"}";
    try {
      // Read the complete message before authenticating the client. If authentication
      // fails, the connected gateway then receives the precise broker error instead
      // of seeing an opaque EPIPE while it is still writing the request.
      const std::string request = read_pipe_message(pipe);
      ULONG client_pid = 0;
      if (!GetNamedPipeClientProcessId(pipe, &client_pid) || !client_pid) throw std::runtime_error("Could not identify elevated broker client");
      if (client_process_path(pipe) != allowed_image) throw std::runtime_error("Elevated broker rejected an unexpected client executable");
      if (!process_owns_listening_port(client_pid, gateway_port)) throw std::runtime_error("Elevated broker client does not own the configured Prometheus gateway port");
      const std::wstring command_request = utf16_from_utf8(decode_base64(string_field(request, "requestPathBase64")));
      const std::wstring result_path = utf16_from_utf8(decode_base64(string_field(request, "resultPathBase64")));
      const std::wstring request_hash = utf16_from_utf8(string_field(request, "requestHash"));
      if (!path_is_inside(queue_dir, command_request) || !path_is_inside(queue_dir, result_path)) {
        throw std::runtime_error("Elevated broker request paths escaped the broker queue");
      }
      run_elevated_command(command_request, request_hash, result_path);
      response = "{\"ok\":true}";
    } catch (const std::exception& error) {
      response = std::string("{\"ok\":false,\"error\":\"") + json_escape(error.what()) + "\"}";
    }
    DWORD written = 0;
    WriteFile(pipe, response.data(), static_cast<DWORD>(response.size()), &written, nullptr);
    FlushFileBuffers(pipe);
    DisconnectNamedPipe(pipe);
    CloseHandle(pipe);
  }
}

void send_keyboard(WORD virtual_key, DWORD flags = 0, WORD scan = 0) {
  INPUT input{};
  input.type = INPUT_KEYBOARD;
  input.ki.wVk = virtual_key;
  input.ki.wScan = scan;
  input.ki.dwFlags = flags;
  if (SendInput(1, &input, sizeof(INPUT)) != 1) throw std::runtime_error("SendInput(keyboard) failed");
}

void type_unicode(const std::wstring& text) {
  for (const wchar_t ch : text) {
    send_keyboard(0, KEYEVENTF_UNICODE, static_cast<WORD>(ch));
    send_keyboard(0, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, static_cast<WORD>(ch));
  }
}

WORD virtual_key_for(const std::string& raw) {
  std::string key = raw;
  std::transform(key.begin(), key.end(), key.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
  if (key == "enter" || key == "return") return VK_RETURN;
  if (key == "escape" || key == "esc") return VK_ESCAPE;
  if (key == "tab") return VK_TAB;
  if (key == "space") return VK_SPACE;
  if (key == "backspace") return VK_BACK;
  if (key == "delete" || key == "del") return VK_DELETE;
  if (key == "up" || key == "arrowup") return VK_UP;
  if (key == "down" || key == "arrowdown") return VK_DOWN;
  if (key == "left" || key == "arrowleft") return VK_LEFT;
  if (key == "right" || key == "arrowright") return VK_RIGHT;
  if (key == "pageup" || key == "pgup") return VK_PRIOR;
  if (key == "pagedown" || key == "pgdn") return VK_NEXT;
  if (key == "home") return VK_HOME;
  if (key == "end") return VK_END;
  if (key == "insert" || key == "ins") return VK_INSERT;
  if (key.size() >= 2 && key[0] == 'f') {
    const int function_number = std::atoi(key.c_str() + 1);
    if (function_number >= 1 && function_number <= 24) return static_cast<WORD>(VK_F1 + function_number - 1);
  }
  if (raw.size() == 1) {
    const SHORT mapped = VkKeyScanA(raw[0]);
    if (mapped != -1) return static_cast<WORD>(mapped & 0xff);
  }
  throw std::runtime_error("Unsupported key: " + raw);
}

void press_key(const std::string& key, bool ctrl, bool shift, bool alt) {
  const WORD vk = virtual_key_for(key);
  if (ctrl) send_keyboard(VK_CONTROL);
  if (shift) send_keyboard(VK_SHIFT);
  if (alt) send_keyboard(VK_MENU);
  send_keyboard(vk);
  send_keyboard(vk, KEYEVENTF_KEYUP);
  if (alt) send_keyboard(VK_MENU, KEYEVENTF_KEYUP);
  if (shift) send_keyboard(VK_SHIFT, KEYEVENTF_KEYUP);
  if (ctrl) send_keyboard(VK_CONTROL, KEYEVENTF_KEYUP);
}

bool focus_window(HWND hwnd) {
  if (!IsWindow(hwnd)) return false;
  if (IsIconic(hwnd)) ShowWindowAsync(hwnd, SW_RESTORE);
  const DWORD foreground_thread = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
  const DWORD current_thread = GetCurrentThreadId();
  bool attached = false;
  if (foreground_thread && foreground_thread != current_thread) {
    attached = AttachThreadInput(current_thread, foreground_thread, TRUE) != FALSE;
  }
  BringWindowToTop(hwnd);
  const bool focused = SetForegroundWindow(hwnd) != FALSE;
  if (attached) AttachThreadInput(current_thread, foreground_thread, FALSE);
  return focused || GetForegroundWindow() == hwnd;
}

void send_mouse(DWORD flags, LONG data = 0) {
  INPUT input{};
  input.type = INPUT_MOUSE;
  input.mi.dwFlags = flags;
  input.mi.mouseData = data;
  if (SendInput(1, &input, sizeof(INPUT)) != 1) throw std::runtime_error("SendInput(mouse) failed");
}

void click_pointer(int x, int y, const std::string& button, int repeat) {
  if (!SetCursorPos(x, y)) throw std::runtime_error("SetCursorPos failed");
  const bool right = button == "right" || button == "r";
  const bool middle = button == "middle" || button == "m";
  const DWORD down = right ? MOUSEEVENTF_RIGHTDOWN : middle ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_LEFTDOWN;
  const DWORD up = right ? MOUSEEVENTF_RIGHTUP : middle ? MOUSEEVENTF_MIDDLEUP : MOUSEEVENTF_LEFTUP;
  const int count = std::clamp(repeat, 1, 4);
  for (int i = 0; i < count; ++i) {
    send_mouse(down);
    send_mouse(up);
    if (i + 1 < count) Sleep(80);
  }
}

void scroll_pointer(int x, int y, int delta_x, int delta_y) {
  if (!SetCursorPos(x, y)) throw std::runtime_error("SetCursorPos failed");
  if (delta_y) send_mouse(MOUSEEVENTF_WHEEL, delta_y);
  if (delta_x) send_mouse(MOUSEEVENTF_HWHEEL, delta_x);
}

void drag_pointer(int from_x, int from_y, int to_x, int to_y, int steps) {
  const int count = std::clamp(steps, 2, 100);
  if (!SetCursorPos(from_x, from_y)) throw std::runtime_error("SetCursorPos(drag start) failed");
  send_mouse(MOUSEEVENTF_LEFTDOWN);
  for (int i = 1; i <= count; ++i) {
    const int x = from_x + ((to_x - from_x) * i / count);
    const int y = from_y + ((to_y - from_y) * i / count);
    SetCursorPos(x, y);
    Sleep(4);
  }
  send_mouse(MOUSEEVENTF_LEFTUP);
}

struct D3DContext {
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> context;
  wgd3d::IDirect3DDevice winrt_device{nullptr};
};

D3DContext make_d3d() {
  D3DContext result;
  D3D_FEATURE_LEVEL selected{};
  const D3D_FEATURE_LEVEL levels[] = {
    D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0,
    D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0,
  };
  check_hresult(D3D11CreateDevice(
    nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    levels, static_cast<UINT>(_countof(levels)), D3D11_SDK_VERSION,
    &result.device, &selected, &result.context));

  ComPtr<IDXGIDevice> dxgi;
  check_hresult(result.device.As(&dxgi));
  com_ptr<IInspectable> inspectable;
  check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.Get(), inspectable.put()));
  result.winrt_device = inspectable.as<wgd3d::IDirect3DDevice>();
  return result;
}

wgc::GraphicsCaptureItem item_for_window(HWND hwnd) {
  auto factory = get_activation_factory<wgc::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
  wgc::GraphicsCaptureItem item{nullptr};
  check_hresult(factory->CreateForWindow(hwnd, guid_of<wgc::GraphicsCaptureItem>(), put_abi(item)));
  return item;
}

ComPtr<ID3D11Texture2D> texture_from_surface(const wgd3d::IDirect3DSurface& surface) {
  auto access = surface.as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
  ComPtr<ID3D11Texture2D> texture;
  check_hresult(access->GetInterface(IID_PPV_ARGS(&texture)));
  return texture;
}

std::wstring temp_png_path() {
  wchar_t temp_dir[MAX_PATH]{};
  if (!GetTempPathW(MAX_PATH, temp_dir)) throw std::runtime_error("GetTempPathW failed");
  wchar_t temp_file[MAX_PATH]{};
  if (!GetTempFileNameW(temp_dir, L"pmw", 0, temp_file)) throw std::runtime_error("GetTempFileNameW failed");
  std::wstring path(temp_file);
  const auto dot = path.find_last_of(L'.');
  if (dot != std::wstring::npos) path.resize(dot);
  path += L".png";
  DeleteFileW(temp_file);
  return path;
}

void encode_png(ID3D11Device* device, ID3D11DeviceContext* context, ID3D11Texture2D* source, const std::wstring& path) {
  D3D11_TEXTURE2D_DESC desc{};
  source->GetDesc(&desc);
  D3D11_TEXTURE2D_DESC staging_desc = desc;
  staging_desc.BindFlags = 0;
  staging_desc.MiscFlags = 0;
  staging_desc.Usage = D3D11_USAGE_STAGING;
  staging_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  staging_desc.ArraySize = 1;
  staging_desc.MipLevels = 1;

  ComPtr<ID3D11Texture2D> staging;
  winrt::check_hresult(device->CreateTexture2D(&staging_desc, nullptr, &staging));
  context->CopyResource(staging.Get(), source);

  D3D11_MAPPED_SUBRESOURCE mapped{};
  winrt::check_hresult(context->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped));
  struct UnmapGuard {
    ID3D11DeviceContext* context;
    ID3D11Resource* resource;
    ~UnmapGuard() { context->Unmap(resource, 0); }
  } guard{context, staging.Get()};

  ComPtr<IWICImagingFactory> factory;
  winrt::check_hresult(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)));
  ComPtr<IWICStream> stream;
  winrt::check_hresult(factory->CreateStream(&stream));
  winrt::check_hresult(stream->InitializeFromFilename(path.c_str(), GENERIC_WRITE));
  ComPtr<IWICBitmapEncoder> encoder;
  winrt::check_hresult(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder));
  winrt::check_hresult(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache));
  ComPtr<IWICBitmapFrameEncode> frame;
  ComPtr<IPropertyBag2> properties;
  winrt::check_hresult(encoder->CreateNewFrame(&frame, &properties));
  winrt::check_hresult(frame->Initialize(properties.Get()));
  winrt::check_hresult(frame->SetSize(desc.Width, desc.Height));
  WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
  winrt::check_hresult(frame->SetPixelFormat(&format));
  winrt::check_hresult(frame->WritePixels(desc.Height, mapped.RowPitch, mapped.RowPitch * desc.Height, static_cast<BYTE*>(mapped.pData)));
  winrt::check_hresult(frame->Commit());
  winrt::check_hresult(encoder->Commit());
}

std::string capture_window(HWND hwnd) {
  if (!IsWindow(hwnd)) throw std::runtime_error("Requested HWND is not a live window");
  RECT rect{};
  if (!GetWindowRect(hwnd, &rect)) throw std::runtime_error("GetWindowRect failed");

  auto d3d = make_d3d();
  const auto item = item_for_window(hwnd);
  const auto size = item.Size();
  if (size.Width <= 0 || size.Height <= 0) throw std::runtime_error("Capture item has invalid dimensions");

  auto pool = wgc::Direct3D11CaptureFramePool::CreateFreeThreaded(
    d3d.winrt_device,
    wgdx::DirectXPixelFormat::B8G8R8A8UIntNormalized,
    1,
    size);
  auto session = pool.CreateCaptureSession(item);

  winrt::handle event{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
  if (!event) throw std::runtime_error("CreateEvent failed");
  std::mutex frame_mutex;
  wgc::Direct3D11CaptureFrame captured{nullptr};
  const auto token = pool.FrameArrived([&](wgc::Direct3D11CaptureFramePool const& sender, wf::IInspectable const&) {
    std::scoped_lock lock(frame_mutex);
    if (!captured) captured = sender.TryGetNextFrame();
    SetEvent(event.get());
  });
  session.StartCapture();
  const DWORD wait = WaitForSingleObject(event.get(), 10'000);
  pool.FrameArrived(token);
  session.Close();
  pool.Close();
  if (wait != WAIT_OBJECT_0) throw std::runtime_error("Timed out waiting for a Windows.Graphics.Capture frame");

  std::scoped_lock lock(frame_mutex);
  if (!captured) throw std::runtime_error("Capture frame was empty");
  auto texture = texture_from_surface(captured.Surface());
  const std::wstring output = temp_png_path();
  encode_png(d3d.device.Get(), d3d.context.Get(), texture.Get(), output);
  captured.Close();

  const int width = std::max(0L, rect.right - rect.left);
  const int height = std::max(0L, rect.bottom - rect.top);
  std::ostringstream json;
  json << "{\"pngPath\":\"" << json_escape(utf8(output))
       << "\",\"bounds\":{\"left\":" << rect.left
       << ",\"top\":" << rect.top
       << ",\"width\":" << width
       << ",\"height\":" << height
       << "},\"devicePixelRatio\":1}";
  return json.str();
}

// ── Screen capture (GDI BitBlt -> 24bpp DIB -> WIC PNG) ─────────────────────
// Coordinates are physical virtual-screen pixels (process is per-monitor-aware V2).

struct ScreenRect { int left; int top; int width; int height; };

// Monitors in EnumDisplayMonitors order. This is the same enumeration that
// System.Windows.Forms.Screen.AllScreens uses; the primary monitor is NOT
// guaranteed to be first.
std::vector<ScreenRect> enum_monitors() {
  std::vector<ScreenRect> out;
  EnumDisplayMonitors(nullptr, nullptr, [](HMONITOR monitor, HDC, LPRECT, LPARAM data) -> BOOL {
    MONITORINFO info{};
    info.cbSize = sizeof(info);
    if (GetMonitorInfoW(monitor, &info)) {
      const RECT& r = info.rcMonitor;
      reinterpret_cast<std::vector<ScreenRect>*>(data)->push_back({ r.left, r.top, r.right - r.left, r.bottom - r.top });
    }
    return TRUE;
  }, reinterpret_cast<LPARAM>(&out));
  return out;
}

ScreenRect primary_monitor_rect() {
  const POINT origin{0, 0};
  HMONITOR monitor = MonitorFromPoint(origin, MONITOR_DEFAULTTOPRIMARY);
  MONITORINFO info{};
  info.cbSize = sizeof(info);
  if (!monitor || !GetMonitorInfoW(monitor, &info)) {
    return { 0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN) };
  }
  const RECT& r = info.rcMonitor;
  return { r.left, r.top, r.right - r.left, r.bottom - r.top };
}

ScreenRect virtual_screen_rect() {
  return {
    GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN),
    GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN),
  };
}

void encode_png_bgr24(const BYTE* pixels, UINT width, UINT height, UINT stride, const std::wstring& path, bool filter_none) {
  static thread_local ComPtr<IWICImagingFactory> factory;
  if (!factory) {
    winrt::check_hresult(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)));
  }
  ComPtr<IWICStream> stream;
  winrt::check_hresult(factory->CreateStream(&stream));
  winrt::check_hresult(stream->InitializeFromFilename(path.c_str(), GENERIC_WRITE));
  ComPtr<IWICBitmapEncoder> encoder;
  winrt::check_hresult(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder));
  winrt::check_hresult(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache));
  ComPtr<IWICBitmapFrameEncode> frame;
  ComPtr<IPropertyBag2> properties;
  winrt::check_hresult(encoder->CreateNewFrame(&frame, &properties));
  if (filter_none && properties) {
    PROPBAG2 option{};
    option.pstrName = const_cast<LPOLESTR>(L"FilterOption");
    VARIANT value;
    VariantInit(&value);
    value.vt = VT_UI1;
    value.bVal = static_cast<BYTE>(WICPngFilterNone);
    properties->Write(1, &option, &value); // best effort
  }
  winrt::check_hresult(frame->Initialize(properties.Get()));
  winrt::check_hresult(frame->SetSize(width, height));
  WICPixelFormatGUID format = GUID_WICPixelFormat24bppBGR;
  winrt::check_hresult(frame->SetPixelFormat(&format));
  if (format != GUID_WICPixelFormat24bppBGR) throw std::runtime_error("WIC PNG encoder rejected 24bpp BGR");
  winrt::check_hresult(frame->WritePixels(height, stride, stride * height, const_cast<BYTE*>(pixels)));
  winrt::check_hresult(frame->Commit());
  winrt::check_hresult(encoder->Commit());
}

std::string capture_screen_rect(const ScreenRect& rect, bool filter_none) {
  if (rect.width <= 0 || rect.height <= 0) throw std::runtime_error("Capture rectangle has invalid dimensions");
  if (rect.width > 32768 || rect.height > 32768) throw std::runtime_error("Capture rectangle is too large");
  HDC screen = GetDC(nullptr);
  if (!screen) throw std::runtime_error("GetDC(screen) failed");
  HDC memory = CreateCompatibleDC(screen);
  BITMAPINFO bmi{};
  bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bmi.bmiHeader.biWidth = rect.width;
  bmi.bmiHeader.biHeight = -rect.height; // top-down
  bmi.bmiHeader.biPlanes = 1;
  bmi.bmiHeader.biBitCount = 24;
  bmi.bmiHeader.biCompression = BI_RGB;
  void* bits = nullptr;
  HBITMAP dib = memory ? CreateDIBSection(screen, &bmi, DIB_RGB_COLORS, &bits, nullptr, 0) : nullptr;
  struct GdiGuard {
    HDC screen; HDC memory; HBITMAP dib; HGDIOBJ old;
    ~GdiGuard() {
      if (memory && old) SelectObject(memory, old);
      if (dib) DeleteObject(dib);
      if (memory) DeleteDC(memory);
      if (screen) ReleaseDC(nullptr, screen);
    }
  } guard{screen, memory, dib, nullptr};
  if (!memory || !dib || !bits) throw std::runtime_error("CreateDIBSection failed");
  guard.old = SelectObject(memory, dib);
  if (!BitBlt(memory, 0, 0, rect.width, rect.height, screen, rect.left, rect.top, SRCCOPY | CAPTUREBLT)) {
    throw std::runtime_error("BitBlt from screen failed");
  }
  GdiFlush();
  const UINT stride = (static_cast<UINT>(rect.width) * 3u + 3u) & ~3u;
  const std::wstring output = temp_png_path();
  encode_png_bgr24(static_cast<const BYTE*>(bits), static_cast<UINT>(rect.width), static_cast<UINT>(rect.height), stride, output, filter_none);

  std::ostringstream json;
  json << "{\"pngPath\":\"" << json_escape(utf8(output))
       << "\",\"bounds\":{\"left\":" << rect.left
       << ",\"top\":" << rect.top
       << ",\"width\":" << rect.width
       << ",\"height\":" << rect.height
       << "},\"devicePixelRatio\":1}";
  return json.str();
}

// ── Window enumeration ───────────────────────────────────────────────────────

// Process name (image basename without ".exe", like Get-Process.ProcessName) and
// creation time in Unix ms (same truncation as PowerShell's
// [DateTimeOffset]::new(StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()).
struct ProcessIdentity { std::string name; long long start_ms = 0; };
ProcessIdentity process_identity(DWORD pid) {
  ProcessIdentity out;
  if (!pid) return out;
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return out;
  wchar_t image[MAX_PATH * 2]{};
  DWORD size = static_cast<DWORD>(std::size(image));
  if (QueryFullProcessImageNameW(process, 0, image, &size)) {
    std::wstring full(image, size);
    const size_t slash = full.find_last_of(L"\\/");
    std::wstring base = slash == std::wstring::npos ? full : full.substr(slash + 1);
    if (base.size() > 4) {
      std::wstring ext = base.substr(base.size() - 4);
      std::transform(ext.begin(), ext.end(), ext.begin(), ::towlower);
      if (ext == L".exe") base = base.substr(0, base.size() - 4);
    }
    out.name = utf8(base);
  }
  FILETIME created{}, exited{}, kernel{}, user{};
  if (GetProcessTimes(process, &created, &exited, &kernel, &user)) {
    ULARGE_INTEGER ticks{};
    ticks.LowPart = created.dwLowDateTime;
    ticks.HighPart = created.dwHighDateTime;
    const unsigned long long epoch = 116444736000000000ULL;
    if (ticks.QuadPart > epoch) out.start_ms = static_cast<long long>((ticks.QuadPart - epoch) / 10000ULL);
  }
  CloseHandle(process);
  return out;
}

// Index of the window's monitor in EnumDisplayMonitors order (matches
// System.Windows.Forms.Screen.AllScreens), or -1.
int window_monitor_index(HWND hwnd) {
  HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL);
  if (!monitor) return -1;
  struct Search { HMONITOR target; int index; int found; } search{ monitor, 0, -1 };
  EnumDisplayMonitors(nullptr, nullptr, [](HMONITOR m, HDC, LPRECT, LPARAM data) -> BOOL {
    auto* s = reinterpret_cast<Search*>(data);
    if (m == s->target) { s->found = s->index; return FALSE; }
    s->index += 1;
    return TRUE;
  }, reinterpret_cast<LPARAM>(&search));
  return search.found;
}

std::string window_json(HWND hwnd, HWND foreground) {
  RECT rect{};
  GetWindowRect(hwnd, &rect);
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  wchar_t title[512]{};
  const int title_len = GetWindowTextW(hwnd, title, 512);
  wchar_t class_name[256]{};
  const int class_len = GetClassNameW(hwnd, class_name, 256);
  const ProcessIdentity identity = process_identity(pid);
  std::ostringstream json;
  json << "{\"exists\":true,\"handle\":" << static_cast<long long>(reinterpret_cast<intptr_t>(hwnd))
       << ",\"pid\":" << pid
       << ",\"processName\":\"" << json_escape(identity.name) << "\""
       << ",\"processStartTime\":" << identity.start_ms
       << ",\"monitorIndex\":" << window_monitor_index(hwnd)
       << ",\"title\":\"" << json_escape(utf8(std::wstring(title, static_cast<size_t>(std::max(0, title_len)))))
       << "\",\"className\":\"" << json_escape(utf8(std::wstring(class_name, static_cast<size_t>(std::max(0, class_len)))))
       << "\",\"left\":" << rect.left
       << ",\"top\":" << rect.top
       << ",\"width\":" << (rect.right - rect.left)
       << ",\"height\":" << (rect.bottom - rect.top)
       << ",\"isMinimized\":" << (IsIconic(hwnd) ? "true" : "false")
       << ",\"isActive\":" << (hwnd == foreground ? "true" : "false")
       << "}";
  return json.str();
}

bool is_listable_window(HWND hwnd) {
  if (!IsWindowVisible(hwnd)) return false;
  DWORD cloaked = 0;
  if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) && cloaked) return false;
  RECT rect{};
  if (!GetWindowRect(hwnd, &rect) || rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) return false;
  const LONG_PTR ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  if ((ex_style & WS_EX_TOOLWINDOW) && GetWindowTextLengthW(hwnd) == 0) return false;
  return true;
}

std::string list_windows_json() {
  std::vector<HWND> handles;
  EnumWindows([](HWND hwnd, LPARAM data) -> BOOL {
    if (is_listable_window(hwnd)) reinterpret_cast<std::vector<HWND>*>(data)->push_back(hwnd);
    return TRUE;
  }, reinterpret_cast<LPARAM>(&handles));
  const HWND foreground = GetForegroundWindow();
  std::ostringstream json;
  json << "{\"windows\":[";
  for (size_t i = 0; i < handles.size(); ++i) {
    if (i) json << ",";
    json << window_json(handles[i], foreground);
  }
  json << "]}";
  return json.str();
}

// Monitors (EnumDisplayMonitors order == Screen.AllScreens), virtual screen,
// foreground window and, optionally, titled top-level windows: everything
// gatherDesktopContextInternal needs in one sub-millisecond round trip.
std::string desktop_context_json(bool include_windows) {
  struct Mon { RECT rect; bool primary; std::wstring device; };
  std::vector<Mon> monitors;
  EnumDisplayMonitors(nullptr, nullptr, [](HMONITOR monitor, HDC, LPRECT, LPARAM data) -> BOOL {
    MONITORINFOEXW info{};
    info.cbSize = sizeof(info);
    if (GetMonitorInfoW(monitor, &info)) {
      reinterpret_cast<std::vector<Mon>*>(data)->push_back({ info.rcMonitor, (info.dwFlags & MONITORINFOF_PRIMARY) != 0, info.szDevice });
    }
    return TRUE;
  }, reinterpret_cast<LPARAM>(&monitors));
  const ScreenRect vs = virtual_screen_rect();
  const HWND foreground = GetForegroundWindow();
  std::ostringstream json;
  json << "{\"monitors\":[";
  for (size_t i = 0; i < monitors.size(); ++i) {
    const auto& m = monitors[i];
    if (i) json << ",";
    json << "{\"index\":" << i << ",\"left\":" << m.rect.left << ",\"top\":" << m.rect.top
         << ",\"width\":" << (m.rect.right - m.rect.left) << ",\"height\":" << (m.rect.bottom - m.rect.top)
         << ",\"primary\":" << (m.primary ? "true" : "false")
         << ",\"deviceName\":\"" << json_escape(utf8(m.device)) << "\"}";
  }
  json << "],\"virtualScreen\":{\"left\":" << vs.left << ",\"top\":" << vs.top << ",\"width\":" << vs.width << ",\"height\":" << vs.height << "}";
  json << ",\"activeWindow\":" << (foreground && IsWindow(foreground) ? window_json(foreground, foreground) : std::string("null"));
  json << ",\"windows\":[";
  if (include_windows) {
    std::vector<HWND> handles;
    EnumWindows([](HWND hwnd, LPARAM data) -> BOOL {
      if (GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE; // owned popups are not main windows
      if (GetWindowTextLengthW(hwnd) <= 0) return TRUE;
      if (!IsWindowVisible(hwnd)) return TRUE;
      DWORD cloaked = 0;
      if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) && cloaked) return TRUE;
      wchar_t cls[64]{};
      GetClassNameW(hwnd, cls, 64);
      if (std::wstring(cls) == L"Progman" || std::wstring(cls) == L"WorkerW") return TRUE;
      reinterpret_cast<std::vector<HWND>*>(data)->push_back(hwnd);
      return TRUE;
    }, reinterpret_cast<LPARAM>(&handles));
    for (size_t i = 0; i < handles.size(); ++i) {
      if (i) json << ",";
      json << window_json(handles[i], foreground);
    }
  }
  json << "]}";
  return json.str();
}

// Win32 clipboard (no OLE/STA needed). Another process (clipboard history,
// password managers, monitors) may hold the clipboard open briefly, so retry
// OpenClipboard for up to ~1 s with short sleeps instead of WinForms' fixed
// 10 x 100 ms + OleFlushClipboard path.
bool open_clipboard_with_retry() {
  for (int attempt = 0; attempt < 100; ++attempt) {
    if (OpenClipboard(nullptr)) return true;
    Sleep(attempt < 10 ? 2 : 10);
  }
  return false;
}

std::string get_clipboard_text_json() {
  if (!open_clipboard_with_retry()) throw std::runtime_error("Clipboard is locked by another process.");
  std::wstring text;
  bool has_text = false;
  if (HANDLE data = GetClipboardData(CF_UNICODETEXT)) {
    if (const auto* chars = static_cast<const wchar_t*>(GlobalLock(data))) {
      text = chars;
      has_text = true;
      GlobalUnlock(data);
    }
  }
  CloseClipboard();
  return std::string("{\"hasText\":") + (has_text ? "true" : "false") + ",\"text\":\"" + json_escape(utf8(text)) + "\"}";
}

std::string set_clipboard_text_json(const std::wstring& text) {
  const size_t bytes = (text.size() + 1) * sizeof(wchar_t);
  HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
  if (!memory) throw std::runtime_error("GlobalAlloc failed for clipboard text.");
  if (void* target = GlobalLock(memory)) {
    std::memcpy(target, text.c_str(), bytes);
    GlobalUnlock(memory);
  }
  if (!open_clipboard_with_retry()) {
    GlobalFree(memory);
    throw std::runtime_error("Clipboard is locked by another process.");
  }
  EmptyClipboard();
  const bool ok = SetClipboardData(CF_UNICODETEXT, memory) != nullptr;
  CloseClipboard();
  if (!ok) {
    GlobalFree(memory);
    throw std::runtime_error("SetClipboardData failed.");
  }
  return "{\"ok\":true,\"chars\":" + std::to_string(text.size()) + "}";
}

std::string window_info_json(HWND hwnd) {
  if (!hwnd || !IsWindow(hwnd)) {
    return "{\"exists\":false,\"handle\":" + std::to_string(static_cast<long long>(reinterpret_cast<intptr_t>(hwnd))) + "}";
  }
  return window_json(hwnd, GetForegroundWindow());
}

// ─── Background input: no focus change, no real cursor movement ─────────────
// Router order: UI Automation pattern -> posted window messages -> explicit
// "background unavailable". Nothing here calls SetForegroundWindow, SetCursorPos
// or SendInput, so the user's focus, cursor and keyboard stay untouched.
ComPtr<IUIAutomation> g_uia;

IUIAutomation* uia() {
  if (!g_uia) {
    const HRESULT hr = CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&g_uia));
    if (FAILED(hr) || !g_uia) throw std::runtime_error("UI Automation is unavailable");
  }
  return g_uia.Get();
}

std::string bstr_utf8(BSTR value) {
  if (!value) return {};
  const std::wstring wide(value, SysStringLen(value));
  SysFreeString(value);
  return utf8(wide);
}

std::string window_class(HWND hwnd) {
  wchar_t buf[256]{};
  if (hwnd) GetClassNameW(hwnd, buf, 255);
  return utf8(buf);
}

bool is_web_content_class(const std::string& cls) {
  return cls.rfind("Chrome_", 0) == 0 || cls == "Intermediate D3D Window" || cls == "MozillaWindowClass"
      || cls.find("CefBrowserWindow") != std::string::npos;
}

bool rect_contains(const RECT& r, POINT p) {
  return p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom;
}

template <typename T>
ComPtr<T> uia_pattern(IUIAutomationElement* element, PATTERNID id) {
  ComPtr<T> pattern;
  if (element) element->GetCurrentPatternAs(id, __uuidof(T), reinterpret_cast<void**>(pattern.GetAddressOf()));
  return pattern;
}

// Descend from the target window's own UIA root (never the screen point), so
// an occluding window can never be hit. Several siblings can contain the point
// (UWP frames expose the real CoreWindow content plus an empty overlay Pane on
// top of it), so every containing sibling is explored, top-most first, and the
// deepest element wins. Ties keep the top-most (later) sibling.
void deepest_element_search(IUIAutomationTreeWalker* walker, IUIAutomationElement* node, POINT pt, int depth,
                            int& visited, int& best_depth, ComPtr<IUIAutomationElement>& best) {
  if (depth > best_depth) {
    best_depth = depth;
    best = node;
  }
  if (depth >= 48 || visited >= 3000) return;
  std::vector<ComPtr<IUIAutomationElement>> containing;
  ComPtr<IUIAutomationElement> child;
  if (FAILED(walker->GetFirstChildElement(node, &child))) return;
  while (child && visited < 3000) {
    ++visited;
    RECT r{};
    BOOL offscreen = FALSE;
    if (SUCCEEDED(child->get_CurrentBoundingRectangle(&r)) && rect_contains(r, pt)) {
      child->get_CurrentIsOffscreen(&offscreen);
      if (!offscreen) containing.push_back(child);
    }
    ComPtr<IUIAutomationElement> next;
    if (FAILED(walker->GetNextSiblingElement(child.Get(), &next))) break;
    child = next;
  }
  for (auto it = containing.rbegin(); it != containing.rend() && visited < 3000; ++it) {
    deepest_element_search(walker, it->Get(), pt, depth + 1, visited, best_depth, best);
  }
}

ComPtr<IUIAutomationElement> deepest_element_at(HWND root, POINT pt, int& visited) {
  ComPtr<IUIAutomationElement> current;
  check_hresult(uia()->ElementFromHandle(root, &current));
  ComPtr<IUIAutomationTreeWalker> walker;
  check_hresult(uia()->get_ControlViewWalker(&walker));
  ComPtr<IUIAutomationElement> best = current;
  int best_depth = 0;
  deepest_element_search(walker.Get(), current.Get(), pt, 0, visited, best_depth, best);
  return best;
}

std::string element_json(IUIAutomationElement* element, std::string* framework_out = nullptr) {
  if (!element) return "null";
  BSTR name = nullptr;
  BSTR automation_id = nullptr;
  BSTR framework = nullptr;
  CONTROLTYPEID control_type = 0;
  RECT r{};
  element->get_CurrentName(&name);
  element->get_CurrentAutomationId(&automation_id);
  element->get_CurrentFrameworkId(&framework);
  element->get_CurrentControlType(&control_type);
  element->get_CurrentBoundingRectangle(&r);
  const std::string fw = bstr_utf8(framework);
  if (framework_out) *framework_out = fw;
  std::ostringstream out;
  out << "{\"name\":\"" << json_escape(bstr_utf8(name)) << "\",\"automationId\":\"" << json_escape(bstr_utf8(automation_id))
      << "\",\"frameworkId\":\"" << json_escape(fw) << "\",\"controlType\":" << control_type
      << ",\"bounds\":{\"x\":" << r.left << ",\"y\":" << r.top << ",\"width\":" << (r.right - r.left) << ",\"height\":" << (r.bottom - r.top) << "}}";
  return out.str();
}

struct AsyncCall {
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT hr = E_PENDING;
  ~AsyncCall() { if (done) CloseHandle(done); }
};

// UIA Invoke on a control that opens a modal dialog can block until the dialog
// closes. Run pattern calls on a worker and report "pending" instead of hanging.
HRESULT call_uia_bounded(std::function<HRESULT()> fn, DWORD timeout_ms, bool& timed_out) {
  auto call = std::make_shared<AsyncCall>();
  std::thread([call, fn]() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    call->hr = fn();
    SetEvent(call->done);
    CoUninitialize();
  }).detach();
  timed_out = WaitForSingleObject(call->done, timeout_ms) == WAIT_TIMEOUT;
  return timed_out ? S_OK : call->hr;
}

HWND child_window_at(HWND root, POINT screen) {
  HWND current = root;
  for (int i = 0; i < 32; ++i) {
    POINT client = screen;
    ScreenToClient(current, &client);
    HWND next = ChildWindowFromPointEx(current, client, CWP_SKIPINVISIBLE | CWP_SKIPDISABLED | CWP_SKIPTRANSPARENT);
    if (!next || next == current) break;
    current = next;
  }
  return current;
}

BOOL CALLBACK collect_child_threads(HWND hwnd, LPARAM lp) {
  auto* threads = reinterpret_cast<std::vector<DWORD>*>(lp);
  const DWORD tid = GetWindowThreadProcessId(hwnd, nullptr);
  if (tid && std::find(threads->begin(), threads->end(), tid) == threads->end()) threads->push_back(tid);
  return threads->size() < 16;
}

// The keyboard-focus child inside the target, read from the owning GUI thread
// (focus is per-thread, so this works while the window is in the background).
// UWP frames host their content on another thread, so child threads are tried too.
HWND focus_hwnd_for(HWND root) {
  std::vector<DWORD> threads{GetWindowThreadProcessId(root, nullptr)};
  EnumChildWindows(root, collect_child_threads, reinterpret_cast<LPARAM>(&threads));
  for (const DWORD tid : threads) {
    GUITHREADINFO info{};
    info.cbSize = sizeof(info);
    if (!tid || !GetGUIThreadInfo(tid, &info) || !info.hwndFocus) continue;
    if (info.hwndFocus == root || IsChild(root, info.hwndFocus)) return info.hwndFocus;
  }
  return nullptr;
}

// Last keyboard-focus child seen per top-level window. When a background invoke
// makes the app activate itself and the guard hands activation back to the
// user, Windows clears that thread's focus, so later background keys fall back
// to the control that had focus before.
std::mutex g_last_focus_mutex;
std::map<HWND, HWND> g_last_focus;

void remember_focus(HWND root, HWND focus) {
  if (!root || !focus) return;
  std::lock_guard<std::mutex> lock(g_last_focus_mutex);
  if (g_last_focus.size() > 256) g_last_focus.clear();
  g_last_focus[root] = focus;
}

HWND remembered_focus(HWND root) {
  std::lock_guard<std::mutex> lock(g_last_focus_mutex);
  auto it = g_last_focus.find(root);
  if (it == g_last_focus.end()) return nullptr;
  HWND focus = it->second;
  return IsWindow(focus) && (focus == root || IsChild(root, focus)) ? focus : nullptr;
}

// ─── Agent cursor overlay: click-through, never activates, excluded from capture
std::atomic<HWND> g_overlay{nullptr};
constexpr UINT WM_PROM_OVERLAY = WM_APP + 41;
constexpr int OVERLAY_SIZE = 28;

LRESULT CALLBACK overlay_proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_PROM_OVERLAY: {
      const int x = static_cast<int>(static_cast<intptr_t>(wp));
      const int y = static_cast<int>(lp);
      SetWindowPos(hwnd, HWND_TOPMOST, x - OVERLAY_SIZE / 2, y - OVERLAY_SIZE / 2, OVERLAY_SIZE, OVERLAY_SIZE, SWP_NOACTIVATE | SWP_SHOWWINDOW);
      KillTimer(hwnd, 1);
      SetTimer(hwnd, 1, 1600, nullptr);
      InvalidateRect(hwnd, nullptr, TRUE);
      return 0;
    }
    case WM_TIMER:
      KillTimer(hwnd, 1);
      ShowWindow(hwnd, SW_HIDE);
      return 0;
    case WM_NCHITTEST:
      return HTTRANSPARENT;
    case WM_MOUSEACTIVATE:
      return MA_NOACTIVATE;
    case WM_PAINT: {
      PAINTSTRUCT ps{};
      HDC dc = BeginPaint(hwnd, &ps);
      HBRUSH ring = CreateSolidBrush(RGB(255, 122, 26));
      HBRUSH dot = CreateSolidBrush(RGB(255, 255, 255));
      RECT all{0, 0, OVERLAY_SIZE, OVERLAY_SIZE};
      FillRect(dc, &all, ring);
      HRGN inner = CreateEllipticRgn(OVERLAY_SIZE / 2 - 4, OVERLAY_SIZE / 2 - 4, OVERLAY_SIZE / 2 + 5, OVERLAY_SIZE / 2 + 5);
      FillRgn(dc, inner, dot);
      DeleteObject(inner);
      DeleteObject(ring);
      DeleteObject(dot);
      EndPaint(hwnd, &ps);
      return 0;
    }
    default:
      return DefWindowProcW(hwnd, msg, wp, lp);
  }
}

void overlay_thread() {
  WNDCLASSW wc{};
  wc.lpfnWndProc = overlay_proc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"PrometheusAgentCursor";
  RegisterClassW(&wc);
  HWND hwnd = CreateWindowExW(
    WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
    wc.lpszClassName, L"Prometheus agent cursor", WS_POPUP, 0, 0, OVERLAY_SIZE, OVERLAY_SIZE,
    nullptr, nullptr, wc.hInstance, nullptr);
  if (!hwnd) return;
  SetLayeredWindowAttributes(hwnd, 0, 215, LWA_ALPHA);
  SetWindowRgn(hwnd, CreateEllipticRgn(0, 0, OVERLAY_SIZE + 1, OVERLAY_SIZE + 1), FALSE);
  SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
  g_overlay = hwnd;
  MSG msg{};
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) DispatchMessageW(&msg);
}

void show_overlay(POINT pt) {
  static std::once_flag once;
  std::call_once(once, [] { std::thread(overlay_thread).detach(); });
  for (int i = 0; i < 60 && !g_overlay.load(); ++i) Sleep(5);
  if (HWND h = g_overlay.load()) PostMessageW(h, WM_PROM_OVERLAY, static_cast<WPARAM>(static_cast<intptr_t>(pt.x)), static_cast<LPARAM>(pt.y));
}

// Some apps (UWP Calculator, Settings) activate their own window when a
// control is invoked through UI Automation. Background actions must not keep
// the user's focus away, so a guard snapshots the foreground window and gives
// it back if the target (or its process) grabbed activation meanwhile.
struct ForegroundGuard {
  HWND before = GetForegroundWindow();
  bool restored = false;
  bool stolen() const {
    HWND now = GetForegroundWindow();
    return before && now && now != before && IsWindow(before);
  }
  // Returns a JSON fragment (",\"focusRestored\":true") when focus was given back.
  std::string restore() {
    if (!stolen()) return {};
    for (int i = 0; i < 4 && GetForegroundWindow() != before; ++i) {
      focus_window(before);
      if (GetForegroundWindow() != before) Sleep(30);
    }
    restored = GetForegroundWindow() == before;
    return restored ? std::string(",\"focusRestored\":true") : std::string(",\"focusRestored\":false");
  }
};

std::string bg_unavailable(const std::string& reason, const std::string& detail, const std::string& extra = "") {
  return std::string("{\"ok\":false,\"backgroundUnavailable\":true,\"reason\":\"") + json_escape(reason)
      + "\",\"detail\":\"" + json_escape(detail) + "\"" + extra + "}";
}

bool is_modern_app_class(const std::string& cls) {
  return cls == "ApplicationFrameWindow" || cls == "Windows.UI.Core.CoreWindow" || cls.rfind("Microsoft.UI.Content", 0) == 0;
}

HWND checked_root(long long raw) {
  HWND root = reinterpret_cast<HWND>(static_cast<intptr_t>(raw));
  if (raw <= 0 || !IsWindow(root)) throw std::runtime_error("background action requires a live window handle");
  // Restore a minimized target WITHOUT activating it: the user's focus stays put.
  if (IsIconic(root)) {
    ShowWindowAsync(root, SW_SHOWNOACTIVATE);
    Sleep(150);
  }
  return root;
}

bool control_type_is_clickable(CONTROLTYPEID type) {
  switch (type) {
    case UIA_ButtonControlTypeId: case UIA_MenuItemControlTypeId: case UIA_ListItemControlTypeId:
    case UIA_HyperlinkControlTypeId: case UIA_TabItemControlTypeId: case UIA_CheckBoxControlTypeId:
    case UIA_RadioButtonControlTypeId: case UIA_TreeItemControlTypeId: case UIA_SplitButtonControlTypeId:
    case UIA_DataItemControlTypeId:
      return true;
    default:
      return false;
  }
}

// Try a semantic UIA action on the element under the point (or a clickable
// ancestor up to two levels, e.g. a Text label inside a Button).
std::string try_uia_click(HWND root, POINT pt, int& visited, bool& handled) {
  handled = false;
  ComPtr<IUIAutomationElement> element = deepest_element_at(root, pt, visited);
  if (!element) return {};
  ComPtr<IUIAutomationTreeWalker> walker;
  check_hresult(uia()->get_ControlViewWalker(&walker));
  ComPtr<IUIAutomationElement> candidate = element;
  for (int level = 0; level < 3 && candidate; ++level) {
    CONTROLTYPEID type = 0;
    candidate->get_CurrentControlType(&type);
    if (level > 0 && !control_type_is_clickable(type)) break;
    std::string method;
    std::function<HRESULT()> fn;
    if (auto invoke = uia_pattern<IUIAutomationInvokePattern>(candidate.Get(), UIA_InvokePatternId)) {
      method = "uia_invoke"; fn = [invoke]() { return invoke->Invoke(); };
    } else if (auto toggle = uia_pattern<IUIAutomationTogglePattern>(candidate.Get(), UIA_TogglePatternId)) {
      method = "uia_toggle"; fn = [toggle]() { return toggle->Toggle(); };
    } else if (auto select = uia_pattern<IUIAutomationSelectionItemPattern>(candidate.Get(), UIA_SelectionItemPatternId)) {
      method = "uia_select"; fn = [select]() { return select->Select(); };
    } else if (auto expand = uia_pattern<IUIAutomationExpandCollapsePattern>(candidate.Get(), UIA_ExpandCollapsePatternId)) {
      method = "uia_expand_collapse";
      fn = [expand]() {
        ExpandCollapseState state = ExpandCollapseState_Collapsed;
        expand->get_CurrentExpandCollapseState(&state);
        return state == ExpandCollapseState_Expanded ? expand->Collapse() : expand->Expand();
      };
    }
    if (fn) {
      ForegroundGuard guard;
      bool timed_out = false;
      const HRESULT hr = call_uia_bounded(fn, 2500, timed_out);
      // Activation from the app's invoke handler lands asynchronously.
      for (int i = 0; i < 6 && !guard.stolen(); ++i) Sleep(25);
      const std::string focus_extra = guard.restore();
      if (FAILED(hr)) return {};
      handled = true;
      return std::string("{\"ok\":true,\"method\":\"") + method + "\",\"pending\":" + (timed_out ? "true" : "false")
          + ",\"visited\":" + std::to_string(visited) + focus_extra + ",\"element\":" + element_json(candidate.Get()) + "}";
    }
    ComPtr<IUIAutomationElement> parent;
    if (FAILED(walker->GetParentElement(candidate.Get(), &parent))) break;
    candidate = parent;
  }
  return {};
}

std::string background_click(const std::string& line) {
  HWND root = checked_root(number_field(line, "handle", 0));
  remember_focus(root, focus_hwnd_for(root));
  const POINT pt{static_cast<LONG>(number_field(line, "x", 0)), static_cast<LONG>(number_field(line, "y", 0))};
  const std::string button = string_field(line, "button");
  const int repeat = static_cast<int>(std::clamp<long long>(number_field(line, "repeat", 1), 1, 2));
  const std::string strategy = string_field(line, "strategy");  // auto | uia | message
  RECT wr{};
  GetWindowRect(root, &wr);
  if (!rect_contains(wr, pt)) return bg_unavailable("point_outside_window", "The point is outside the target window bounds.");
  if (number_field(line, "overlay", 1) != 0) show_overlay(pt);
  const bool right = button == "right";
  int visited = 0;
  if (strategy != "message" && !right && repeat == 1) {
    bool handled = false;
    const std::string result = try_uia_click(root, pt, visited, handled);
    if (handled) return result;
    if (strategy == "uia") return bg_unavailable("no_uia_pattern", "No invokable UI Automation element at the point.");
  }
  HWND target = child_window_at(root, pt);
  const std::string cls = window_class(target);
  const std::string extra = ",\"targetClass\":\"" + json_escape(cls) + "\"";
  if (is_web_content_class(cls)) {
    return bg_unavailable("web_content", "Chromium/Electron/Firefox content ignores posted mouse input. Use accessibility find_and_act, browser tools, or dispatch=\"foreground\".", extra);
  }
  if (is_modern_app_class(cls) || is_modern_app_class(window_class(root))) {
    return bg_unavailable("modern_app", "UWP/WinUI content ignores posted mouse input. Use accessibility actions or dispatch=\"foreground\".", extra);
  }
  POINT client = pt;
  ScreenToClient(target, &client);
  const LPARAM pos = MAKELPARAM(client.x, client.y);
  const UINT down = right ? WM_RBUTTONDOWN : WM_LBUTTONDOWN;
  const UINT up = right ? WM_RBUTTONUP : WM_LBUTTONUP;
  const UINT dbl = right ? WM_RBUTTONDBLCLK : WM_LBUTTONDBLCLK;
  const WPARAM key = right ? MK_RBUTTON : MK_LBUTTON;
  PostMessageW(target, WM_MOUSEMOVE, 0, pos);
  PostMessageW(target, down, key, pos);
  PostMessageW(target, up, 0, pos);
  if (repeat > 1) {
    PostMessageW(target, dbl, key, pos);
    PostMessageW(target, up, 0, pos);
  }
  return std::string("{\"ok\":true,\"method\":\"post_message\",\"pending\":false,\"visited\":") + std::to_string(visited) + extra + "}";
}

HWND keyboard_target(HWND root, std::string& cls, std::string& unavailable) {
  HWND target = focus_hwnd_for(root);
  if (target) remember_focus(root, target);
  else target = remembered_focus(root);
  if (!target) {
    unavailable = bg_unavailable("no_focus_target", "The window has no keyboard-focused control. Click or focus_element a field first.");
    return nullptr;
  }
  cls = window_class(target);
  if (is_web_content_class(cls) || is_modern_app_class(cls)) {
    unavailable = bg_unavailable(is_web_content_class(cls) ? "web_content" : "modern_app",
      "This content ignores posted keyboard input. Use accessibility set_value, browser tools, or dispatch=\"foreground\".",
      ",\"targetClass\":\"" + json_escape(cls) + "\"");
    return nullptr;
  }
  return target;
}

std::string background_type(const std::string& line) {
  HWND root = checked_root(number_field(line, "handle", 0));
  std::string cls;
  std::string unavailable;
  HWND target = keyboard_target(root, cls, unavailable);
  if (!target) return unavailable;
  const std::wstring text = utf16_from_utf8(decode_base64(string_field(line, "textBase64")));
  for (const wchar_t ch : text) {
    if (ch == L'\n') PostMessageW(target, WM_CHAR, L'\r', 1);
    else if (ch != L'\r') PostMessageW(target, WM_CHAR, ch, 1);
  }
  return std::string("{\"ok\":true,\"method\":\"post_char\",\"chars\":") + std::to_string(text.size())
      + ",\"targetClass\":\"" + json_escape(cls) + "\"}";
}

std::string background_key(const std::string& line) {
  HWND root = checked_root(number_field(line, "handle", 0));
  const std::string key = string_field(line, "key");
  const bool ctrl = number_field(line, "ctrl", 0) != 0;
  const bool shift = number_field(line, "shift", 0) != 0;
  const bool alt = number_field(line, "alt", 0) != 0;
  std::string cls;
  std::string unavailable;
  HWND target = keyboard_target(root, cls, unavailable);
  if (!target) return unavailable;
  const std::string target_extra = ",\"targetClass\":\"" + json_escape(cls) + "\"";
  if (ctrl && !shift && !alt && key.size() == 1) {
    // Posted modifiers do not change the target's key state, so map the
    // standard edit shortcuts to their exact window messages instead.
    const char k = static_cast<char>(std::tolower(static_cast<unsigned char>(key[0])));
    UINT msg = 0;
    if (k == 'c') msg = WM_COPY; else if (k == 'v') msg = WM_PASTE; else if (k == 'x') msg = WM_CUT; else if (k == 'z') msg = WM_UNDO;
    if (k == 'a') { PostMessageW(target, EM_SETSEL, 0, -1); return "{\"ok\":true,\"method\":\"edit_message\",\"message\":\"EM_SETSEL\"" + target_extra + "}"; }
    if (msg) { PostMessageW(target, msg, 0, 0); return "{\"ok\":true,\"method\":\"edit_message\"" + target_extra + "}"; }
  }
  if (ctrl || shift || alt) {
    return bg_unavailable("modifier_combo", "Apps read the real keyboard state for modifier shortcuts, so this combo cannot be sent in the background. Use dispatch=\"foreground\".", target_extra);
  }
  const WORD vk = virtual_key_for(key);
  const UINT scan = MapVirtualKeyW(vk, MAPVK_VK_TO_VSC);
  const bool extended = vk == VK_UP || vk == VK_DOWN || vk == VK_LEFT || vk == VK_RIGHT || vk == VK_HOME || vk == VK_END
      || vk == VK_PRIOR || vk == VK_NEXT || vk == VK_INSERT || vk == VK_DELETE;
  const LPARAM down = 1 | (static_cast<LPARAM>(scan) << 16) | (extended ? (1 << 24) : 0);
  const LPARAM up = down | (static_cast<LPARAM>(1) << 30) | (static_cast<LPARAM>(1) << 31);
  PostMessageW(target, WM_KEYDOWN, vk, down);
  // TranslateMessage cannot synthesize characters for posted keys reliably, so
  // emit the character for the keys that produce one.
  if (vk == VK_RETURN) PostMessageW(target, WM_CHAR, L'\r', down);
  else if (vk == VK_TAB) PostMessageW(target, WM_CHAR, L'\t', down);
  else if (vk == VK_BACK) PostMessageW(target, WM_CHAR, L'\b', down);
  else if (vk == VK_SPACE) PostMessageW(target, WM_CHAR, L' ', down);
  else if (key.size() == 1 && std::isprint(static_cast<unsigned char>(key[0]))) PostMessageW(target, WM_CHAR, static_cast<WPARAM>(key[0]), down);
  PostMessageW(target, WM_KEYUP, vk, up);
  return "{\"ok\":true,\"method\":\"post_key\"" + target_extra + "}";
}

std::string background_scroll(const std::string& line) {
  HWND root = checked_root(number_field(line, "handle", 0));
  const POINT pt{static_cast<LONG>(number_field(line, "x", 0)), static_cast<LONG>(number_field(line, "y", 0))};
  const int delta_x = static_cast<int>(number_field(line, "deltaX", 0));
  const int delta_y = static_cast<int>(number_field(line, "deltaY", 0));
  RECT wr{};
  GetWindowRect(root, &wr);
  if (!rect_contains(wr, pt)) return bg_unavailable("point_outside_window", "The scroll point is outside the target window bounds.");
  if (number_field(line, "overlay", 1) != 0) show_overlay(pt);
  int visited = 0;
  ComPtr<IUIAutomationElement> element = deepest_element_at(root, pt, visited);
  ComPtr<IUIAutomationTreeWalker> walker;
  check_hresult(uia()->get_ControlViewWalker(&walker));
  for (int level = 0; level < 14 && element; ++level) {
    if (auto scroll = uia_pattern<IUIAutomationScrollPattern>(element.Get(), UIA_ScrollPatternId)) {
      const int steps_y = std::clamp(std::abs(delta_y) / 120, delta_y ? 1 : 0, 20);
      const int steps_x = std::clamp(std::abs(delta_x) / 120, delta_x ? 1 : 0, 20);
      BOOL vertical = FALSE;
      BOOL horizontal = FALSE;
      scroll->get_CurrentVerticallyScrollable(&vertical);
      scroll->get_CurrentHorizontallyScrollable(&horizontal);
      if ((steps_y && vertical) || (steps_x && horizontal)) {
        ForegroundGuard guard;
        HRESULT hr = S_OK;
        for (int i = 0; i < steps_y && SUCCEEDED(hr); ++i) hr = scroll->Scroll(ScrollAmount_NoAmount, delta_y > 0 ? ScrollAmount_SmallDecrement : ScrollAmount_SmallIncrement);
        for (int i = 0; i < steps_x && SUCCEEDED(hr); ++i) hr = scroll->Scroll(delta_x > 0 ? ScrollAmount_SmallIncrement : ScrollAmount_SmallDecrement, ScrollAmount_NoAmount);
        const std::string focus_extra = guard.restore();
        if (SUCCEEDED(hr)) return std::string("{\"ok\":true,\"method\":\"uia_scroll\",\"visited\":") + std::to_string(visited) + focus_extra + ",\"element\":" + element_json(element.Get()) + "}";
      }
    }
    ComPtr<IUIAutomationElement> parent;
    if (FAILED(walker->GetParentElement(element.Get(), &parent))) break;
    element = parent;
  }
  HWND target = child_window_at(root, pt);
  const std::string cls = window_class(target);
  const std::string extra = ",\"targetClass\":\"" + json_escape(cls) + "\"";
  if (is_web_content_class(cls) || is_modern_app_class(cls)) {
    return bg_unavailable(is_web_content_class(cls) ? "web_content" : "modern_app", "No UIA scroll pattern and this content ignores posted wheel input.", extra);
  }
  const LPARAM pos = MAKELPARAM(pt.x, pt.y);
  if (delta_y) PostMessageW(target, WM_MOUSEWHEEL, MAKEWPARAM(0, delta_y), pos);
  if (delta_x) PostMessageW(target, WM_MOUSEHWHEEL, MAKEWPARAM(0, delta_x), pos);
  return "{\"ok\":true,\"method\":\"post_message\"" + extra + "}";
}

std::string user_input_state() {
  LASTINPUTINFO info{};
  info.cbSize = sizeof(info);
  GetLastInputInfo(&info);
  POINT cursor{};
  GetCursorPos(&cursor);
  return std::string("{\"idleMs\":") + std::to_string(GetTickCount() - info.dwTime) + ",\"cursor\":{\"x\":" + std::to_string(cursor.x)
      + ",\"y\":" + std::to_string(cursor.y) + "},\"foreground\":" + std::to_string(reinterpret_cast<intptr_t>(GetForegroundWindow())) + "}";
}

void write_result(long long id, const std::string& result_json) {
  std::cout << "{\"jsonrpc\":\"2.0\",\"id\":" << id << ",\"result\":" << result_json << "}" << std::endl;
}

void write_error(long long id, int code, const std::string& message) {
  std::cout << "{\"jsonrpc\":\"2.0\",\"id\":" << id
            << ",\"error\":{\"code\":" << code << ",\"message\":\""
            << json_escape(message) << "\"}}" << std::endl;
}

} // namespace

int wmain(int argc, wchar_t* argv[]) {
  if (argc == 5 && std::wstring(argv[1]) == L"--elevated-run") {
    return run_elevated_command(argv[2], argv[3], argv[4]);
  }
  if (argc == 7 && std::wstring(argv[1]) == L"--elevated-broker") {
    if (HWND console = GetConsoleWindow()) ShowWindow(console, SW_HIDE);
    const int port = _wtoi(argv[6]);
    if (port <= 0 || port > 65535) return 6;
    return run_elevated_broker(argv[2], argv[3], argv[4], argv[5], static_cast<unsigned short>(port));
  }
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  try {
    init_apartment(apartment_type::multi_threaded);
  } catch (const std::exception& error) {
    std::cerr << "WinRT initialization failed: " << error.what() << std::endl;
    return 2;
  }

  std::ios::sync_with_stdio(false);
  std::string line;
  while (std::getline(std::cin, line)) {
    const long long id = number_field(line, "id", 0);
    const std::string method = string_field(line, "method");
    try {
      if (method == "ping") {
        write_result(id, "{\"ok\":true,\"platform\":\"win32\",\"captureBackend\":\"Windows.Graphics.Capture\",\"screenCaptureBackend\":\"GDI BitBlt\",\"inputBackend\":\"SendInput\",\"protocolVersion\":6,\"backgroundInput\":\"uia+post_message\","
                         "\"captureKinds\":[\"window\",\"primary\",\"all\",\"monitor\",\"region\"],"
                         "\"methods\":[\"ping\",\"capture\",\"list_windows\",\"window_info\",\"foreground_window\",\"focus_window\",\"click\",\"move_pointer\",\"click_current\",\"scroll\",\"scroll_current\",\"drag\",\"type_text\",\"press_key\",\"desktop_context\",\"get_clipboard_text\",\"set_clipboard_text\",\"bg_click\",\"bg_type\",\"bg_key\",\"bg_scroll\",\"user_input_state\",\"show_cursor_overlay\"],"
                         "\"monitorOrder\":\"EnumDisplayMonitors\"}");
      } else if (method == "list_windows") {
        write_result(id, list_windows_json());
      } else if (method == "window_info") {
        const auto raw_handle = number_field(line, "handle", 0);
        write_result(id, window_info_json(reinterpret_cast<HWND>(static_cast<intptr_t>(raw_handle))));
      } else if (method == "get_clipboard_text") {
        write_result(id, get_clipboard_text_json());
      } else if (method == "set_clipboard_text") {
        write_result(id, set_clipboard_text_json(utf16_from_utf8(decode_base64(string_field(line, "textBase64")))));
      } else if (method == "desktop_context") {
        write_result(id, desktop_context_json(number_field(line, "includeWindows", 1) != 0));
      } else if (method == "foreground_window") {
        write_result(id, window_info_json(GetForegroundWindow()));
      } else if (method == "capture") {
        const std::string kind = string_field(line, "kind");
        const bool filter_none = string_field(line, "pngFilter") != "default";
        if (kind == "primary") {
          write_result(id, capture_screen_rect(primary_monitor_rect(), filter_none));
          continue;
        }
        if (kind == "all") {
          write_result(id, capture_screen_rect(virtual_screen_rect(), filter_none));
          continue;
        }
        if (kind == "monitor") {
          const auto monitors = enum_monitors();
          const auto index = number_field(line, "index", -1);
          if (index < 0 || index >= static_cast<long long>(monitors.size())) {
            write_error(id, -32602, "capture(monitor) index " + std::to_string(index) + " out of range; monitorCount="
              + std::to_string(monitors.size()) + " (EnumDisplayMonitors order, 0-based)");
            continue;
          }
          write_result(id, capture_screen_rect(monitors[static_cast<size_t>(index)], filter_none));
          continue;
        }
        if (kind == "region") {
          const ScreenRect region{
            static_cast<int>(number_field(line, "left", 0)),
            static_cast<int>(number_field(line, "top", 0)),
            static_cast<int>(number_field(line, "width", 0)),
            static_cast<int>(number_field(line, "height", 0)),
          };
          if (region.width <= 0 || region.height <= 0) {
            write_error(id, -32602, "capture(region) requires positive width and height.");
            continue;
          }
          write_result(id, capture_screen_rect(region, filter_none));
          continue;
        }
        if (kind != "window") {
          write_error(id, -32602, "Unsupported capture kind: " + kind + " (supported: window, primary, all, monitor, region)");
          continue;
        }
        const auto raw_handle = number_field(line, "handle", 0);
        if (raw_handle <= 0) {
          write_error(id, -32602, "capture(window) requires a positive handle.");
          continue;
        }
        write_result(id, capture_window(reinterpret_cast<HWND>(static_cast<intptr_t>(raw_handle))));
      } else if (method == "focus_window") {
        const auto raw_handle = number_field(line, "handle", 0);
        if (raw_handle <= 0) throw std::runtime_error("focus_window requires handle");
        write_result(id, focus_window(reinterpret_cast<HWND>(static_cast<intptr_t>(raw_handle))) ? "{\"focused\":true}" : "{\"focused\":false}");
      } else if (method == "click") {
        click_pointer(
          static_cast<int>(number_field(line, "x", 0)),
          static_cast<int>(number_field(line, "y", 0)),
          string_field(line, "button"),
          static_cast<int>(number_field(line, "repeat", 1)));
        write_result(id, "{\"ok\":true}");
      } else if (method == "move_pointer") {
        if (!SetCursorPos(static_cast<int>(number_field(line, "x", 0)), static_cast<int>(number_field(line, "y", 0)))) {
          throw std::runtime_error("SetCursorPos failed");
        }
        write_result(id, "{\"ok\":true}");
      } else if (method == "click_current") {
        POINT point{};
        if (!GetCursorPos(&point)) throw std::runtime_error("GetCursorPos failed");
        click_pointer(point.x, point.y, string_field(line, "button"), static_cast<int>(number_field(line, "repeat", 1)));
        write_result(id, "{\"ok\":true}");
      } else if (method == "scroll") {
        scroll_pointer(
          static_cast<int>(number_field(line, "x", 0)),
          static_cast<int>(number_field(line, "y", 0)),
          static_cast<int>(number_field(line, "deltaX", 0)),
          static_cast<int>(number_field(line, "deltaY", 0)));
        write_result(id, "{\"ok\":true}");
      } else if (method == "scroll_current") {
        POINT point{};
        if (!GetCursorPos(&point)) throw std::runtime_error("GetCursorPos failed");
        scroll_pointer(point.x, point.y, static_cast<int>(number_field(line, "deltaX", 0)), static_cast<int>(number_field(line, "deltaY", 0)));
        write_result(id, "{\"ok\":true}");
      } else if (method == "drag") {
        drag_pointer(
          static_cast<int>(number_field(line, "fromX", 0)),
          static_cast<int>(number_field(line, "fromY", 0)),
          static_cast<int>(number_field(line, "toX", 0)),
          static_cast<int>(number_field(line, "toY", 0)),
          static_cast<int>(number_field(line, "steps", 20)));
        write_result(id, "{\"ok\":true}");
      } else if (method == "type_text") {
        type_unicode(utf16_from_utf8(decode_base64(string_field(line, "textBase64"))));
        write_result(id, "{\"ok\":true}");
      } else if (method == "bg_click") {
        write_result(id, background_click(line));
      } else if (method == "bg_type") {
        write_result(id, background_type(line));
      } else if (method == "bg_key") {
        write_result(id, background_key(line));
      } else if (method == "bg_scroll") {
        write_result(id, background_scroll(line));
      } else if (method == "user_input_state") {
        write_result(id, user_input_state());
      } else if (method == "show_cursor_overlay") {
        show_overlay(POINT{static_cast<LONG>(number_field(line, "x", 0)), static_cast<LONG>(number_field(line, "y", 0))});
        write_result(id, "{\"ok\":true}");
      } else if (method == "press_key") {
        press_key(
          string_field(line, "key"),
          number_field(line, "ctrl", 0) != 0,
          number_field(line, "shift", 0) != 0,
          number_field(line, "alt", 0) != 0);
        write_result(id, "{\"ok\":true}");
      } else {
        write_error(id, -32601, "Unknown helper method: " + method);
      }
    } catch (const winrt::hresult_error& error) {
      write_error(id, 3, utf8(std::wstring(error.message().c_str())));
    } catch (const std::exception& error) {
      write_error(id, 3, error.what());
    }
  }
  return 0;
}
