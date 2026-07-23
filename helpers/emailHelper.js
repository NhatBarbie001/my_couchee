const i18next = require("i18next");

exports.generateChangePasswordEmail = (fullName, url) => {
  return `<table border="0" cellspacing="0" cellpadding="0" style="max-width:600px">
  <tbody>
  <tr>
    <td>
      <table bgcolor="#00199F" width="100%" border="0" cellspacing="0" cellpadding="0" style="min-width:332px;max-width:600px;border:1px solid #e0e0e0;border-bottom:0;border-top-left-radius:3px;border-top-right-radius:3px">
        <tbody>
        <tr>
          <td height="72px" colspan="3"></td>
        </tr>
        <tr>
          <td width="32px"></td>
          <td style="font-family:Roboto-Regular,Helvetica,Arial,sans-serif;font-size:24px;color:#ffffff;line-height:1.25">
            <span class="il">${ i18next.t("user_password_change") }</span>
          </td>
          <td width="32px"></td>
        </tr>
        <tr>
          <td height="18px" colspan="3"></td>
        </tr>
        </tbody>
      </table>
    </td>
  </tr>
  <tr>
    <td>
      <table bgcolor="#FAFAFA" width="100%" border="0" cellspacing="0" cellpadding="0" style="min-width:332px;max-width:600px;border:1px solid #f0f0f0;border-bottom:1px solid #c0c0c0;border-top:0;border-bottom-left-radius:3px;border-bottom-right-radius:3px;font-family: Roboto-Regular,Helvetica,Arial,sans-serif;">
        <tbody>
        <tr height="16px">
          <td width="32px" rowspan="3"></td>
          <td></td>
          <td width="32px" rowspan="3"></td>
        </tr>
        <tr>
          <td>
            <table style="min-width:300px" border="0" cellspacing="0" cellpadding="0">
              <tbody>
              <tr>
                <td style="font-family:Roboto-Regular,Helvetica,Arial,sans-serif;font-size:13px;color:#202020;line-height:1.5">
                  ${ i18next.t("hello") } ${ fullName }
                </td>
              </tr>
              <tr>
                <td style="font-size:13px;color:#202020;line-height:1.5">
                  <span class="il">${ i18next.t("user_email_password_of") }</span><b>${ i18next.t("app_name") }</b> ${ i18next.t("user_email_password_has_changed") }
                  <br><br>
                  <div>${ i18next.t("email_user_create_html6") } <a href="${ url }">Link</a></div>
                  <br>
                </td>
              </tr>
              <tr height="32px"></tr>
              <tr>
                <td style="font-size:13px;color:#202020;line-height:1.5">
                  ${ i18next.t("user_email_regard") },<br>${ i18next.t("app_name") }
                </td>
              </tr>
              </tbody>
            </table>
          </td>
        </tr>
        <tr height="32px"></tr>
        </tbody>
      </table>
    </td>
  </tr>
  </tbody>
</table>`;
};

const nodemailer = require('nodemailer');
const { getConfig } = require('../config/config');
const config = getConfig(process.env.NODE_ENV);

exports.sendEmail = (mailOptions) => {
  try {
    let transporter = nodemailer.createTransport(config.mail);
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log("error===================", error);
        // callback(error);
      } else {
        // callback(undefined, info);
      }
    });
  } catch (e) {
    console.log("aaaaaaaaaaaaaaaaa===================", e);
    console.log(e);
  }
};
