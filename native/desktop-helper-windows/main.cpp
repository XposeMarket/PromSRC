#include <windows.h>
#include <d3d11.h>
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
#include <iostream>
#include <mutex>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>

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

int main() {
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
