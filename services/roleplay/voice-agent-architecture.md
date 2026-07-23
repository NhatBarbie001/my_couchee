# Voice Agent — Kiến trúc & Tổng hợp kỹ thuật

> Stack: **Node.js · Moleculer · LangGraphJS · Deepgram · Anthropic / OpenAI / Gemini · Cartesia / ElevenLabs / Azure TTS**

---

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Luồng xử lý request](#2-luồng-xử-lý-request)
3. [Cấu trúc thư mục](#3-cấu-trúc-thư-mục)
4. [Mixins](#4-mixins)
5. [Services](#5-services)
6. [Graph (LangGraphJS)](#6-graph-langgraphjs)
7. [STT Provider Abstraction](#7-stt-provider-abstraction)
8. [TTS Provider Abstraction](#8-tts-provider-abstraction)
9. [LLM Provider Abstraction](#9-llm-provider-abstraction)
10. [Cấu hình & biến môi trường](#10-cấu-hình--biến-môi-trường)
11. [Scaling trên Kubernetes](#11-scaling-trên-kubernetes)

---

## 1. Tổng quan kiến trúc

```
Browser / Mobile
      │  WebSocket (PCM audio chunks)
      ▼
┌─────────────────────────────────────────────────┐
│                  gateway.service                │  ← WebSocket server, session routing
└───────────────────────┬─────────────────────────┘
                        │ broker.call (TCP transporter)
          ┌─────────────▼──────────────┐
          │        vad.service         │  ← Silero VAD (ONNX) + STT streaming
          └─────────────┬──────────────┘
                        │ transcript ready
          ┌─────────────▼──────────────┐
          │   orchestrator.service     │  ← LangGraphJS graph runner
          └─────────────┬──────────────┘
                        │
          ┌─────────────▼──────────────┐
          │       llm.service          │  ← LLM provider abstraction, sentence streaming
          └─────────────┬──────────────┘
                        │ broker.call per sentence (fire-and-forget)
          ┌─────────────▼──────────────┐
          │       tts.service          │  ← TTS provider abstraction
          └─────────────┬──────────────┘
                        │ PCM chunks
                        ▼
               StreamMixin → gateway → WebSocket → Browser
```

**Nguyên tắc thiết kế:**

- Mỗi service scale độc lập trên K8s — tăng replica `vad.service` hay `tts.service` không ảnh hưởng service khác.
- Moleculer TCP transporter tự load balance các `broker.call` giữa các replica.
- Provider abstraction (STT & TTS) swap qua env var, không thay đổi một dòng code business logic.
- LangGraph chỉ còn 1 node (`llm`) — TTS được gọi trực tiếp từ bên trong node dưới dạng fire-and-forget để giảm latency tối đa.

---

## 2. Luồng xử lý request

### 2.1 Happy path (không có interruption)

```
1. Browser  ──PCM chunks──▶  gateway.service
2. gateway  ──broker.call──▶  vad.service.process()
3. vad      ──[speech detected]──▶  mở Deepgram WebSocket stream, feed audio liên tục
4. vad      ──[silence detected, N frames]──▶  đợi 150ms, flush Deepgram
5. vad      ──broker.call──▶  orchestrator.run({ sessionId, transcript })
6. orchestr ──graph.invoke──▶  llm node
7. llm      ──Anthropic stream──▶  generate từng token
8. llm      ──[câu hoàn chỉnh .?!]──▶  broker.call tts.synthesize (fire-and-forget)
9. tts      ──provider.synthesizeStream──▶  PCM chunks
10. tts     ──StreamMixin──▶  gateway.audio.out event
11. gateway ──ws.send──▶  Browser (phát audio)
```

### 2.2 Interruption path

```
1. Browser  ──{ type: "interrupt" }──▶  gateway.service
2. gateway  ──broker.call──▶  orchestrator.cancel({ sessionId })
3. orchestr ──AbortController.abort()──▶  LangGraph graph bị cancel
4. gateway  ──emit "gateway.interrupt"──▶  browser dừng phát audio
5. vad      ──cleanup──▶  đóng Deepgram stream hiện tại
```

### 2.3 Latency budget (ước tính)

| Giai đoạn | Latency |
|---|---|
| VAD detect speech end | ~80ms (10 silence frames × 8ms) |
| Deepgram flush | ~150ms (wait + final transcript) |
| LLM first token | ~200–400ms |
| TTS TTFB (Cartesia) | ~80ms |
| WebSocket round trip | ~10–30ms |
| **Tổng TTFB** | **~520–740ms** |

---

## 3. Cấu trúc thư mục

```
voice-agent/
├── mixins/
│   ├── audio.mixin.js        # PCM encode/decode, buffer management
│   ├── session.mixin.js      # Redis session CRUD, getOrCreateSession
│   ├── stream.mixin.js       # streamAudioToClient, sendInterrupt
│   └── interrupt.mixin.js    # handleInterrupt, cancel orchestrator
│
├── services/
│   ├── gateway.service.js    # WebSocket server, session map, audio routing
│   ├── vad.service.js        # Silero VAD + STT provider (stream mode)
│   ├── orchestrator.service.js  # LangGraphJS runner, AbortController map
│   ├── llm.service.js        # Anthropic streaming, sentence detection
│   └── tts.service.js        # TTS provider abstraction, StreamMixin
│
├── services/llm/
│   ├── index.js              # createLLMProvider() factory
│   └── providers/
│       ├── base.provider.js
│       ├── anthropic.provider.js
│       ├── openai.provider.js
│       └── gemini.provider.js
│
├── services/stt/
│   ├── index.js              # createSTTProvider() factory
│   └── providers/
│       ├── base.provider.js
│       ├── deepgram.provider.js
│       ├── azure.provider.js
│       └── whisper.provider.js
│
├── services/tts/
│   ├── index.js              # createTTSProvider() factory
│   └── providers/
│       ├── base.provider.js
│       ├── elevenlabs.provider.js
│       ├── cartesia.provider.js
│       └── azure.provider.js
│
├── graph/
│   ├── agent.graph.js        # LangGraphJS definition (1 node: llm)
│   ├── nodes/
│   │   └── llm.node.js
│   └── state.js              # ConversationState schema
│
├── moleculer.config.js
└── k8s/
    ├── gateway.deploy.yaml
    ├── vad.deploy.yaml
    ├── orchestrator.deploy.yaml
    ├── llm.deploy.yaml
    └── tts.deploy.yaml
```

---

## 4. Mixins

Mixins là các module tái sử dụng, inject vào service qua mảng `mixins: []`. Không có business logic riêng — chỉ cung cấp methods dùng chung.

### 4.1 `session.mixin.js`

**Mục đích:** CRUD session trên Redis cache. Mỗi WebSocket connection = một session với `conversationId` riêng.

**Methods:**

| Method | Mô tả |
|---|---|
| `getSession(sessionId)` | Đọc session từ Redis, trả về `null` nếu không tồn tại |
| `setSession(sessionId, data)` | Ghi session, TTL 3600s |
| `getOrCreateSession(sessionId)` | Đọc hoặc tạo mới nếu chưa có, khởi tạo `history: []` |

**Schema session:**
```js
{
  id: "uuid-v4",
  history: [           // OpenAI message format
    { role: "user", content: "..." },
    { role: "assistant", content: "..." }
  ],
  createdAt: 1234567890
}
```

**Sử dụng bởi:** `orchestrator.service`, `gateway.service`

---

### 4.2 `stream.mixin.js`

**Mục đích:** Abstraction layer để gửi audio chunks về đúng WebSocket client theo `sessionId`, tách biệt logic audio routing khỏi business logic.

**Methods:**

| Method | Mô tả |
|---|---|
| `streamAudioToClient(sessionId, pcmChunk)` | Emit event `gateway.audio.out` với PCM buffer |
| `sendInterrupt(sessionId)` | Emit event `gateway.interrupt` để browser dừng phát |

**Lưu ý:** Mixin không giữ WebSocket connection trực tiếp — giao tiếp qua Moleculer event bus. `gateway.service` là nơi duy nhất giữ Map `sessionId → WebSocket`.

**Sử dụng bởi:** `tts.service`, `llm.service`

---

### 4.3 `interrupt.mixin.js`

**Mục đích:** Xử lý logic ngắt lời người dùng — cancel LangGraph run và báo browser dừng audio.

**Methods:**

| Method | Mô tả |
|---|---|
| `handleInterrupt(sessionId)` | Gọi `orchestrator.cancel` + emit `gateway.interrupt` |

**Flow khi interrupt:**
```
user nói trong khi bot đang nói
  → gateway nhận { type: "interrupt" }
  → InterruptMixin.handleInterrupt()
    → orchestrator.cancel → AbortController.abort()
    → gateway.interrupt event → ws.send({ type: "interrupt" })
  → browser: dừng AudioContext, clear queue
```

**Sử dụng bởi:** `gateway.service`, `vad.service`

---

### 4.4 `audio.mixin.js`

**Mục đích:** Xử lý chuyển đổi format audio PCM — cầu nối giữa browser (Float32) và các provider (Int16).

**Methods:**

| Method | Input | Output | Mô tả |
|---|---|---|---|
| `int16ToFloat32(buffer)` | `Buffer` (Int16LE) | `Float32Array` | Cho Silero VAD |
| `float32ToInt16(float32)` | `Float32Array` | `Buffer` (Int16LE) | Cho Deepgram |
| `float32ToWav(float32, sampleRate)` | `Float32Array` | `Buffer` | Cho Whisper (HTTP upload) |
| `mergeBuffers(chunks)` | `Float32Array[]` | `Float32Array` | Gộp nhiều chunks thành 1 |

**Sử dụng bởi:** `vad.service`, STT providers

---

## 5. Services

### 5.1 `gateway.service.js`

**Vai trò:** Entry point duy nhất. Quản lý WebSocket connections, định tuyến audio vào/ra.

**Settings:**
```js
settings: {
  port: 3000,
  ws: { path: "/call" }
}
```

**State nội bộ:**
```js
this.sessions = new Map(); // sessionId → WebSocket instance
```

**Actions:** _(không có — chỉ xử lý events và WebSocket messages)_

**Events lắng nghe:**

| Event | Payload | Hành động |
|---|---|---|
| `gateway.audio.out` | `{ sessionId, audio: Buffer }` | `ws.send(audio)` về đúng client |
| `gateway.interrupt` | `{ sessionId }` | `ws.send({ type: "interrupt" })` |

**WebSocket message handling:**

| Message type | Hành động |
|---|---|
| `Buffer` (binary) | `broker.call("vad.process", { sessionId, audio })` |
| `{ type: "interrupt" }` | `broker.call("orchestrator.cancel", { sessionId })` |

**Mixins:** `SessionMixin`

---

### 5.2 `vad.service.js`

**Vai trò:** Voice Activity Detection kết hợp STT streaming. Detect khi user bắt đầu / kết thúc nói, đồng thời stream audio lên STT provider ngay lập tức để giảm latency.

**Model:** Silero VAD chạy qua ONNX Runtime (local, không gọi API ngoài).

**Session state per connection:**
```js
{
  isSpeaking: false,
  silenceFrames: 0,
  SILENCE_THRESHOLD: 10,     // ~80ms silence → end of speech
  pending: null,             // Float32Array buffer chờ đủ 512 frames
  finalTranscript: "",       // tích lũy từ STT
  dgStream: null,            // STT stream handle (nếu provider hỗ trợ streaming)
  speechBuffer: [],          // chỉ dùng khi provider là batch (Whisper)
  h, c,                      // Silero LSTM hidden states
}
```

**Actions:**

| Action | Params | Mô tả |
|---|---|---|
| `vad.process` | `{ sessionId, audio: Buffer }` | Feed audio chunk vào VAD pipeline |
| `vad.cleanup` | `{ sessionId }` | Đóng stream, xóa state khi session kết thúc |

**Logic cốt lõi:**

```
Mỗi 512 frames PCM (32ms @ 16kHz):
  → runVAD() → prob (0.0 → 1.0)

  prob > 0.5 (speech):
    → nếu chưa có stream: mở STT stream ngay
    → feed chunk vào STT stream
    → reset silenceFrames = 0

  prob ≤ 0.5 (silence):
    → nếu đang nói: tăng silenceFrames
    → vẫn feed silence vào STT (để xử lý trailing audio)
    → nếu silenceFrames ≥ THRESHOLD:
        → đợi 150ms (flush STT)
        → đóng STT stream
        → broker.call("orchestrator.run", { sessionId, transcript })
```

**Adaptation theo provider:**
- Provider có `supportsStreaming = true` (Deepgram, Azure): stream audio liên tục, STT chạy song song.
- Provider có `supportsStreaming = false` (Whisper): tích lũy buffer, gửi batch khi speech kết thúc.

**Mixins:** `AudioMixin`

---

### 5.3 `orchestrator.service.js`

**Vai trò:** Runner cho LangGraphJS graph. Quản lý vòng đời của mỗi conversation turn — khởi chạy, cancel khi interrupt.

**State nội bộ:**
```js
this.runningJobs = new Map(); // sessionId → AbortController
```

**Actions:**

| Action | Params | Mô tả |
|---|---|---|
| `orchestrator.run` | `{ sessionId, transcript }` | Chạy graph cho turn mới |
| `orchestrator.cancel` | `{ sessionId }` | Abort graph đang chạy |

**Logic run:**
```js
// Cancel job cũ ngay lập tức (handle trường hợp user interrupt giữa chừng)
this.runningJobs.get(sessionId)?.abort();

const controller = new AbortController();
this.runningJobs.set(sessionId, controller);

const session = await this.getOrCreateSession(sessionId);

await this.graph.invoke(
  { sessionId, transcript, history: session.history },
  { signal: controller.signal }   // LangGraph respect AbortSignal
);
```

**Mixins:** `SessionMixin`

---

### 5.4 `llm.service.js`

**Vai trò:** Delegate generation xuống LLM provider, nhận token stream, detect câu hoàn chỉnh, forward từng câu sang TTS ngay lập tức (fire-and-forget). Service không biết provider nào đang chạy.

**Actions:**

| Action | Params | Returns |
|---|---|---|
| `llm.generate` | `{ sessionId, transcript, history }` | `{ response: string, updatedHistory }` |

**Core logic:**
```js
await this.llmProvider.streamTokens(
  { messages, system },
  (token) => {
    buffer += token;
    fullResponse += token;
    if (/[.?!…]$/.test(buffer.trim())) {
      broker.call("tts.synthesize", { sessionId, text: buffer.trim() }); // fire-and-forget
      buffer = "";
    }
  }
);
```

Sentence detection và TTS fire-and-forget nằm ở `llm.service`, không phải trong provider — provider chỉ lo stream tokens.

**Lưu ý về ordered queue:** Nếu câu 2 ngắn hơn câu 1, TTS có thể hoàn thành câu 2 trước → audio lộn thứ tự. Cần implement ordered queue nếu bật concurrency TTS.

**Mixins:** `StreamMixin`

---

### 5.5 `tts.service.js`

**Vai trò:** Nhận text từ `llm.service`, delegate xuống TTS provider, stream PCM chunks về client qua `StreamMixin`.

**Actions:**

| Action | Params | Mô tả |
|---|---|---|
| `tts.synthesize` | `{ sessionId, text }` | Synthesize và stream audio |

**Core logic:**
```js
await this.ttsProvider.synthesizeStream(text, (pcmChunk) => {
  this.streamAudioToClient(sessionId, pcmChunk);
});
```

Service không biết provider nào đang chạy. Không biết Cartesia hay ElevenLabs. Chỉ gọi `synthesizeStream` và forward chunks.

**Mixins:** `StreamMixin`

---

## 6. Graph (LangGraphJS)

### Trạng thái hiện tại — 1 node

Sau khi refactor, graph chỉ còn 1 node thực sự vì TTS được gọi trực tiếp từ bên trong `llm` node:

```
[START] → llm → [END]
```

**State schema (`graph/state.js`):**
```js
{
  sessionId:  null,           // string
  transcript: null,           // string — input từ VAD
  history:    { default: () => [] },  // conversation history
}
```

**llm node:**
```js
graph.addNode("llm", async (state) => {
  // Anthropic streaming + sentence detection + TTS fire-and-forget
  // Returns updated history
  return {
    history: [
      ...state.history,
      { role: "user",      content: state.transcript },
      { role: "assistant", content: fullResponse },
    ],
  };
});
```

### Khi nào cần thêm node sau LLM?

| Use case | Node thêm |
|---|---|
| Persist history vào DB | `save_history` node |
| Quyết định chuyển sang human agent | `check_escalate` node |
| Ghi nhận cuộc gọi vào CRM | `update_crm` node |
| Tool calling (search, API) | `tool_executor` node + conditional edge |

TTS không bao giờ là node trong graph — nó là output channel, không phải bước business logic.

---

## 7. STT Provider Abstraction

### Interface

```js
class BaseSTTProvider {
  get supportsStreaming() { return false; }

  // Chỉ gọi khi supportsStreaming = true
  // Trả về { send(chunk), close() }
  async openStream({ onPartial, onFinal, onError }) {}

  // Chỉ gọi khi supportsStreaming = false
  // audio: Float32Array
  async transcribe({ audio }) {}
}
```

### So sánh providers

| | Deepgram | Azure STT | Whisper |
|---|---|---|---|
| `supportsStreaming` | ✅ true | ✅ true | ❌ false |
| Protocol | WebSocket | WebSocket | HTTP upload |
| Partial transcripts | ✅ | ✅ | ❌ |
| Input format | PCM Int16 | PCM Int16 | WAV file |
| Tiếng Việt | ✅ nova-2 | ✅ vi-VN | ✅ |
| Latency khi dùng với VAD | Thấp | Thấp | Cao (batch) |

### Cách `vad.service` tự adapt

`vad.service` đọc `provider.supportsStreaming` khi khởi động và chọn strategy:

- **Streaming mode:** Mở stream ngay khi detect speech bắt đầu, feed audio liên tục → LLM bắt đầu sau ~150ms từ khi user dừng nói.
- **Batch mode:** Tích lũy buffer toàn bộ speech → gửi một lần sau `onSpeechEnd` → LLM bắt đầu sau Whisper API latency (~500ms+).

---

## 8. TTS Provider Abstraction

### Interface

```js
class BaseTTSProvider {
  // onChunk(pcmBuffer: Buffer) được gọi mỗi khi có audio chunk
  async synthesizeStream(text, onChunk) {}
}
```

Interface cố tình đơn giản — một method duy nhất. Không có `supportsStreaming` như STT vì tất cả TTS providers đều được wrap thành streaming interface (kể cả batch provider, `onChunk` chỉ được gọi một lần khi xong).

### So sánh providers

| | ElevenLabs | Cartesia | Azure TTS |
|---|---|---|---|
| Protocol | WebSocket | HTTP chunked | WebSocket |
| TTFB | ~200ms | ~80ms | ~150ms |
| Voice quality | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ |
| Tiếng Việt | Hạn chế | ✅ | ✅ vi-VN-HoaiMyNeural |
| SSML support | ❌ | ❌ | ✅ |
| Output format | PCM 16kHz | PCM s16le | PCM Raw |

### Lưu ý ElevenLabs WebSocket protocol

ElevenLabs yêu cầu sequence cụ thể:
```
1. Gửi BOS (Begin Of Stream): { text: " ", voice_settings: {...} }
2. Gửi text thực: { text: "...", try_trigger_generation: true }
3. Gửi EOS (End Of Stream): { text: "" }
```

---

## 9. LLM Provider Abstraction

### Interface

```js
class BaseLLMProvider {
  // streamTokens gọi onToken(text) mỗi khi có token mới
  // Resolve khi stream kết thúc, trả về full response string
  async streamTokens({ messages, system }, onToken) {}
}
```

Trách nhiệm phân chia rõ ràng:
- **Provider:** biết cách gọi API, normalize token format về `string`
- **`llm.service`:** biết cách gom token thành câu, biết cách gọi TTS

### Cấu trúc thư mục

```
services/llm/
├── index.js                    # createLLMProvider() factory
└── providers/
    ├── base.provider.js
    ├── anthropic.provider.js   # Claude (Anthropic SDK)
    ├── openai.provider.js      # GPT-4o, GPT-4.1 (OpenAI SDK)
    └── gemini.provider.js      # Gemini (Google GenAI SDK)
```

### `providers/base.provider.js`

```js
class BaseLLMProvider {
  async streamTokens({ messages, system }, onToken) {
    throw new Error("Not implemented");
  }
}

module.exports = BaseLLMProvider;
```

### `providers/anthropic.provider.js`

```js
const Anthropic = require("@anthropic-ai/sdk");
const BaseLLMProvider = require("./base.provider");

class AnthropicProvider extends BaseLLMProvider {
  constructor({ apiKey, model = "claude-sonnet-4-20250514", maxTokens = 1024 }) {
    super();
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.maxTokens = maxTokens;
  }

  async streamTokens({ messages, system }, onToken) {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      messages,
    });

    for await (const chunk of stream) {
      const text = chunk.delta?.text;
      if (text) onToken(text);
    }
  }
}

module.exports = AnthropicProvider;
```

### `providers/openai.provider.js`

```js
const OpenAI = require("openai");
const BaseLLMProvider = require("./base.provider");

class OpenAIProvider extends BaseLLMProvider {
  constructor({ apiKey, model = "gpt-4o", maxTokens = 1024 }) {
    super();
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.maxTokens = maxTokens;
  }

  async streamTokens({ messages, system }, onToken) {
    // Normalize: OpenAI nhận system message như một entry đầu tiên
    const normalizedMessages = system
      ? [{ role: "system", content: system }, ...messages]
      : messages;

    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: normalizedMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) onToken(text);
    }
  }
}

module.exports = OpenAIProvider;
```

### `providers/gemini.provider.js`

```js
const { GoogleGenAI } = require("@google/genai");
const BaseLLMProvider = require("./base.provider");

class GeminiProvider extends BaseLLMProvider {
  constructor({ apiKey, model = "gemini-2.0-flash", maxTokens = 1024 }) {
    super();
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
    this.maxTokens = maxTokens;
  }

  async streamTokens({ messages, system }, onToken) {
    // Gemini phân biệt history (turns trước) và current message
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const lastMessage = messages.at(-1).content;

    const chat = this.ai.chats.create({
      model: this.model,
      config: {
        systemInstruction: system,
        maxOutputTokens: this.maxTokens,
      },
      history,
    });

    const stream = await chat.sendMessageStream({ message: lastMessage });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) onToken(text);
    }
  }
}

module.exports = GeminiProvider;
```

### `llm/index.js` — Factory

```js
const AnthropicProvider = require("./providers/anthropic.provider");
const OpenAIProvider    = require("./providers/openai.provider");
const GeminiProvider    = require("./providers/gemini.provider");

const PROVIDERS = {
  anthropic: AnthropicProvider,
  openai:    OpenAIProvider,
  gemini:    GeminiProvider,
};

function createLLMProvider(name, config) {
  const Provider = PROVIDERS[name];
  if (!Provider) throw new Error(`Unknown LLM provider: ${name}`);
  return new Provider(config);
}

module.exports = { createLLMProvider };
```

### `llm.service.js` — sau khi refactor

```js
const { createLLMProvider } = require("./llm");
const StreamMixin = require("../mixins/stream.mixin");

module.exports = {
  name: "llm",
  mixins: [StreamMixin],

  settings: {
    llm: {
      provider: process.env.LLM_PROVIDER ?? "anthropic",
      config: {
        apiKey:    process.env.LLM_API_KEY,
        model:     process.env.LLM_MODEL,
        maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 1024),
      },
    },
    system: process.env.LLM_SYSTEM_PROMPT ?? "You are a helpful voice assistant.",
  },

  created() {
    this.llmProvider = createLLMProvider(
      this.settings.llm.provider,
      this.settings.llm.config
    );
    this.logger.info(`LLM provider: ${this.settings.llm.provider}`);
  },

  actions: {
    async generate({ params: { sessionId, transcript, history } }) {
      const messages = [
        ...history,
        { role: "user", content: transcript },
      ];

      let buffer = "";
      let fullResponse = "";

      await this.llmProvider.streamTokens(
        { messages, system: this.settings.system },
        (token) => {
          buffer += token;
          fullResponse += token;

          if (/[.?!…]$/.test(buffer.trim())) {
            // fire-and-forget — không await
            this.broker.call("tts.synthesize", {
              sessionId,
              text: buffer.trim(),
            });
            buffer = "";
          }
        }
      );

      // Flush phần còn lại (câu cuối không có dấu kết thúc)
      if (buffer.trim()) {
        this.broker.call("tts.synthesize", {
          sessionId,
          text: buffer.trim(),
        });
      }

      return {
        response: fullResponse,
        updatedHistory: [
          ...history,
          { role: "user",      content: transcript },
          { role: "assistant", content: fullResponse },
        ],
      };
    },
  },
};
```

### So sánh providers

| | Anthropic (Claude) | OpenAI (GPT) | Google (Gemini) |
|---|---|---|---|
| SDK | `@anthropic-ai/sdk` | `openai` | `@google/genai` |
| System prompt | Field riêng `system` | Message `role: "system"` | `systemInstruction` trong config |
| Token field | `chunk.delta.text` | `chunk.choices[0].delta.content` | `chunk.text` |
| Tiếng Việt | ✅ | ✅ | ✅ |
| Streaming | ✅ | ✅ | ✅ |

Điểm khác biệt quan trọng nhất là cách mỗi provider nhận **system prompt** — provider phải tự normalize, `llm.service` luôn truyền `{ messages, system }` theo chuẩn chung.

### Swap provider chỉ đổi env

```bash
# Claude Sonnet (mặc định)
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514

# GPT-4o
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o

# Gemini Flash
LLM_PROVIDER=gemini
LLM_API_KEY=AI...
LLM_MODEL=gemini-2.0-flash
```

---

## 10. Cấu hình & biến môi trường

### `moleculer.config.js`

```js
module.exports = {
  namespace:   "voice-agent",
  transporter: "TCP",
  cacher: {
    type: "Redis",
    options: { redis: { host: "redis" } }
  },
  logger:  { type: "Console", options: { level: "info" } },
  metrics: { enabled: true, reporter: [{ type: "Prometheus" }] },
};
```

### Biến môi trường đầy đủ

```bash
# === STT ===
STT_PROVIDER=deepgram          # deepgram | azure | whisper
STT_API_KEY=                   # Deepgram hoặc OpenAI API key
STT_LANGUAGE=vi                # vi | en | ...
AZURE_SPEECH_KEY=              # chỉ dùng khi STT_PROVIDER=azure
AZURE_SPEECH_REGION=southeastasia

# === LLM ===
LLM_PROVIDER=anthropic         # anthropic | openai | gemini
LLM_API_KEY=                   # API key của provider tương ứng
LLM_MODEL=                     # Model ID (mặc định theo từng provider)
LLM_MAX_TOKENS=1024
LLM_SYSTEM_PROMPT=You are a helpful voice assistant.

# === TTS ===
TTS_PROVIDER=cartesia           # cartesia | elevenlabs | azure
TTS_API_KEY=                    # Cartesia hoặc ElevenLabs API key
TTS_VOICE_ID=                   # Voice ID của provider
AZURE_TTS_KEY=                  # chỉ dùng khi TTS_PROVIDER=azure
AZURE_TTS_REGION=southeastasia
AZURE_TTS_VOICE=vi-VN-HoaiMyNeural

# === Infrastructure ===
REDIS_HOST=redis
REDIS_PORT=6379
```

---

## 11. Scaling trên Kubernetes

### Chiến lược scale theo bottleneck

| Service | Stateful? | Scale strategy |
|---|---|---|
| `gateway.service` | Có (WebSocket Map) | Sticky session + HPA theo connections |
| `vad.service` | Có (session state) | Session affinity qua sessionId header |
| `orchestrator.service` | Có (AbortController Map) | Session affinity |
| `llm.service` | Không | HPA theo CPU / request queue |
| `tts.service` | Không | HPA theo CPU / request queue |

`llm.service` và `tts.service` là **stateless** — Moleculer tự load balance. Đây thường là bottleneck thực tế nên dễ scale nhất.

`vad.service` và `orchestrator.service` có session state → cần sticky session hoặc chuyển state ra Redis nếu muốn scale ngang.

### Ví dụ HPA cho `tts.service`

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: tts-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: tts-service
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
```

### Thứ tự khởi động

```
1. Redis
2. gateway.service    (cần trước khi client connect)
3. vad.service
4. orchestrator.service
5. llm.service
6. tts.service
```

Moleculer tự retry các `broker.call` nếu service chưa sẵn sàng — không cần hard dependency, nhưng thứ tự trên giảm lỗi khởi động.

---

## Tóm tắt dependency graph

```
gateway ──calls──▶ vad
vad     ──calls──▶ orchestrator
orchestr──invokes─▶ graph/llm node
llm node──calls──▶ tts (fire-and-forget, per sentence)
tts     ──emits──▶ gateway.audio.out
gateway ──sends──▶ WebSocket client
```

Không có circular dependency. `gateway` là entry và exit point duy nhất — nhận audio từ browser và trả audio về browser.