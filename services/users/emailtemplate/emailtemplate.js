const {getConfig} = require('../../../config/config');
const config = getConfig(process.env.NODE_ENV);

const REGISTER_TEMPLATE = `<!DOCTYPE html>
<html lang="vi">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chào mừng đến với Clickee Virtual Coach</title>
</head>

<body style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #333;">
    <p>Kính gửi {userFullname},</p>

    <p>
        Chào mừng Anh/Chị đến với <strong>Clickee Virtual Coach</strong>!
    </p>

    <p>
        Tài khoản của Anh/Chị đã được tạo thành công trên hệ thống. 
        Clickee Virtual Coach là nền tảng đào tạo mô phỏng con người bằng công nghệ trí tuệ nhân tạo, 
        giúp nâng cao kỹ năng thông qua các tình huống thực tế và tương tác trực tiếp.
    </p>

    <h2>Thông Tin Đăng Nhập</h2>
    <ul>
        <li><strong>Tên đăng nhập:</strong> {account}</li>
        <li><strong>Mật khẩu:</strong> {password}</li>
        <li><strong>Link truy cập hệ thống:</strong> 
            <a href="{activateLink}">{activateLink}</a>
        </li>
    </ul>

    <p style="color: #d9534f;">
        Vì lý do bảo mật, vui lòng đăng nhập và thay đổi mật khẩu ngay trong lần truy cập đầu tiên.
    </p>

    <h2>Bạn có thể bắt đầu với:</h2>
    <ul>
        <li>Tham gia các khóa đào tạo mô phỏng thực tế</li>
        <li>Tương tác với huấn luyện viên ảo</li>
        <li>Theo dõi tiến trình và kết quả học tập</li>
        <li>Nhận phản hồi cá nhân hóa</li>
    </ul>

    <h2>Hỗ Trợ</h2>
    <p>
        Nếu cần hỗ trợ, vui lòng liên hệ đội ngũ hỗ trợ qua email: 
        <a href="mailto:{supportEmail}">{supportEmail}</a>.
    </p>

    <p>
        Chúc Anh/Chị có những trải nghiệm học tập hiệu quả và thành công cùng 
        <strong>Clickee Virtual Coach</strong>.
    </p>

    <p>
        Trân trọng,<br>
        Clickee Virtual Coach
    </p>
</body>

</html>
`;

const INVITATION_TEMPLATE = `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chào Mừng đến với Clickee!</title>
</head>

<body>
    <p>Kính gửi {userFullname},</p>

    <p>Bạn được gửi lời mời tham gia tổ chức: {organizationName}</p>


    <p>Bấm <a href="{confirmInvitationLink}"> để tham gia tổ chức</a>.</p>
    <p>Bấm <a href="{rejectInvitationLink}"> để từ chối</a>.</p>


    <h2>Hỗ Trợ và Liên Hệ:</h2>
    <p>Nếu bạn cần bất kỳ sự hỗ trợ hoặc có bất kỳ câu hỏi nào, đừng ngần ngại liên hệ với đội ngũ hỗ trợ của chúng tôi tại <a href="mailto:{supportEmail}">{supportEmail}</a>.</p>

    <p>Chân thành cảm ơn vì đã lựa chọn Clickee. Chúng tôi tin rằng bạn sẽ có những trải nghiệm tuyệt vời khi sử dụng dịch vụ của chúng tôi!</p>

    <p>Trân trọng,<br>
        Clickee Team
    </p>
</body>

</html>
`;

const INVITATION_NEW_USER = `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chào Mừng đến với Clickee!</title>
</head>

<body>
    <p>Kính gửi </p>

    <p>Chúng tôi rất vui thông báo rằng tài khoản {account} của bạn vừa được mời tham gia sử dụng phần mềm Clickee! Chào mừng bạn đến với trải nghiệm giáo dục Tiếng Anh độc đáo của chúng tôi.</p>

    <h2>Thông Tin Tài Khoản:</h2>
    <ul>
        <li><strong>Tên Tài Khoản:</strong> {account}</li>
        <li><strong>Tên Tổ Chức :</strong> {organizationName}</li>
    </ul>

    <h2>Tại Sao Chọn Clickee?</h2>
    <p>Clickee không chỉ là một công cụ đơn thuần, mà là đối tác đắc lực của giáo viên và học viên trong việc vượt qua những thách thức trong giáo dục Tiếng Anh. Với những công nghệ tiên tiến và khả năng cá nhân hóa mạnh mẽ, Clickee hứa hẹn mang lại cho bạn trải nghiệm học tập phong phú và hiệu quả.</p>
    <h2>Bắt Đầu Sử Dụng:</h2>
    <ol>
        <li>Truy cập <a href="{activateLink}">Đường Link Kích hoạt</a>.</li>
        <li>Nhập thông tin cá nhân với đường Link kích hoạt trên.</li>
        <li>Khám phá và trải nghiệm tất cả những gì Clickee có thể mang lại!</li>
    </ol>

    <h2>Hỗ Trợ và Liên Hệ:</h2>
    <p>Nếu bạn cần bất kỳ sự hỗ trợ hoặc có bất kỳ câu hỏi nào, đừng ngần ngại liên hệ với đội ngũ hỗ trợ của chúng tôi tại <a href="mailto:{supportEmail}">{supportEmail}</a>.</p>

    <p>Chân thành cảm ơn vì đã lựa chọn Clickee. Chúng tôi tin rằng bạn sẽ có những trải nghiệm tuyệt vời khi sử dụng dịch vụ của chúng tôi!</p>

    <p>Trân trọng,<br>
        Clickee Team
    </p>
</body>

</html>
`;

const WAIT_LIST_NEW_USER = `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chào Mừng đến với Clickee!</title>
</head>

<body>
    <p>Kính gửi </p>
    <p>Chúng tôi rất vui thông báo rằng tài khoản {account} của bạn đã được đưa vào danh sách chờ tham gia sử dụng phần mềm Clickee!</p>
    <p>Chân thành cảm ơn vì đã lựa chọn Clickee. Chúng tôi tin rằng bạn sẽ có những trải nghiệm tuyệt vời khi sử dụng dịch vụ của chúng tôi!</p>
    <p>Trân trọng,<br>
        Clickee Team
    </p>
</body>

</html>
`;

const ACTIVE_ACCOUNT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chào Mừng đến với Clickee!</title>
</head>

<body>
    <p>Kính gửi {userFullname},</p>

    <p>Cảm ơn bạn đã đăng ký tài khoản Clickee. Vui lòng nhấp vào đường dẫn sau để kích hoạt tài khoản của bạn: <a href="{activateLink}">Đường Link Kích hoạt</a>.</p>

    <h2>Hỗ Trợ và Liên Hệ:</h2>
    <p>Nếu bạn cần bất kỳ sự hỗ trợ hoặc có bất kỳ câu hỏi nào, đừng ngần ngại liên hệ với đội ngũ hỗ trợ của chúng tôi tại <a href="mailto:{supportEmail}">{supportEmail}</a>.</p>

    <p>Chân thành cảm ơn vì đã lựa chọn Clickee. Chúng tôi tin rằng bạn sẽ có những trải nghiệm tuyệt vời khi sử dụng dịch vụ của chúng tôi!</p>

    <p>Trân trọng,<br>
        Clickee Team
    </p>
</body>

</html>
`;

function replacement(template, replacements) {
  return template.replace(/{(\w+)}/g, (placeholderWithDelimiters, placeholderWithoutDelimiters) =>
    replacements.hasOwnProperty(placeholderWithoutDelimiters)
      ? replacements[placeholderWithoutDelimiters]
      : placeholderWithDelimiters,
  );
}

exports.createRegisterEmail = (userInfo, activateLink) => {
  const replacements = {
    activateLink: activateLink,
    supportEmail: config.supportEmail,
    account: userInfo.account,
    userFullname: userInfo.fullName,
    password: userInfo.password,
  };
  return replacement(REGISTER_TEMPLATE, replacements);
};

exports.createInvitationEmail = (userInfo, organizationName, confirmInvitationLink, rejectInvitationLink) => {
  const replacements = {
    confirmInvitationLink: confirmInvitationLink,
    rejectnIvitationLink: rejectInvitationLink,
    supportEmail: config.supportEmail,
    userFullname: userInfo.fullName,
    organizationName,
  };
  return replacement(INVITATION_TEMPLATE, replacements);
};

exports.createInvitationNewUser = (userInfo, organizationName, activateLink) => {
  const replacements = {
    activateLink: activateLink,
    supportEmail: config.supportEmail,
    account: userInfo.account,
    organizationName,
  };
  return replacement(INVITATION_NEW_USER, replacements);
};

exports.createWaitListNewUser = userInfo => {
  const replacements = {
    supportEmail: config.supportEmail,
    account: userInfo.account,
  };
  return replacement(WAIT_LIST_NEW_USER, replacements);
};

exports.createActiveAccountEmail = (userInfo, activateLink) => {
  const replacements = {
    activateLink: activateLink,
    supportEmail: config.supportEmail,
    userFullname: userInfo.fullName,
  };
  return replacement(ACTIVE_ACCOUNT_TEMPLATE, replacements);
};
