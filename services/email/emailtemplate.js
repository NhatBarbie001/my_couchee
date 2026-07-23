const i18next = require('i18next');

const COURSE_REMINDER_TEMPLATE = `
  <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6;">
    <p>Xin chào <strong>{fullName}</strong>,</p>
    
    <p>Nhắc bạn về khóa học <strong>{courseName}</strong> mà bạn đang tham gia.</p>
    
    {courseDescription}
    
    <p>Hãy dành thời gian thực hành để đạt kết quả tốt nhất.</p>
    
    <p style="text-align:center;margin:24px 0;">
      <a href="{courseUrl}" style="display:inline-block;padding:12px 24px;background:#00199F;color:#fff;text-decoration:none;border-radius:4px;">Thực hành ngay</a>
    </p>

    <p>Nếu bạn gặp khó khăn trong quá trình học, vui lòng liên hệ quản trị viên hoặc bộ phận đào tạo để được hỗ trợ.</p>
    
    <p>Trân trọng,<br><strong>{appName}</strong></p>
  </div>`;

const COURSE_NOTI_NEW_TEMPLATE = `
  <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6;">
    <p>Xin chào <strong>{fullName}</strong>,</p>
    
    <p>Bạn vừa được gán tham gia một khóa học mới trên hệ thống <strong>Clickee Virtual Coach</strong> là: <strong>{courseName}</strong></p>
    
    {courseDescription}
    
    <p>Hãy dành thời gian thực hành để đạt kết quả tốt nhất nhé.</p>
    
    <p style="text-align:center;margin:24px 0;">
      <a href="{courseUrl}" style="display:inline-block;padding:12px 24px;background:#00199F;color:#fff;text-decoration:none;border-radius:4px;">Thực hành ngay</a>
    </p>

    <p>Nếu bạn gặp khó khăn trong quá trình học, vui lòng liên hệ quản trị viên hoặc bộ phận đào tạo để được hỗ trợ.</p>
    
    <p>Trân trọng,<br><strong>{appName}</strong></p>
  </div>`;

const COURSE_WARNING_OVERDUE_TEMPLATE = `
  <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6;">
    <p>Xin chào <strong>{fullName}</strong>,</p>
    
    <p>Hệ thống ghi nhận bạn chưa hoàn thành khóa học bắt buộc sau: </p>
    
    <p><strong>{courseName}</strong></p>
    
    {courseDescription}
    
    <p>Hiện tại khóa học đã quá hạn. Vui lòng truy cập hệ thống và hoàn thành các nội dung còn lại sớm nhất để đảm bảo tiến độ đào tạo.</p>
    
    <p style="text-align:center;margin:24px 0;">
      <a href="{courseUrl}" style="display:inline-block;padding:12px 24px;background:#00199F;color:#fff;text-decoration:none;border-radius:4px;">Thực hành ngay</a>
    </p>

    <p>Nếu bạn gặp khó khăn trong quá trình học, vui lòng liên hệ quản trị viên hoặc bộ phận đào tạo để được hỗ trợ.</p>
    
    <p>Trân trọng,<br><strong>{appName}</strong></p>
  </div>`;

function replacement(template, replacements) {
  return template.replace(
    /{(\w+)}/g,
    (placeholderWithDelimiters, placeholderWithoutDelimiters) =>
      replacements.hasOwnProperty(placeholderWithoutDelimiters)
        ? replacements[placeholderWithoutDelimiters]
        : placeholderWithDelimiters
  );
}

exports.createCourseReminderEmail = (params) => {
  const { fullName, courseName, courseDescription, courseUrl, lang } = params;

  i18next.changeLanguage(lang || 'vi');

  const descriptionBlock = courseDescription
    ? `<p style="padding:12px;background:#f5f5f5;border-radius:4px;">${courseDescription}</p>`
    : '';

  const replacements = {
    fullName,
    courseName,
    courseDescription: descriptionBlock,
    courseUrl,
    appName: i18next.t('app_name'),
  };

  return replacement(COURSE_REMINDER_TEMPLATE, replacements);
};

exports.createCourseEmailPublicToStudents = (params) => {
  const { fullName, courseName, courseDescription, courseUrl, lang } = params;

  i18next.changeLanguage(lang || 'vi');

  const descriptionBlock = courseDescription
    ? `<p style="padding:12px;background:#f5f5f5;border-radius:4px;">${courseDescription}</p>`
    : '';

  const replacements = {
    fullName,
    courseName,
    courseDescription: descriptionBlock,
    courseUrl,
    appName: i18next.t('app_name'),
  };

  return replacement(COURSE_NOTI_NEW_TEMPLATE, replacements);
}

exports.createCourseEmailWarningOverdue = (params) => {
  const { fullName, courseName, courseDescription, courseUrl, lang } = params;

  i18next.changeLanguage(lang || 'vi');

  const descriptionBlock = courseDescription
    ? `<p style="padding:12px;background:#f5f5f5;border-radius:4px;">${courseDescription}</p>`
    : '';

  const replacements = {
    fullName,
    courseName,
    courseDescription: descriptionBlock,
    courseUrl,
    appName: i18next.t('app_name'),
  };

  return replacement(COURSE_WARNING_OVERDUE_TEMPLATE, replacements);
}
