# Hướng dẫn tích hợp Moodle API

Tài liệu này hướng dẫn cách gọi API của Moodle để lấy danh sách khóa học và chi tiết nội dung khóa học (bao gồm tài liệu, video, bài tập).

## 1. Cấu hình xác thực

Mọi request đến Moodle API đều cần có **Token**.
- Endpoint cơ sở: `https://your-moodle-site.com/webservice/rest/server.php`
- Phương thức: `POST` (khuyên dùng) hoặc `GET`.
- Tham số bắt buộc trong mọi request:
    - `wstoken`: Token xác thực của bạn.
    - `moodlewsrestformat`: `json` (để nhận kết quả trả về dạng JSON).

## 2. API Lấy danh sách khóa học

Để lấy danh sách các khóa học hiện có.

- **Moodle WS Function**: `core_course_get_courses`

### Request mẫu (cURL)

```bash
curl -X POST "https://moodle.example.com/webservice/rest/server.php" \
     -d "wstoken=YOUR_TOKEN" \
     -d "wsfunction=core_course_get_courses" \
     -d "moodlewsrestformat=json"
```

### Kết quả mẫu (JSON)

```json
[
    {
        "id": 101,
        "shortname": "REACT101",
        "fullname": "Introduction to React",
        "summary": "Learn the basics of React."
    },
    {
        "id": 102,
        "shortname": "NODE202",
        "fullname": "Advanced Node.js",
        "summary": "Master backend development."
    }
]
[
    {
        "id": 101,
        "shortname": "REACT101",
        "fullname": "Introduction to React",
        "summary": "Learn the basics of React.",
        "overviewfiles": [
            {
                "fileurl": "https://moodle.example.com/webservice/pluginfile.php/...",
                "filename": "image.jpg"
            }
        ]
    }
]
```

## 3. Cách khác: Sử dụng `core_course_get_enrolled_courses_by_timeline_classification`

Hàm này được khuyên dùng vì trả về trường `courseimage` trực tiếp, rất tiện lợi cho việc hiển thị (như ví dụ Json bạn cung cấp).

- **Moodle WS Function**: `core_course_get_enrolled_courses_by_timeline_classification`
- **Tham số**: `classification` (ví dụ: 'all')
- **Yêu cầu Quyền**: Bạn phải thêm function này vào **External Service** đang sử dụng Token trong Moodle (Site administration > Server > External services > Functions). Nếu thiếu, API sẽ trả về lỗi `accessexception`.

### Request mẫu (cURL)

```bash
curl -X POST "https://moodle.example.com/webservice/rest/server.php" \
     -d "wstoken=YOUR_TOKEN" \
     -d "wsfunction=core_course_get_enrolled_courses_by_timeline_classification" \
     -d "moodlewsrestformat=json" \
     -d "classification=all"
```

### Kết quả mẫu (Json)

```json
{
  "courses": [
    {
      "id": 2,
      "fullname": "Hướng dẫn sử dụng Team",
      "shortname": "Hướ... Team",
      "courseimage": "https://lms.thinklabs.com.vn/pluginfile.php/14/course/overviewfiles/demo.png",
      "viewurl": "https://lms.thinklabs.com.vn/course/view.php?id=2"
    }
  ],
  "nextoffset": 1
}
```

### Lấy chi tiết một khóa học theo ID

Để lấy thông tin chi tiết của một khóa học cụ thể (bao gồm `overviewfiles` cho ảnh):

- **Moodle WS Function**: `core_course_get_courses_by_field`
- **Tham số**:
    - `field`: 'id' (tìm theo ID)
    - `value`: ID của khóa học

#### Request mẫu

```bash
curl -X POST "https://moodle.example.com/webservice/rest/server.php" \
     -d "wstoken=YOUR_TOKEN" \
     -d "wsfunction=core_course_get_courses_by_field" \
     -d "moodlewsrestformat=json" \
     -d "field=id" \
     -d "value=101"
```

#### Kết quả mẫu

```json
{
  "courses": [
    {
      "id": 101,
      "fullname": "Introduction to React",
      "shortname": "REACT101",
      "summary": "<p>Learn the basics of React.</p>",
      "overviewfiles": [
        {
          "fileurl": "https://moodle.example.com/webservice/pluginfile.php/.../image.jpg",
          "filename": "image.jpg"
        }
      ]
    }
  ]
}
```

## 4. API Lấy chi tiết khóa học & Tài liệu

Để lấy cấu trúc nội dung của một khóa học cụ thể, bao gồm các section (chủ đề) và modules nam bên trong (video, file, bài tập, label...).

- **Moodle WS Function**: `core_course_get_contents`
- **Tham số**:
    - `courseid`: ID của khóa học.

### Request mẫu (cURL)

```bash
curl -X POST "https://moodle.example.com/webservice/rest/server.php" \
     -d "wstoken=YOUR_TOKEN" \
     -d "wsfunction=core_course_get_contents" \
     -d "moodlewsrestformat=json" \
     -d "courseid=101"
```

### Kết quả mẫu (JSON)

Kết quả trả về là danh sách các **Section**, mỗi Section chứa danh sách các **Modules**.

```json
[
    {
        "id": 1,
        "name": "Topic 1: Basics",
        "modules": [
            {
                "id": 11,
                "name": "Welcome",
                "modname": "label",
                "description": "<p>Welcome to the course!</p>"
            },
            {
                "id": 22,
                "name": "React Video Tutorial",
                "modname": "url",
                "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            },
            {
                "id": 23,
                "name": "Course Slides",
                "modname": "resource",
                "url": "https://moodle.example.com/...",
                "contents": [
                    {
                        "fileurl": "https://moodle.example.com/webservice/pluginfile.php/...",
                        "filename": "slides.pdf"
                    }
                ]
            }
        ]
    }
]
```

### Cách xử lý dữ liệu (Mapping)

Dựa vào trường `modname` trong danh sách `modules` để hiển thị UI phù hợp:

| modname | Loại nội dung | Xử lý hiển thị |
| :--- | :--- | :--- |
| `url` | Video Link / Link ngoài | Hiển thị nút "Watch Video". URL nằm trong trường `url`. |
| `resource` | Tài liệu tải xuống | Hiển thị nút "Download". Link tải nằm trong `url` hoặc `contents[0].fileurl`. **Lưu ý**: `fileurl` cần kèm theo `token` khi tải (`?token=...`). |
| `label` | Văn bản / Media | Hiển thị trực tiếp nội dung HTML trong trường `description`. |
| `assign` | Bài tập | Hiển thị thông tin bài tập, ID để nộp bài. |
| `page` | Trang nội dung | Hiển thị link mở trang hoặc render nội dung. |

## 4. Cách lấy Link Khóa học trên Moodle

Moodle không luôn trả về đường dẫn trực tiếp (permalink) đến trang chi tiết khóa học trong response API. Tuy nhiên, bạn có thể tự tạo đường dẫn này theo quy tắc chuẩn của Moodle.

### Quy tắc tạo Link

Đường dẫn chuẩn đến một khóa học Moodle có dạng:

```
{MOODLE_BASE_URL}/course/view.php?id={COURSE_ID}
```

- **MOODLE_BASE_URL**: Địa chỉ trang Moodle của bạn (ví dụ: `https://moodle.example.com`).
- **COURSE_ID**: ID của khóa học lấy từ API `core_course_get_courses`.

### Ví dụ Code (Javascript/Typescript)

```typescript
const moodleBaseUrl = "https://moodle.example.com";
const courseId = 101;

const courseLink = `${moodleBaseUrl}/course/view.php?id=${courseId}`;
// Kết quả: https://moodle.example.com/course/view.php?id=101
```

Bạn có thể sử dụng đường dẫn này để gắn vào nút "Go to Course" hoặc chia sẻ link cho học viên.
