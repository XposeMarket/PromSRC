#include <winsock2.h>
#include <ws2ipdef.h>
#include <windows.h>
#include <sddl.h>
#include <iphlpapi.h>
#include <d3d11.h>
#include <bcrypt.h>
#include <wincodec.h>
#include <wrl/client.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>

#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <mutex>
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
        write_result(id, "{\"ok\":true,\"platform\":\"win32\",\"captureBackend\":\"Windows.Graphics.Capture\",\"inputBackend\":\"SendInput\",\"protocolVersion\":2}");
      } else if (method == "capture") {
        const std::string kind = string_field(line, "kind");
        if (kind != "window") {
          write_error(id, 1, "The Windows helper currently supports capture(kind=window) only.");
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
