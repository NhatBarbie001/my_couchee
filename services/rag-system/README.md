# RAG System Documentation

## Tổng Quan

Hệ thống RAG (Retrieval-Augmented Generation) cho phép tìm kiếm và truy xuất training data (kịch bản, persona) với độ chính xác cao thông qua:
- **Hybrid Search**: Kết hợp semantic search (dense vectors) và keyword search (sparse vectors)
- **Reranking**: Sắp xếp lại kết quả theo độ liên quan với Cohere Rerank API
- **Vector Database**: Qdrant để lưu trữ và tìm kiếm vectors

---

## Kiến Trúc Hệ Thống

```
┌─────────────────────────────────────────────────────────────────┐
│                         RAG SYSTEM                               │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Training Data   │  │   Embedding      │  │  Sparse Vector   │
│    Service       │  │    Service       │  │    Service       │
│                  │  │                  │  │                  │
│  - Parse data    │  │  - OpenAI API    │  │  - BM25 algo     │
│  - Store MongoDB │  │  - Dense vectors │  │  - Sparse vectors│
│  - Index to      │  │  - 1536d         │  │  - Vietnamese    │
│    Qdrant        │  │                  │  │    tokenization  │
└────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
         │                     │                      │
         └─────────────────────┼──────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Qdrant Service    │
                    │                     │
                    │  - Vector storage   │
                    │  - Hybrid search    │
                    │  - RRF fusion       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Rerank Service    │
                    │                     │
                    │  - Cohere API       │
                    │  - Result reranking │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    RAG Service      │
                    │                     │
                    │  - Query enhancement│
                    │  - Orchestration    │
                    │  - Final results    │
                    └─────────────────────┘
```

---

## Luồng Dữ Liệu

### 1. Luồng Indexing (Đưa Data Vào Hệ Thống)

```
User Input (Text/File)
    ↓
┌───────────────────────────────────────┐
│ training-data.service.js              │
│ - parseInputWithAI()                  │
│ - Phân tích với GPT-4                 │
│ - Lưu MongoDB (indexed: false)        │
└───────────────────────┬───────────────┘
                        ↓
                    Trigger Index
                        ↓
┌───────────────────────────────────────┐
│ indexToQdrant() hoặc                  │
│ indexMultipleToQdrant()               │
└───────────────────────┬───────────────┘
                        ↓
        ┌───────────────┴───────────────┐
        ↓                               ↓
┌────────────────┐            ┌────────────────┐
│ embedding      │            │ sparsevector   │
│ service        │            │ service        │
│                │            │                │
│ Dense vector   │            │ Sparse vector  │
│ [1536 floats]  │            │ {indices,      │
│                │            │  values}       │
└────────┬───────┘            └────────┬───────┘
         └──────────┬──────────────────┘
                    ↓
        ┌───────────────────────┐
        │ qdrant.service.js     │
        │ upsertPoints()        │
        │                       │
        │ point = {             │
        │   id: timestamp,      │
        │   vector: dense,      │
        │   sparse_vector: {    │
        │     text: sparse      │
        │   },                  │
        │   payload: metadata   │
        │ }                     │
        └───────────┬───────────┘
                    ↓
            ┌───────────────┐
            │ Qdrant DB     │
            │ Collection:   │
            │ training_data │
            └───────────────┘
                    ↓
        Update MongoDB: indexed = true
```

**Chi Tiết Indexing:**

1. **Parse Input** (`trainingdata.submitScenario`, `uploadBatchFile`):
   - Input: Text hoặc file (PDF, DOCX, etc.)
   - AI parsing với GPT-4.1
   - Output: Structured data (scenario, persona, data_label)
   - Lưu MongoDB với `indexed: false`

2. **Generate Vectors** (`indexToQdrant`):
   - Build combined text từ scenario + persona + labels
   - Gọi `embedding.createEmbedding()` → Dense vector (1536d)
   - Gọi `sparsevector.createSparseVector()` → Sparse vector (BM25)

3. **Upsert to Qdrant** (`qdrant.upsertPoints`):
   ```javascript
   {
     id: qdrantId,
     vector: [0.123, -0.456, ...],  // 1536 dimensions
     sparse_vector: {
       text: {
         indices: [12345, 67890, ...],
         values: [0.8, 0.6, ...]
       }
     },
     payload: {
       mongoId: "...",
       scenario: {...},
       persona: {...},
       data_label: {...}
     }
   }
   ```

4. **Update Status**: MongoDB `indexed: true`, `indexedAt: Date`

---

### 2. Luồng Search (Tìm Kiếm)

```
User Query: "ATM nuốt thẻ"
    ↓
┌───────────────────────────────────────┐
│ rag.service.js                        │
│ - enhanceQuery()                      │
│   Query → "ATM nuốt thẻ nuốt_thẻ..." │
└───────────────────────┬───────────────┘
                        ↓
        ┌───────────────┴───────────────┐
        ↓                               ↓
┌────────────────┐            ┌────────────────┐
│ embedding      │            │ sparsevector   │
│                │            │                │
│ Dense vector   │            │ Sparse vector  │
│ từ query       │            │ từ query       │
└────────┬───────┘            └────────┬───────┘
         └──────────┬──────────────────┘
                    ↓
        ┌───────────────────────┐
        │ qdrant.searchHybrid() │
        └───────────┬───────────┘
                    ↓
    ┌───────────────┴────────────────┐
    ↓                                ↓
┌──────────────┐          ┌──────────────┐
│ Dense Search │          │ Sparse Search│
│              │          │              │
│ Cosine       │          │ BM25         │
│ similarity   │          │ matching     │
│              │          │              │
│ 6 results    │          │ 6 results    │
└──────┬───────┘          └──────┬───────┘
       └──────────┬───────────────┘
                  ↓
        ┌─────────────────┐
        │ RRF Fusion      │
        │ (Reciprocal     │
        │  Rank Fusion)   │
        │                 │
        │ Top 9 results   │
        └────────┬────────┘
                 ↓
    ┌────────────────────────┐
    │ rerank.rerankResults() │
    │                        │
    │ Cohere Rerank API      │
    │ Multilingual v3.0      │
    │                        │
    │ Top 3 results          │
    └────────┬───────────────┘
             ↓
    ┌────────────────┐
    │ Final Results  │
    │ with relevance │
    │ scores         │
    └────────────────┘
```

**Chi Tiết Search:**

1. **Query Enhancement** (`rag.service.js`):
   ```javascript
   Input: "khiếu nại"
   Enhanced: "khiếu nại phàn nàn không hài lòng"
   ```

2. **Generate Query Vectors**:
   - Dense: OpenAI embedding của enhanced query
   - Sparse: BM25 vector từ query tokens (bao gồm bigrams/trigrams)

3. **Hybrid Search** (`qdrant.searchHybrid`):
   - **Dense search**: Tìm top N results theo cosine similarity
   - **Sparse search**: Tìm top N results theo BM25 matching
   - **RRF Fusion**: Kết hợp 2 kết quả với công thức:
     ```
     score = Σ(1 / (k + rank))
     k = 60 (default)
     ```

4. **Reranking** (optional, `rerank.service.js`):
   - Input: 9 results từ hybrid search
   - Cohere Rerank API đánh giá lại relevance
   - Output: Top 3-5 results chính xác nhất

5. **Return**: Final results với scores

---

## Services

### 1. training-data.service.js

**Chức năng**: Quản lý training data (scenarios, personas) trong MongoDB và index sang Qdrant.

**API Endpoints**:

```javascript
// 1. Submit single scenario
POST /api/trainingdata/submit
Body: {
  input: "text or json",
  inputType: "text" | "file",
  organizationId: "optional"
}

// 2. Upload batch file
POST /api/trainingdata/upload-batch-file
Content-Type: multipart/form-data
Body: FormData with file

// 3. Index to Qdrant
POST /api/trainingdata/:id/index
Params: { id: "mongoId" }

// 4. Batch index
POST /api/trainingdata/index-batch
Body: {
  ids: ["id1", "id2"],  // optional, nếu không có sẽ index all chưa index
  batchSize: 10         // optional
}

// 5. Remove from index
DELETE /api/trainingdata/:id/index

// 6. Reset indexed status
POST /api/trainingdata/reset-indexed
```

**Key Methods**:

```javascript
buildCombinedText(item) {
  // Kết hợp scenario + persona + labels thành text
  // "Kịch bản: ATM nuốt thẻ. Khách hàng: Bà Lan. 45 tuổi..."
}

buildPayload(item, qdrantId) {
  // Tạo metadata để lưu trong Qdrant
  // Chứa mongoId, scenario, persona, data_label
}
```

---

### 2. embedding.service.js

**Chức năng**: Tạo dense vectors từ text sử dụng OpenAI API.

**Configuration**:
```javascript
settings: {
  model: 'text-embedding-3-small',
  dimensions: 1536
}
```

**API**:

```javascript
// Create single embedding
POST /api/embedding/createEmbedding
Body: { text: "ATM nuốt thẻ" }
Response: { 
  embedding: [0.123, -0.456, ...],  // 1536 floats
  model: "text-embedding-3-small",
  dimensions: 1536
}

// Batch embeddings
POST /api/embedding/createBatchEmbeddings
Body: { 
  texts: ["text1", "text2", ...],  // max 100
  model: "text-embedding-3-small"  // optional
}
```

**Cost**: ~$0.00002 per 1K tokens (text-embedding-3-small)

---

### 3. sparse-vector.service.js

**Chức năng**: Tạo sparse vectors sử dụng BM25 algorithm cho keyword matching.

**Algorithm**: BM25 (Best Matching 25)

**Cách hoạt động**:
1. Tokenize text (giữ dấu tiếng Việt)
2. Tạo unigrams, bigrams, trigrams
   - "ATM nuốt thẻ" → ["atm", "nuốt", "thẻ", "atm_nuốt", "nuốt_thẻ", "atm_nuốt_thẻ"]
3. Tính BM25 score cho mỗi term
4. Hash terms thành indices
5. Return top 100 terms

**API**:

```javascript
POST /api/sparsevector/createSparseVector
Body: { text: "ATM nuốt thẻ" }
Response: {
  indices: [123456, 789012, ...],  // hashed term IDs
  values: [0.85, 0.72, ...]        // BM25 scores
}
```

**Parameters**:
- `k1 = 1.5`: Term frequency saturation
- `b = 0.75`: Length normalization
- `avgDocLength = 100`: Average document length

---

### 4. qdrant.service.js

**Chức năng**: Interface với Qdrant vector database.

**API Endpoints**:

```javascript
// 1. Create collection
POST /api/qdrant/createCollection
Body: {
  collectionName: "training_data",
  vectorSize: 1536
}

// 2. Initialize collections (tạo collection mặc định)
POST /api/qdrant/initialize-collections

// 3. Upsert points (insert/update vectors)
POST /api/qdrant/upsertPoints
Body: {
  collectionName: "training_data",
  points: [...]
}

// 4. Search (dense only)
POST /api/qdrant/searchPoints
Body: {
  collectionName: "training_data",
  vector: [...],
  limit: 10,
  filter: {...},      // optional
  scoreThreshold: 0.5 // optional
}

// 5. Hybrid search (dense + sparse)
POST /api/qdrant/searchHybrid
Body: {
  collectionName: "training_data",
  denseVector: [...],
  sparseVector: {indices: [...], values: [...]},
  query: "original query text",
  limit: 10
}

// 6. Delete points
POST /api/qdrant/deletePoints
Body: {
  collectionName: "training_data",
  pointIds: ["123", "456"]
}

// 7. Delete collection
DELETE /api/qdrant/collection/:collectionName

// 8. Get collection info
POST /api/qdrant/getCollectionInfo
Body: { collectionName: "training_data" }
```

**Key Methods**:

```javascript
fusionRRF(resultSets, limit, k = 60) {
  // Kết hợp multiple search results với RRF
  // score = Σ(1 / (k + rank))
  // Càng xuất hiện nhiều trong các results, score càng cao
}
```

**Collection Schema**:
```javascript
{
  vectors: {
    size: 1536,
    distance: 'Cosine'
  },
  sparse_vectors: {
    text: {}  // BM25 sparse vectors
  }
}
```

---

### 5. rerank.service.js

**Chức năng**: Sắp xếp lại search results sử dụng Cohere Rerank API.

**Why Rerank?**
- Vector search không hoàn hảo
- Rerank model đọc toàn bộ query + document → chính xác hơn
- Cohere rerank-multilingual-v3.0 support tiếng Việt

**API**:

```javascript
POST /api/rerank/rerankResults
Body: {
  query: "ATM nuốt thẻ",
  documents: [...],  // Results từ hybrid search
  topN: 5,           // Số results muốn giữ lại
  returnDocuments: true
}

Response: {
  results: [
    {
      index: 2,                  // Index trong documents gốc
      relevance_score: 0.95,     // Score từ Cohere (0-1)
      document: {...}            // Document data
    },
    ...
  ],
  fallback: false  // true nếu không có API key
}
```

**Configuration**:
```javascript
settings: {
  cohere: {
    apiKey: process.env.COHERE_API_KEY,
    model: 'rerank-multilingual-v3.0',
    apiUrl: 'https://api.cohere.ai/v1/rerank'
  },
  fallbackEnabled: true  // Nếu không có API key, trả về order gốc
}
```

**Cost**: ~$1.00 per 1K searches (Cohere Rerank)

---

### 6. rag.service.js

**Chức năng**: Orchestration layer - điều phối toàn bộ search flow.

**API**:

```javascript
POST /api/rag/search
Body: {
  query: "ATM nuốt thẻ",
  limit: 3,              // Số results cuối cùng
  scoreThreshold: 0.5,   // Min score (optional)
  useHybrid: true,       // Bật/tắt hybrid search
  useRerank: true        // Bật/tắt reranking
}

Response: [
  {
    id: "qdrant_id",
    score: 0.85,           // hoặc relevance_score nếu có rerank
    payload: {
      mongoId: "...",
      scenario: {...},
      persona: {...},
      data_label: {...}
    },
    reranked: true         // true nếu đã qua rerank
  },
  ...
]
```

**Configuration**:
```javascript
settings: {
  useHybridSearch: true,    // Mặc định bật hybrid
  useRerank: true,          // Mặc định bật rerank
  rerankTopN: 5            // Số results để rerank
}
```

**Query Enhancement**: Mở rộng query với từ đồng nghĩa
```javascript
"tư vấn" → "tư vấn hỗ trợ giải đáp"
"khiếu nại" → "khiếu nại phàn nàn không hài lòng"
"bán hàng" → "bán hàng chào hàng giới thiệu sản phẩm"
// ... ~18 patterns
```

---

## Cấu Hình (Configuration)

### Environment Variables

```bash
# OpenAI (required cho dense vectors)
OPENAI_API_KEY=sk-...

# Qdrant (required)
QDRANT_URL=http://4.144.174.22:6333
QDRANT_API_KEY=2125d3e4a4dea3cb297acda46c0e30c6673fdbcbf72a77fa9d15a2d987be9ef8

# Cohere (optional, nếu không có sẽ skip reranking)
COHERE_API_KEY=paAgeO2aVSrRm5pZVsGEEzCLqMKN6uUjaYRc5Zvz
```

### Service Settings

Có thể override trong code:

```javascript
// rag.service.js
settings: {
  useHybridSearch: true,   // Mặc định dùng hybrid
  useRerank: true,         // Mặc định dùng rerank
  rerankTopN: 5           // Top N để rerank
}

// embedding.service.js
settings: {
  model: 'text-embedding-3-small',  // hoặc text-embedding-3-large
  dimensions: 1536
}

// rerank.service.js
settings: {
  fallbackEnabled: true   // Cho phép hoạt động không có API key
}
```

---

## Sử Dụng (Usage)

### 1. Khởi Tạo Hệ Thống

```bash
# Bước 1: Tạo collection trong Qdrant
POST http://localhost:3000/api/qdrant/initialize-collections

# Bước 2: Upload training data
POST http://localhost:3000/api/trainingdata/submit
Content-Type: application/json

{
  "input": "Kịch bản: Khách hàng khiếu nại phí ATM...",
  "inputType": "text"
}

# Hoặc upload file
POST http://localhost:3000/api/trainingdata/upload-batch-file
Content-Type: multipart/form-data

# Bước 3: Index vào Qdrant
POST http://localhost:3000/api/trainingdata/index-batch
```

### 2. Search

**Search đơn giản (dense only)**:
```bash
POST http://localhost:3000/api/rag/search
{
  "query": "ATM nuốt thẻ",
  "limit": 3,
  "useHybrid": false,
  "useRerank": false
}
```

**Hybrid search (recommended)**:
```bash
POST http://localhost:3000/api/rag/search
{
  "query": "ATM nuốt thẻ",
  "limit": 3,
  "useHybrid": true,
  "useRerank": false
}
```

**Full pipeline (hybrid + rerank)**:
```bash
POST http://localhost:3000/api/rag/search
{
  "query": "ATM nuốt thẻ",
  "limit": 3,
  "useHybrid": true,
  "useRerank": true
}
```

### 3. Quản Lý Data

**Xem thông tin collection**:
```bash
POST http://localhost:3000/api/qdrant/getCollectionInfo
{
  "collectionName": "training_data"
}
```

**Re-index data**:
```bash
# Reset status
POST http://localhost:3000/api/trainingdata/reset-indexed

# Index lại
POST http://localhost:3000/api/trainingdata/index-batch
```

**Xóa collection và tạo lại**:
```bash
DELETE http://localhost:3000/api/qdrant/collection/training_data
POST http://localhost:3000/api/qdrant/initialize-collections
POST http://localhost:3000/api/trainingdata/reset-indexed
POST http://localhost:3000/api/trainingdata/index-batch
```

---

## Troubleshooting

### Vấn đề 1: Sparse search trả về empty

**Nguyên nhân**: Collection được tạo trước khi có sparse vectors.

**Giải pháp**:
```bash
# 1. Xóa collection cũ
DELETE http://localhost:3000/api/qdrant/collection/training_data

# 2. Tạo lại với sparse vectors
POST http://localhost:3000/api/qdrant/initialize-collections

# 3. Reset và index lại
POST http://localhost:3000/api/trainingdata/reset-indexed
POST http://localhost:3000/api/trainingdata/index-batch
```

### Vấn đề 2: Search không trả về kết quả mong muốn

**Debug steps**:

1. **Kiểm tra có data chưa**:
   ```bash
   POST /api/qdrant/getCollectionInfo
   Body: {"collectionName": "training_data"}
   
   # Check: points_count > 0
   ```

2. **Test dense search**:
   ```bash
   POST /api/rag/search
   Body: {
     "query": "...",
     "useHybrid": false,
     "useRerank": false
   }
   ```

3. **Test hybrid search**:
   ```bash
   POST /api/rag/search
   Body: {
     "query": "...",
     "useHybrid": true,
     "useRerank": false
   }
   
   # Check console logs: denseResults, sparseResults
   ```

4. **Test reranking**:
   ```bash
   POST /api/rag/search
   Body: {
     "query": "...",
     "useHybrid": true,
     "useRerank": true
   }
   ```

### Vấn đề 3: Reranking không hoạt động

**Nguyên nhân**: Không có Cohere API key hoặc key không hợp lệ.

**Giải pháp**:
1. Check `COHERE_API_KEY` trong env
2. Nếu không có key, rerank service sẽ fallback (trả về order gốc)
3. Response sẽ có `fallback: true`

### Vấn đề 4: OpenAI API rate limit

**Nguyên nhân**: Batch indexing quá nhanh.

**Giải pháp**:
```bash
POST /api/trainingdata/index-batch
Body: {
  "batchSize": 5  // Giảm từ 10 xuống 5
}
```

### Vấn đề 5: Qdrant connection error

**Kiểm tra**:
1. Qdrant server có chạy không: `curl http://4.144.174.22:6333`
2. API key đúng chưa
3. Network/firewall có block không

---

## Performance & Optimization

### Indexing Performance

**Single index**: ~2-3 seconds
- OpenAI embedding: ~1s
- Sparse vector: ~10ms
- Qdrant upsert: ~100ms

**Batch index** (10 items): ~15-20 seconds
- Parallel embedding calls
- Single Qdrant upsert

**Recommendations**:
- Batch size: 10 (optimal)
- Index off-peak hours cho large datasets
- Monitor OpenAI rate limits

### Search Performance

**Dense only**: ~200-300ms
- OpenAI embedding: ~150ms
- Qdrant search: ~50ms

**Hybrid search**: ~400-500ms
- Dense search: ~200ms
- Sparse search: ~100ms
- RRF fusion: ~5ms

**Hybrid + Rerank**: ~800-1000ms
- Hybrid: ~400ms
- Cohere rerank: ~400ms

**Recommendations**:
- Use hybrid for better accuracy
- Use rerank only for critical searches
- Cache frequent queries

---

## Best Practices

### 1. Indexing

✅ **DO**:
- Parse và validate data trước khi index
- Batch index cho large datasets
- Monitor indexed status trong MongoDB
- Re-index khi thay đổi vector generation logic

❌ **DON'T**:
- Index trùng lặp (check `indexed: true`)
- Index data không đầy đủ (missing scenario.name)
- Quên update MongoDB status sau index

### 2. Searching

✅ **DO**:
- Dùng hybrid search cho accuracy
- Dùng query enhancement cho tiếng Việt
- Set reasonable `limit` (3-10)
- Handle empty results gracefully

❌ **DON'T**:
- Query quá ngắn (< 3 words) → kém hiệu quả
- Set limit quá cao → slow
- Ignore scoreThreshold → irrelevant results

### 3. Maintenance

✅ **DO**:
- Backup Qdrant collection định kỳ
- Monitor vector counts
- Clean up orphaned vectors (không còn trong MongoDB)
- Update API keys securely

❌ **DON'T**:
- Hard-code API keys
- Skip validation
- Ignore error logs

---

## API Reference Summary

| Service | Endpoint | Method | Purpose |
|---------|----------|--------|---------|
| training-data | `/api/trainingdata/submit` | POST | Submit single scenario |
| training-data | `/api/trainingdata/upload-batch-file` | POST | Upload batch file |
| training-data | `/api/trainingdata/:id/index` | POST | Index single item |
| training-data | `/api/trainingdata/index-batch` | POST | Batch index |
| training-data | `/api/trainingdata/reset-indexed` | POST | Reset indexed status |
| embedding | `/api/embedding/createEmbedding` | POST | Create single embedding |
| embedding | `/api/embedding/createBatchEmbeddings` | POST | Batch embeddings |
| sparsevector | `/api/sparsevector/createSparseVector` | POST | Create sparse vector |
| qdrant | `/api/qdrant/initialize-collections` | POST | Initialize collections |
| qdrant | `/api/qdrant/createCollection` | POST | Create collection |
| qdrant | `/api/qdrant/upsertPoints` | POST | Upsert vectors |
| qdrant | `/api/qdrant/searchPoints` | POST | Dense search |
| qdrant | `/api/qdrant/searchHybrid` | POST | Hybrid search |
| qdrant | `/api/qdrant/deletePoints` | POST | Delete points |
| qdrant | `/api/qdrant/collection/:name` | DELETE | Delete collection |
| qdrant | `/api/qdrant/getCollectionInfo` | POST | Get collection info |
| rerank | `/api/rerank/rerankResults` | POST | Rerank results |
| rag | `/api/rag/search` | POST | Search (main endpoint) |

---

## Dependencies

```json
{
  "@qdrant/js-client-rest": "^1.x",
  "openai": "^4.x",
  "axios": "^1.x",
  "moleculer": "^0.14.x"
}
```

---

## Tổng Kết

Hệ thống RAG này cung cấp:
- ✅ **Hybrid Search**: Semantic + Keyword matching
- ✅ **Reranking**: Độ chính xác cao với Cohere
- ✅ **Scalable**: Qdrant vector database
- ✅ **Vietnamese Support**: Tokenization, bigrams/trigrams
- ✅ **Production Ready**: Error handling, fallbacks, monitoring

**Khi nào dùng gì?**:
- **Dense only**: Fast searches, không cần chính xác cao
- **Hybrid**: Recommended cho most cases
- **Hybrid + Rerank**: Critical searches, cần chính xác tối đa

**Limitations**:
- OpenAI rate limits: 3,000 RPM (tier 1)
- Qdrant storage: Depends on server capacity
- Cohere cost: $1/1K searches
