# Clickee Coach Roleplay Backend

This is the backend for Clickee Coach Roleplay system, a microservices-based application built with Moleculer framework for AI-powered roleplay training.

## Overview

Clickee Coach Roleplay Suite is a web application that allows students to participate in pre-configured AI Persona courses according to various scenarios, such as customer service scenarios, telesales scenarios, etc. Each course will have tasks that students must complete with Personas, for example: A telesales course for a difficult customer will have 1 difficult AI Persona and the task is to sell goods to that customer. Students will practice tasks by simulating video calls with AI Personas. After completing the video call, there will be an analysis screen that provides evaluation results based on the exchange between AI Persona and students during the video call process.

## Core Features

- **AI-Powered Roleplay Training**: Real-time conversation with AI personas
- **Speech Processing**: STT (Speech-to-Text) and TTS (Text-to-Speech) capabilities
- **Real-time Communication**: WebSocket-based audio streaming
- **Course Management**: Structured learning paths with tasks and scenarios
- **Analysis & Feedback**: Comprehensive performance analysis including emotion and speech analysis
- **Multi-tenant Architecture**: Organization and user management

## Services Architecture

### Core Roleplay Services
- **roleplay/**: Main roleplay functionality
  - `aipersonas/`: AI persona management
  - `courses/`: Course and curriculum management
  - `tasks/`: Task definitions and management
  - `roleplaysessions/`: Session management and real-time processing
  - `analysises/`: Performance analysis and feedback
  - `statistics/`: Comprehensive statistics and reporting service
  - `emotionanalysis/`: Emotion detection and analysis
  - `references/`: Course reference materials
  - `speechprocessing.service.js`: STT/TTS processing
  - `openai.service.js`: OpenAI integration for LLM

### Supporting Services
- **users/**: User management and authentication
- **settings/**: Application configuration
- **websocket/**: Real-time communication
- **openai/**: OpenAI API integration (ChatGPT, Whisper, TTS)
- **File/**: File storage and management
- **Image/**: Image processing and storage
- **Organization/**: Multi-tenant organization management
- **OrganizationUser/**: User-organization relationships
- **Role/**: Role-based access control
- **permissions/**: Permission management
- **PaymentModule/**: Subscription and billing management
- **cronjobs/**: Scheduled tasks and maintenance
- **RateLimit/**: API rate limiting

## Technology Stack

- **Framework**: Moleculer.js (Microservices)
- **Database**: MongoDB with Mongoose
- **Real-time**: Socket.IO for WebSocket communication
- **AI/ML**: OpenAI GPT-4, Whisper (STT), TTS
- **Speech Processing**: Microsoft Cognitive Services, Sherpa-ONNX
- **Audio Processing**: FFmpeg, WAV processing
- **Authentication**: JWT tokens
- **File Storage**: Local storage with configurable options

## Getting Started

### Prerequisites

- Node.js (>= 16.x.x)
- MongoDB
- FFmpeg (for audio processing)
- npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables (copy `.env.example` to `.env` and configure):
   - MongoDB connection string
   - OpenAI API key
   - Microsoft Speech Services keys (if using)
   - Other service configurations

4. Start the development server:
   ```bash
   npm run dev
   ```

### Environment Variables

Key environment variables needed:
- `OPENAI_API_KEY`: OpenAI API key for LLM and speech services
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: Secret for JWT token signing
- `SPEECH_KEY`: Microsoft Speech Services key (optional)
- `SPEECH_REGION`: Microsoft Speech Services region (optional)

## API Endpoints

### Roleplay Endpoints
- `GET /api/roleplay/courses` - List available courses
- `POST /api/roleplay/sessions` - Start a new roleplay session
- `GET /api/roleplay/sessions/:id` - Get session details
- `GET /api/roleplay/analysis/:sessionId` - Get session analysis

### WebSocket Events
- `roleplay.client.connected` - Client connection to roleplay namespace
- `client:start_session` - Start roleplay session
- `client:audio_chunk` - Audio data streaming
- `server:ai_response` - AI response streaming
- `server:session_ended` - Session completion

## Development

### Scripts

- `npm run dev` - Start development server with hot reload
- `npm run start` - Start production server with clustering
- `npm test` - Run tests
- `npm run lint` - Run ESLint

### Project Structure

```
services/
├── roleplay/           # Core roleplay functionality
├── users/             # User management
├── settings/          # Configuration
├── websocket/         # Real-time communication
├── openai/           # AI services
├── File/             # File management
├── Organization/     # Multi-tenancy
└── ...               # Other supporting services
```

## Documentation

📚 **Comprehensive documentation is available in the `/docs` folder:**

### ⭐ Bắt đầu từ đây:
- **[Default Permission Guide](./docs/DEFAULT_PERMISSION_GUIDE.md)** - Cách đơn giản nhất để thêm permission (chỉ 2 dòng code!)
- **[Examples](./docs/EXAMPLE_SERVICE_WITH_DEFAULT_PERMISSION.js)** - Ví dụ thực tế sử dụng Default Permission Mixin

### Chi tiết:
- **[Permission System Guide](./docs/PERMISSION_GUIDE.md)** - Hướng dẫn chi tiết về hệ thống permission và RBAC
- **[Permission Changelog](./docs/CHANGELOG_PERMISSION.md)** - Lịch sử thay đổi và migration guide
- **[Service Template](./docs/SERVICE_TEMPLATE_WITH_PERMISSION.js)** - Template mẫu để tạo service mới

### Quick Start:
```javascript
// Chỉ cần thêm 2 dòng này vào service:
mixins: [DbMongoose(Model), BaseService, DefaultPermission],
settings: { defaultResource: 'your-resource' }
// Tất cả actions đã có permission tự động!
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. **Read [Permission Guide](./docs/PERMISSION_GUIDE.md) before implementing new services**
5. Add tests if applicable
6. Submit a pull request

## License

This project is proprietary software owned by Clickee Coach Team.
