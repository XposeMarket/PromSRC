#include <psp2/kernel/processmgr.h>
#include <psp2/kernel/threadmgr.h>
#include <psp2/sysmodule.h>
#include <psp2/net/net.h>
#include <psp2/net/netctl.h>
#include <psp2/ctrl.h>
#include <psp2/touch.h>
#include <psp2/rtc.h>
#include <psp2/apputil.h>
#include <psp2/ime_dialog.h>
#include <psp2/common_dialog.h>
#include <psp2/io/fcntl.h>
#include <psp2/io/dirent.h>
#include <psp2/io/stat.h>
#include <curl/curl.h>
#include <vita2d.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static constexpr const char* SETTINGS = "ux0:data/prometheus-vita/settings.txt";
static constexpr const char* UPDATE_FILE = "ux0:data/prometheus-vita/prometheus_vita_update.vpk";
static constexpr const char* APP_VERSION = "00.24";
static constexpr size_t MAX_REPLY = 1024 * 1024;
static constexpr int SCREEN_W = 960;
static constexpr int SCREEN_H = 544;
static constexpr int CHAT_TOP = 118;
static constexpr int CHAT_BOTTOM = 455;
static constexpr int LINE_H = 22;
static constexpr int WRAP_CHARS = 88;
static constexpr int VISIBLE_LINES = (CHAT_BOTTOM - CHAT_TOP) / LINE_H;

struct Config {
  std::string base = "http://10.0.0.125:8780";
  std::string token;
  std::string provider;
  std::string model;
  std::string reasoning;
};

struct Message {
  std::string who;
  std::string text;
  std::string time;
};

struct Channel {
  std::string name;
  std::string session;
  std::vector<Message> messages;
  int scroll = 0;
  int generation = 0;
};

struct RenderLine {
  std::string text;
  unsigned int color;
  bool label;
};

static vita2d_pgf* font = nullptr;
static char netMemory[1024 * 1024] __attribute__((aligned(4096)));
static std::vector<Channel> sessions;
static std::vector<Channel> agents;
static Channel chat = {"NEW CHAT", "", {}, 0, 0};
static int activePage = 0; // 0 chat, 1 sessions, 2 subagents
static int activeSession = 0;
static int activeAgent = 0;
static bool subagentChatOpen = false;
static std::string httpError;
static std::string liveStatus;
static Config* liveConfig = nullptr;
static Channel* liveChannel = nullptr;
static std::string sseCarry;

static std::string nowTime() {
  SceDateTime dt{};
  sceRtcGetCurrentClockLocalTime(&dt);
  char out[16];
  snprintf(out, sizeof(out), "%02u:%02u", (unsigned)(dt.hour % 24), (unsigned)(dt.minute % 60));
  return out;
}

static void draw(const Config& config, const std::string& status);

static std::string esc(const std::string& s) {
  std::string out;
  for (char c : s) {
    if (c == '"' || c == '\\') {
      out += '\\';
      out += c;
    } else if (c == '\n') {
      out += "\\n";
    } else if ((unsigned char)c >= 32) {
      out += c;
    }
  }
  return out;
}

static bool saveConfig(const Config& c) {
  sceIoMkdir("ux0:data/prometheus-vita", 0777);
  FILE* f = fopen(SETTINGS, "wb");
  if (!f) return false;
  fprintf(f, "%s\n%s\n%s\n%s\n%s\n", c.base.c_str(), c.token.c_str(), c.provider.c_str(), c.model.c_str(), c.reasoning.c_str());
  fclose(f);
  return true;
}

static Config loadConfig() {
  Config c;
  FILE* f = fopen(SETTINGS, "rb");
  if (!f) return c;
  char base[256] = {};
  char token[512] = {};
  char provider[96] = {};
  char model[192] = {};
  char reasoning[32] = {};
  fgets(base, sizeof(base), f);
  fgets(token, sizeof(token), f);
  fgets(provider, sizeof(provider), f);
  fgets(model, sizeof(model), f);
  fgets(reasoning, sizeof(reasoning), f);
  fclose(f);
  base[strcspn(base, "\r\n")] = 0;
  token[strcspn(token, "\r\n")] = 0;
  provider[strcspn(provider, "\r\n")] = 0;
  model[strcspn(model, "\r\n")] = 0;
  reasoning[strcspn(reasoning, "\r\n")] = 0;
  if (*base) c.base = base;
  if (c.base.find(":8884") != std::string::npos) c.base.replace(c.base.find(":8884"), 5, ":8780");
  if (c.base.find(":8789") != std::string::npos) c.base.replace(c.base.find(":8789"), 5, ":8780");
  c.token = token;
  c.provider = provider;
  c.model = model;
  c.reasoning = reasoning;
  return c;
}

static size_t onData(char* ptr, size_t size, size_t count, void* user) {
  auto* out = static_cast<std::string*>(user);
  const size_t bytes = size * count;
  if (out->size() + bytes > MAX_REPLY) return 0;
  out->append(ptr, bytes);
  return bytes;
}

static size_t onFile(char* ptr, size_t size, size_t count, void* user) {
  return fwrite(ptr, size, count, static_cast<FILE*>(user));
}

static std::string bridgeBase(const Config& config) {
  return config.base;
}

static bool downloadUpdate(const Config& config, std::string& detail) {
  sceIoMkdir("ux0:data/prometheus-vita", 0777);
  FILE* file = fopen(UPDATE_FILE, "wb");
  if (!file) { detail = "Cannot create the update file."; return false; }
  CURL* curl = curl_easy_init();
  if (!curl) { fclose(file); sceIoRemove(UPDATE_FILE); detail = "HTTP is unavailable."; return false; }
  struct curl_slist* headers = nullptr;
  std::string auth = "X-Vita-Bridge-Token: " + config.token;
  if (!config.token.empty()) headers = curl_slist_append(headers, auth.c_str());
  const std::string url = bridgeBase(config) + "/update/prometheus_vita.vpk";
  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, onFile);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, file);
  curl_easy_setopt(curl, CURLOPT_TIMEOUT, 180L);
  curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 8L);
  const CURLcode result = curl_easy_perform(curl);
  long code = 0;
  curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);
  curl_slist_free_all(headers);
  curl_easy_cleanup(curl);
  const long bytes = ftell(file);
  fclose(file);
  if (result != CURLE_OK || code < 200 || code >= 300 || bytes < 1024) {
    sceIoRemove(UPDATE_FILE);
    detail = "Update server unavailable.";
    return false;
  }
  detail = "Update downloaded. Install it in VitaShell, then relaunch. No reboot needed.";
  return true;
}

static std::string jsonField(const std::string& json, const char* key) {
  const std::string marker = std::string("\"") + key + "\"";
  auto pos = json.find(marker);
  if (pos == std::string::npos) return {};
  pos = json.find(':', pos + marker.size());
  if (pos == std::string::npos) return {};
  pos = json.find('"', pos);
  if (pos == std::string::npos) return {};
  std::string out;
  for (++pos; pos < json.size(); ++pos) {
    char c = json[pos];
    if (c == '"') break;
    if (c == '\\' && pos + 1 < json.size()) {
      char escaped = json[++pos];
      out += escaped == 'n' ? '\n' : escaped;
    } else {
      out += c;
    }
  }
  return out;
}

static void processSseRow(const std::string& row) {
  const std::string type = jsonField(row, "type");
  if (type == "tool_call") {
    std::string tool = jsonField(row, "action");
    if (tool.empty()) tool = jsonField(row, "tool");
    if (tool.empty()) tool = "tool";
    liveStatus = "Working - " + tool;
  } else if (type == "info") {
    const std::string message = jsonField(row, "message");
    if (!message.empty()) liveStatus = message.substr(0, 72);
  } else if (type == "token") {
    liveStatus = "Prometheus is responding...";
  }
  if (liveConfig && liveChannel) {
    draw(*liveConfig, liveStatus);
  }
}

static size_t onStreamData(char* ptr, size_t size, size_t count, void* user) {
  auto* out = static_cast<std::string*>(user);
  const size_t bytes = size * count;
  if (out->size() + bytes > MAX_REPLY) return 0;
  out->append(ptr, bytes);
  sseCarry.append(ptr, bytes);
  size_t end = 0;
  while ((end = sseCarry.find('\n')) != std::string::npos) {
    std::string row = sseCarry.substr(0, end);
    sseCarry.erase(0, end + 1);
    if (row.rfind("data:", 0) == 0) processSseRow(row.substr(5));
  }
  return bytes;
}

static std::string parseSse(const std::string& body) {
  std::string final;
  std::string tokens;
  size_t pos = 0;
  while ((pos = body.find("data:", pos)) != std::string::npos) {
    auto end = body.find('\n', pos);
    auto row = body.substr(pos + 5, end == std::string::npos ? std::string::npos : end - pos - 5);
    auto type = jsonField(row, "type");
    if (type == "token") tokens += jsonField(row, "text");
    else if (type == "final") final = jsonField(row, "text");
    else if (type == "done" && final.empty()) final = jsonField(row, "reply");
    pos = end == std::string::npos ? body.size() : end + 1;
  }
  return final.empty() ? tokens : final;
}

static bool request(const Config& c, const std::string& method, const std::string& route, const std::string& body, std::string& response) {
  httpError.clear();
  CURL* handle = curl_easy_init();
  if (!handle) { httpError = "HTTP unavailable"; return false; }
  struct curl_slist* headers = nullptr;
  headers = curl_slist_append(headers, "Content-Type: application/json");
  headers = curl_slist_append(headers, "Accept: application/json, text/event-stream");
  const std::string auth = "X-Vita-Bridge-Token: " + c.token;
  if (!c.token.empty()) headers = curl_slist_append(headers, auth.c_str());
  const std::string url = c.base + route;
  curl_easy_setopt(handle, CURLOPT_URL, url.c_str());
  curl_easy_setopt(handle, CURLOPT_HTTPHEADER, headers);
  if (method == "POST") {
    curl_easy_setopt(handle, CURLOPT_POST, 1L);
    curl_easy_setopt(handle, CURLOPT_POSTFIELDS, body.c_str());
  }
  curl_easy_setopt(handle, CURLOPT_WRITEFUNCTION, liveChannel ? onStreamData : onData);
  curl_easy_setopt(handle, CURLOPT_WRITEDATA, &response);
  curl_easy_setopt(handle, CURLOPT_TIMEOUT, 300L);
  curl_easy_setopt(handle, CURLOPT_CONNECTTIMEOUT, 8L);
  const auto result = curl_easy_perform(handle);
  long code = 0;
  curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, &code);
  if (result != CURLE_OK) httpError = curl_easy_strerror(result);
  else if (code < 200 || code >= 300) httpError = "HTTP " + std::to_string(code);
  curl_slist_free_all(headers);
  curl_easy_cleanup(handle);
  return result == CURLE_OK && code >= 200 && code < 300;
}

static bool post(const Config& c, const std::string& route, const std::string& body, std::string& response) {
  return request(c, "POST", route, body, response);
}

static bool get(const Config& c, const std::string& route, std::string& response) {
  return request(c, "GET", route, "", response);
}

static std::string prompt(const char* title, const std::string& initial) {
  SceImeDialogParam params;
  sceImeDialogParamInit(&params);
  static uint16_t title16[64], text16[2048], initial16[2048];
  memset(title16, 0, sizeof(title16));
  memset(text16, 0, sizeof(text16));
  memset(initial16, 0, sizeof(initial16));
  for (size_t i = 0; i < strlen(title) && i < 63; ++i) title16[i] = (uint8_t)title[i];
  for (size_t i = 0; i < initial.size() && i < 2047; ++i) initial16[i] = (uint8_t)initial[i];
  params.supportedLanguages = SCE_IME_LANGUAGE_ENGLISH_GB;
  params.languagesForced = SCE_TRUE;
  params.type = SCE_IME_TYPE_DEFAULT;
  params.option = 0;
  params.textBoxMode = SCE_IME_DIALOG_TEXTBOX_MODE_WITH_CLEAR;
  params.maxTextLength = 2047;
  params.title = title16;
  params.initialText = initial16;
  params.inputTextBuffer = text16;
  if (sceImeDialogInit(&params) < 0) return {};
  while (sceImeDialogGetStatus() == SCE_COMMON_DIALOG_STATUS_RUNNING) {
    vita2d_start_drawing();
    vita2d_clear_screen();
    vita2d_end_drawing();
    vita2d_common_dialog_update();
    vita2d_swap_buffers();
    sceKernelDelayThread(16000);
  }
  SceImeDialogResult result{};
  sceImeDialogGetResult(&result);
  sceImeDialogTerm();
  if (result.button != SCE_IME_DIALOG_BUTTON_ENTER) return {};
  std::string out;
  for (int i = 0; text16[i]; ++i) out += (char)(text16[i] & 0xff);
  return out;
}

static void init() {
  SceNetInitParam netParams{netMemory, sizeof(netMemory), 0};
  sceSysmoduleLoadModule(SCE_SYSMODULE_NET);
  sceSysmoduleLoadModule(SCE_SYSMODULE_HTTP);
  sceSysmoduleLoadModule(SCE_SYSMODULE_SSL);
  sceNetInit(&netParams);
  sceNetCtlInit();
  sceAppUtilInit(nullptr, nullptr);
  curl_global_init(CURL_GLOBAL_DEFAULT);
  sceCtrlSetSamplingMode(SCE_CTRL_MODE_ANALOG);
  sceTouchSetSamplingState(SCE_TOUCH_PORT_FRONT, SCE_TOUCH_SAMPLING_STATE_START);
  vita2d_init();
  vita2d_set_clear_color(0xFF0A0807);
  font = vita2d_load_default_pgf();
}

static void shutdown() {
  if (font) vita2d_free_pgf(font);
  vita2d_fini();
  curl_global_cleanup();
  sceAppUtilShutdown();
  sceNetCtlTerm();
  sceNetTerm();
}

static void text(int x, int y, unsigned int color, float scale, const std::string& value) {
  if (font) vita2d_pgf_draw_text(font, x, y, color, scale, value.c_str());
}

static std::vector<std::string> wrapText(const std::string& input, size_t width = WRAP_CHARS) {
  std::vector<std::string> lines;
  size_t paragraphStart = 0;
  while (paragraphStart <= input.size()) {
    size_t paragraphEnd = input.find('\n', paragraphStart);
    std::string paragraph = input.substr(paragraphStart, paragraphEnd == std::string::npos ? std::string::npos : paragraphEnd - paragraphStart);
    if (paragraph.empty()) lines.push_back("");
    while (!paragraph.empty()) {
      if (paragraph.size() <= width) {
        lines.push_back(paragraph);
        break;
      }
      size_t cut = paragraph.rfind(' ', width);
      if (cut == std::string::npos || cut < width / 2) cut = width;
      lines.push_back(paragraph.substr(0, cut));
      paragraph.erase(0, cut);
      while (!paragraph.empty() && paragraph.front() == ' ') paragraph.erase(paragraph.begin());
    }
    if (paragraphEnd == std::string::npos) break;
    paragraphStart = paragraphEnd + 1;
  }
  return lines;
}

static std::vector<std::string> jsonStringsForKey(const std::string& json, const char* key) {
  std::vector<std::string> out;
  const std::string marker = std::string("\"") + key + "\"";
  size_t pos = 0;
  while ((pos = json.find(marker, pos)) != std::string::npos) {
    const size_t colon = json.find(':', pos + marker.size());
    const size_t quote = colon == std::string::npos ? std::string::npos : json.find('"', colon + 1);
    if (quote == std::string::npos) break;
    std::string value;
    for (size_t i = quote + 1; i < json.size(); ++i) {
      const char c = json[i];
      if (c == '"') { pos = i + 1; break; }
      if (c == '\\' && i + 1 < json.size()) {
        const char escaped = json[++i];
        value += escaped == 'n' ? '\n' : escaped;
      } else value += c;
    }
    out.push_back(value);
  }
  return out;
}

static void syncModelSettings(Config& config) {
  std::string response;
  if (!get(config, "/prometheus/settings/provider", response)) return;
  if (config.provider.empty()) config.provider = jsonField(response, "provider");
  if (config.provider.empty()) return;
  const size_t providerPos = response.find("\"" + config.provider + "\"");
  if (providerPos == std::string::npos) return;
  const std::string providerJson = response.substr(providerPos);
  if (config.model.empty()) config.model = jsonField(providerJson, "model");
  if (config.reasoning.empty()) config.reasoning = jsonField(providerJson, "reasoning_effort");
}

static bool applyModelSettings(const Config& config, std::string& detail) {
  if (config.provider.empty() || config.model.empty()) {
    detail = "Provider and model are required.";
    return false;
  }
  const std::string reasoningPart = config.reasoning.empty() ? "" : ",\"reasoning_effort\":\"" + esc(config.reasoning) + "\"";
  const std::string body = "{\"llm\":{\"provider\":\"" + esc(config.provider) + "\",\"providers\":{\"" + esc(config.provider) + "\":{\"model\":\"" + esc(config.model) + "\"" + reasoningPart + "}}}}";
  std::string response;
  if (!post(config, "/prometheus/settings/provider", body, response)) { detail = httpError; return false; }
  detail = config.provider + " / " + config.model + (config.reasoning.empty() ? "" : " / " + config.reasoning);
  return true;
}


static Channel& currentChannel() {
  if (activePage == 0) return chat;
  if (activePage == 1) return sessions[activeSession];
  return agents[activeAgent];
}

static std::vector<RenderLine> buildRenderLines(const Channel& channel) {
  std::vector<RenderLine> out;
  if (channel.messages.empty()) {
    if (activePage == 1) {
      out.push_back({"Choose a previous session with UP / DOWN.", 0xFFF4EDE6, false});
      out.push_back({"Press X to open it in CHAT.", 0xFFB5A99F, false});
    } else if (activePage == 2 && !subagentChatOpen) {
      out.push_back({"Choose a subagent with UP / DOWN.", 0xFFF4EDE6, false});
      out.push_back({"Press X to open its direct chat.", 0xFFB5A99F, false});
    } else {
      out.push_back({activePage == 0 ? "Start a conversation with Prometheus." : "This subagent chat is ready.", 0xFFF4EDE6, false});
      out.push_back({"Press X to send a message.", 0xFFB5A99F, false});
    }
    return out;
  }
  for (const auto& message : channel.messages) {
    const bool assistant = message.who != "You" && message.who != "System";
    const unsigned int labelColor = assistant ? 0xFF5AC8FF : message.who == "You" ? 0xFFFFB15A : 0xFF8D9AA6;
    std::string label = message.who;
    if (!message.time.empty()) label += "                                           " + message.time;
    out.push_back({label, labelColor, true});
    for (const auto& line : wrapText(message.text)) out.push_back({line, 0xFFF4EDE6, false});
    out.push_back({"", 0xFFFFFFFF, false});
  }
  return out;
}

static void clampScroll(Channel& channel) {
  const int total = (int)buildRenderLines(channel).size();
  channel.scroll = std::max(0, std::min(channel.scroll, std::max(0, total - VISIBLE_LINES)));
}

static void jumpToBottom(Channel& channel) {
  channel.scroll = std::max(0, (int)buildRenderLines(channel).size() - VISIBLE_LINES);
}

static void drawTabs() {
  const char* names[] = {"CHAT", "SESSIONS", "SUBAGENTS"};
  const int tabW = 190;
  int x = (SCREEN_W - (tabW * 3 + 20)) / 2;
  for (int i = 0; i < 3; ++i) {
    const bool active = i == activePage;
    vita2d_draw_rectangle(x, 72, tabW, 34, active ? 0xFF2A78FF : 0xFF211B18);
    if (active) vita2d_draw_rectangle(x, 103, tabW, 3, 0xFFFFA43A);
    text(x + 24, 95, active ? 0xFFFFFFFF : 0xFF9B918A, 0.68f, names[i]);
    x += tabW + 10;
  }
}

static void draw(const Config& config, const std::string& status) {
  Channel& channel = currentChannel();
  clampScroll(channel);
  const auto lines = buildRenderLines(channel);
  vita2d_start_drawing();
  vita2d_clear_screen();
  vita2d_draw_rectangle(0, 0, SCREEN_W, 64, 0xFF17100D);
  vita2d_draw_rectangle(0, 64, SCREEN_W, 3, 0xFFFF7A24);
  text(28, 39, 0xFFFFFFFF, 1.15f, "PROMETHEUS");
  text(207, 39, 0xFFFF9B42, 0.66f, "VITA LINK");
  text(310, 39, 0xFF8D827B, 0.56f, std::string("v") + APP_VERSION);
  const char* heading = activePage == 0 ? "ACTIVE CHAT" : activePage == 1 ? "SESSION LIBRARY" : "SUBAGENTS";
  text(650, 28, 0xFF8D827B, 0.56f, heading);
  text(650, 48, 0xFFD8CFC8, 0.60f, channel.name);
  drawTabs();
  vita2d_draw_rectangle(22, 111, 916, 350, 0xFF100D0B);
  vita2d_draw_rectangle(22, 111, 4, 350, 0xFFFF7A24);
  int y = CHAT_TOP + 17;
  const int end = std::min((int)lines.size(), channel.scroll + VISIBLE_LINES);
  for (int i = channel.scroll; i < end; ++i) {
    text(lines[i].label ? 42 : 56, y, lines[i].color, lines[i].label ? 0.62f : 0.64f, lines[i].text);
    y += LINE_H;
  }
  if ((int)lines.size() > VISIBLE_LINES) {
    const float trackH = 330.0f;
    const float thumbH = std::max(28.0f, trackH * VISIBLE_LINES / (float)lines.size());
    const int maxScroll = std::max(1, (int)lines.size() - VISIBLE_LINES);
    const float thumbY = 121.0f + (trackH - thumbH) * channel.scroll / maxScroll;
    vita2d_draw_rectangle(925, 121, 3, 330, 0xFF302824);
    vita2d_draw_rectangle(924, (int)thumbY, 5, (int)thumbH, 0xFFFF8A32);
  }
  vita2d_draw_rectangle(0, 472, SCREEN_W, 72, 0xFF19120F);
  const bool offline = status.find("Offline") != std::string::npos || status.find("failed") != std::string::npos;
  const unsigned int statusColor = offline ? 0xFF7272FF : 0xFF7FE0A8;
  vita2d_draw_rectangle(22, 486, 9, 9, statusColor);
  text(40, 497, statusColor, 0.62f, status);
  text(22, 525, 0xFFD8CFC8, 0.54f, "X OPEN/TALK   SQUARE NEW CHAT   CIRCLE UPDATE   L/R PAGE   TOUCH/UP/DOWN SCROLL");
  text(750, 497, 0xFF93877F, 0.55f, "TRIANGLE SETUP");
  vita2d_end_drawing();
  vita2d_swap_buffers();
}

static void loadSubagents(const Config& config) {
  std::string response;
  if (!get(config, "/prometheus/agents", response)) return;
  const auto ids = jsonStringsForKey(response, "id");
  const auto names = jsonStringsForKey(response, "name");
  agents.clear();
  for (size_t i = 0; i < ids.size(); ++i) {
    if (ids[i] == "main") continue;
    const std::string name = i < names.size() && !names[i].empty() ? names[i] : ids[i];
    agents.push_back({name, ids[i], {}, 0, 0});
  }
  if (agents.empty()) agents.push_back({"NO SUBAGENTS", "", {{"System", "No standalone subagents are configured yet.", nowTime()}}, 0, 0});
  activeAgent = std::min(activeAgent, (int)agents.size() - 1);
}

static void loadSubagentHistory(const Config& config, Channel& agent) {
  if (agent.session.empty()) return;
  std::string response;
  if (!get(config, "/prometheus/agents/" + agent.session + "/chat?limit=100", response)) return;
  const auto roles = jsonStringsForKey(response, "role");
  const auto contents = jsonStringsForKey(response, "content");
  agent.messages.clear();
  for (size_t i = 0; i < roles.size() && i < contents.size(); ++i)
    agent.messages.push_back({roles[i] == "user" ? "You" : agent.name, contents[i], ""});
  jumpToBottom(agent);
}

static void loadSessions(const Config& config) {
  std::string response;
  if (!get(config, "/prometheus/sessions?channel=mobile&limit=50", response)) return;
  const auto ids = jsonStringsForKey(response, "id");
  const auto titles = jsonStringsForKey(response, "title");
  sessions.clear();
  for (size_t i = 0; i < ids.size(); ++i) {
    const std::string name = i < titles.size() && !titles[i].empty() ? titles[i] : "CHAT " + std::to_string(i + 1);
    sessions.push_back({name, ids[i], {}, 0, 0});
  }
  if (sessions.empty()) sessions.push_back({"NO SAVED SESSIONS", "", {}, 0, 0});
  activeSession = std::min(activeSession, (int)sessions.size() - 1);
}

static void loadSessionHistory(const Config& config, Channel& session) {
  if (session.session.empty()) return;
  std::string response;
  if (!get(config, "/prometheus/sessions/" + session.session, response)) return;
  const auto roles = jsonStringsForKey(response, "role");
  const auto contents = jsonStringsForKey(response, "content");
  session.messages.clear();
  for (size_t i = 0; i < roles.size() && i < contents.size(); ++i) {
    if (roles[i] == "user" || roles[i] == "assistant")
      session.messages.push_back({roles[i] == "user" ? "You" : "Prometheus", contents[i], ""});
  }
  jumpToBottom(session);
}

static void newChat() {
  SceDateTime dt{};
  sceRtcGetCurrentClockLocalTime(&dt);
  char sessionId[96];
  snprintf(sessionId, sizeof(sessionId), "mobile_vita_%04u%02u%02u_%02u%02u%02u_%lld",
           (unsigned)dt.year, (unsigned)dt.month, (unsigned)dt.day,
           (unsigned)dt.hour, (unsigned)dt.minute, (unsigned)dt.second,
           (long long)sceKernelGetProcessTimeWide());
  chat = {"NEW CHAT", sessionId, {}, 0, 0};
  activePage = 0;
}

int main() {
  init();
  Config config = loadConfig();
  std::string status = "Ready - bridge 10.0.0.125:8780";
  syncModelSettings(config); saveConfig(config);
  newChat(); loadSessions(config); loadSubagents(config);
  SceCtrlData old{}; SceTouchData oldTouch{};
  while (true) {
    draw(config, status);
    SceCtrlData pad{}; sceCtrlPeekBufferPositive(0, &pad, 1);
    const uint32_t pressed = pad.buttons & ~old.buttons; old = pad;
    if (pressed & SCE_CTRL_START) break;
    if (pressed & SCE_CTRL_LTRIGGER) {
      activePage = (activePage + 2) % 3; subagentChatOpen = false;
      if (activePage == 1) loadSessions(config);
    }
    if (pressed & SCE_CTRL_RTRIGGER) {
      activePage = (activePage + 1) % 3; subagentChatOpen = false;
      if (activePage == 1) loadSessions(config);
    }

    SceTouchData touch{}; sceTouchPeek(SCE_TOUCH_PORT_FRONT, &touch, 1);
    if (touch.reportNum > 0 && oldTouch.reportNum > 0) {
      const int dy = touch.report[0].y - oldTouch.report[0].y;
      if (dy > 18 || dy < -18) { Channel& target = currentChannel(); target.scroll += dy > 0 ? -2 : 2; clampScroll(target); }
    }
    oldTouch = touch;

    Channel& channel = currentChannel();
    if (pressed & SCE_CTRL_UP) {
      if (activePage == 1 && sessions.size() > 1) activeSession = (activeSession + sessions.size() - 1) % sessions.size();
      else if (activePage == 2 && !subagentChatOpen && agents.size() > 1) activeAgent = (activeAgent + agents.size() - 1) % agents.size();
      else { channel.scroll -= 3; clampScroll(channel); }
    }
    if (pressed & SCE_CTRL_DOWN) {
      if (activePage == 1 && sessions.size() > 1) activeSession = (activeSession + 1) % sessions.size();
      else if (activePage == 2 && !subagentChatOpen && agents.size() > 1) activeAgent = (activeAgent + 1) % agents.size();
      else { channel.scroll += 3; clampScroll(channel); }
    }
    if (pressed & SCE_CTRL_SQUARE) {
      if (activePage == 2) { loadSubagents(config); status = "Subagents refreshed"; }
      else { newChat(); status = "New chat"; }
    }
    if (pressed & SCE_CTRL_CIRCLE) {
      status = "Downloading update over Wi-Fi..."; draw(config, status);
      std::string detail; const bool ok = downloadUpdate(config, detail);
      currentChannel().messages.push_back({"System", detail, nowTime()}); jumpToBottom(currentChannel());
      status = ok ? "Update ready - no reboot" : "Update failed";
    }
    if (pressed & SCE_CTRL_TRIANGLE) {
      auto provider = prompt("Provider (openai_codex, xai, anthropic)", config.provider); if (!provider.empty()) config.provider = provider;
      auto model = prompt("Model", config.model); if (!model.empty()) config.model = model;
      auto reasoning = prompt("Reasoning (none/low/medium/high/xhigh/max)", config.reasoning); config.reasoning = reasoning;
      auto base = prompt("PC bridge address", config.base); if (!base.empty()) config.base = base;
      auto token = prompt("Bridge token (optional)", config.token); config.token = token;
      saveConfig(config);
      std::string detail;
      const bool applied = applyModelSettings(config, detail);
      loadSessions(config); loadSubagents(config);
      status = applied ? "Settings saved - " + detail : "Saved locally - model update failed: " + detail;
    }
    if (pressed & SCE_CTRL_CROSS) {
      if (activePage == 1) {
        if (!sessions[activeSession].session.empty()) { loadSessionHistory(config, sessions[activeSession]); chat = sessions[activeSession]; activePage = 0; status = "Session opened"; }
      } else if (activePage == 2 && !subagentChatOpen) {
        if (!agents[activeAgent].session.empty()) { loadSubagentHistory(config, agents[activeAgent]); subagentChatOpen = true; status = "Chatting with " + agents[activeAgent].name; }
      } else {
        Channel& target = currentChannel();
        auto message = prompt(("Message " + target.name).c_str(), "");
        if (!message.empty()) {
          target.messages.push_back({"You", message, nowTime()}); jumpToBottom(target);
          status = target.name + " is working..."; draw(config, status);
          std::string response, reply; bool ok = false;
          liveConfig = &config; liveChannel = &target; liveStatus = status; sseCarry.clear();
          if (activePage == 0) {
            const std::string body = "{\"message\":\"" + esc(message) + "\",\"sessionId\":\"" + esc(target.session) + "\",\"origin\":{\"channel\":\"mobile\",\"surface\":\"ps_vita\",\"device\":\"handheld\",\"label\":\"PS Vita / " + esc(target.name) + "\",\"source\":\"prometheus_vita_native\"}}";
            ok = post(config, "/prometheus/chat", body, response); reply = parseSse(response);
          } else {
            liveChannel = nullptr;
            const std::string body = "{\"message\":\"" + esc(message) + "\",\"source\":\"prometheus_vita_native\"}";
            ok = post(config, "/prometheus/agents/" + target.session + "/chat", body, response);
            reply = jsonField(response, "content"); if (reply.empty()) reply = jsonField(response, "response"); if (reply.empty()) reply = jsonField(response, "reply");
          }
          liveChannel = nullptr; liveConfig = nullptr;
          if (ok) {
            target.messages.push_back({activePage == 0 ? "Prometheus" : target.name, reply.empty() ? "Turn completed." : reply, nowTime()});
            status = "Connected";
          } else {
            target.messages.push_back({"System", "Connection failed: " + httpError + ". PC bridge should be http://10.0.0.125:8780", nowTime()});
            status = "Offline - " + httpError;
          }
          jumpToBottom(target);
        }
      }
    }
    sceKernelDelayThread(16000);
  }
  shutdown(); sceKernelExitProcess(0); return 0;
}