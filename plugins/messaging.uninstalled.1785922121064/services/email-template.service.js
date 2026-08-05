import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
import { sendEmail } from "./email-sender.service.js";
import { messagingLogService } from "./messaging-log.service.js";
function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
function transformRow(row) {
  const transformed = {};
  for (const key of Object.keys(row)) {
    transformed[snakeToCamel(key)] = row[key];
  }
  return transformed;
}
class EmailTemplateService {
  async getAll(userId) {
    const result = await db.execute(sql`
      SELECT * FROM user_email_templates WHERE user_id = ${userId} ORDER BY created_at DESC
    `);
    return result.rows.map((row) => transformRow(row));
  }
  async getById(userId, id) {
    const result = await db.execute(sql`
      SELECT * FROM user_email_templates WHERE id = ${id} AND user_id = ${userId} LIMIT 1
    `);
    const row = result.rows[0];
    return row ? transformRow(row) : null;
  }
  async getByName(userId, name) {
    const result = await db.execute(sql`
      SELECT * FROM user_email_templates WHERE name = ${name} AND user_id = ${userId} AND is_active = true LIMIT 1
    `);
    const row = result.rows[0];
    return row ? transformRow(row) : null;
  }
  async create(userId, data) {
    const variables = data.variables || [];
    const pgArray = `{${variables.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",")}}`;
    const designJson = data.designJson ? JSON.stringify(data.designJson) : null;
    const result = await db.execute(sql`
      INSERT INTO user_email_templates (user_id, name, subject, html_body, variables, design_json)
      VALUES (${userId}, ${data.name}, ${data.subject}, ${data.htmlBody}, ${pgArray}::text[], ${designJson}::jsonb)
      RETURNING *
    `);
    return transformRow(result.rows[0]);
  }
  async update(userId, id, data) {
    const existing = await this.getById(userId, id);
    if (!existing) return null;
    const name = data.name ?? existing.name;
    const subject = data.subject ?? existing.subject;
    const htmlBody = data.htmlBody ?? existing.htmlBody;
    const isActive = data.isActive ?? existing.isActive;
    const variables = data.variables ?? existing.variables ?? [];
    const pgArray = `{${variables.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",")}}`;
    const designJson = data.designJson !== void 0 ? data.designJson ? JSON.stringify(data.designJson) : null : existing.designJson ? JSON.stringify(existing.designJson) : null;
    const result = await db.execute(sql`
      UPDATE user_email_templates
      SET name = ${name}, subject = ${subject}, html_body = ${htmlBody}, is_active = ${isActive},
          variables = ${pgArray}::text[],
          design_json = ${designJson}::jsonb,
          updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `);
    const row = result.rows[0];
    return row ? transformRow(row) : null;
  }
  async delete(userId, id) {
    const result = await db.execute(sql`
      DELETE FROM user_email_templates WHERE id = ${id} AND user_id = ${userId}
    `);
    return result.rowCount > 0;
  }
  wrapAgentEmailTemplate(content) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>{{company_name}}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background-color: #f3f4f6;
      margin: 0;
      padding: 0;
    }
    .email-wrapper {
      max-width: 600px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .email-container {
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
      overflow: hidden;
    }
    .email-header {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      padding: 32px;
      text-align: center;
    }
    .email-logo {
      font-size: 28px;
      font-weight: 700;
      color: #ffffff;
      margin: 0;
      letter-spacing: -0.5px;
    }
    .email-tagline {
      color: #94a3b8;
      font-size: 14px;
      margin: 8px 0 0 0;
    }
    .email-body {
      padding: 40px 32px;
    }
    .email-title {
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
      margin: 0 0 16px 0;
    }
    .email-text {
      font-size: 16px;
      color: #4b5563;
      margin: 0 0 24px 0;
    }
    .email-highlight-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 24px;
      margin: 24px 0;
    }
    .email-table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
    }
    .email-table td {
      padding: 12px 0;
      border-bottom: 1px solid #e5e7eb;
      font-size: 15px;
    }
    .email-table td:first-child {
      color: #6b7280;
    }
    .email-table td:last-child {
      text-align: right;
      font-weight: 500;
      color: #1f2937;
    }
    .email-table tr:last-child td {
      border-bottom: none;
      font-weight: 600;
    }
    .email-alert {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 16px;
      margin: 24px 0;
      border-radius: 0 8px 8px 0;
    }
    .email-alert-success {
      background: #dcfce7;
      border-left-color: #22c55e;
    }
    .email-alert-info {
      background: #dbeafe;
      border-left-color: #3b82f6;
    }
    .email-footer {
      background: #f8fafc;
      padding: 24px 32px;
      text-align: center;
      border-top: 1px solid #e5e7eb;
    }
    .email-footer-text {
      font-size: 13px;
      color: #9ca3af;
      margin: 0 0 12px 0;
    }
    @media only screen and (max-width: 600px) {
      .email-wrapper {
        padding: 20px 12px;
      }
      .email-body {
        padding: 28px 20px;
      }
      .email-header {
        padding: 24px 20px;
      }
      .email-title {
        font-size: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="email-container">
      <div class="email-header">
        <h1 class="email-logo">{{company_name}}</h1>
      </div>
      ${content}
      <div class="email-footer">
        <p class="email-footer-text">
          &copy; {{company_name}}. All rights reserved.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
  }
  buildUnlayerRow(rowN, colN, contents, bgColor = "#ffffff", rowPadding = "0px") {
    return {
      id: `u_row_${rowN}`,
      cells: [1],
      columns: [
        {
          id: `u_column_${colN}`,
          contents: contents.map((c) => ({
            id: `u_content_text_${c.n}`,
            type: "text",
            values: {
              containerPadding: c.padding || "16px 40px",
              anchor: "",
              fontSize: "14px",
              textAlign: "left",
              lineHeight: "140%",
              linkStyle: { body: true, inherit: true },
              hideDesktop: false,
              displayCondition: null,
              selectable: true,
              draggable: true,
              duplicatable: true,
              deletable: true,
              hideable: true,
              text: c.html,
              _meta: { htmlID: `u_content_text_${c.n}`, htmlClassNames: "u_content_text" },
              effectEnabled: false,
              color: "#000000"
            }
          })),
          values: {
            _meta: { htmlID: `u_column_${colN}`, htmlClassNames: "u_column" },
            border: {},
            padding: "0px",
            backgroundColor: ""
          }
        }
      ],
      values: {
        displayCondition: null,
        columns: false,
        backgroundColor: bgColor,
        columnsBackgroundColor: "",
        backgroundImage: { url: "", fullWidth: true, repeat: "no-repeat", size: "custom", position: "center" },
        padding: rowPadding,
        anchor: "",
        hideDesktop: false,
        _meta: { htmlID: `u_row_${rowN}`, htmlClassNames: "u_row" },
        selectable: true,
        draggable: true,
        duplicatable: true,
        deletable: true,
        hideable: true
      }
    };
  }
  buildUnlayerDesign(rows, totalTexts) {
    return {
      counters: {
        u_column: rows.length,
        u_row: rows.length,
        u_content_text: totalTexts,
        u_content_image: 0,
        u_content_button: 0,
        u_content_divider: 0,
        u_content_social: 0,
        u_content_html: 0
      },
      body: {
        id: "u_body",
        rows,
        headers: [],
        footers: [],
        values: {
          popupPosition: "center",
          popupWidth: "600px",
          popupHeight: "auto",
          borderRadius: "10px",
          contentAlign: "center",
          contentVerticalAlign: "center",
          contentWidth: 600,
          fontFamily: { label: "Arial", value: "arial,helvetica,sans-serif" },
          textColor: "#000000",
          popupBackgroundColor: "#FFFFFF",
          popupBackgroundImage: { url: "", fullWidth: true, repeat: "no-repeat", size: "cover", position: "center" },
          popupOverlay_backgroundColor: "rgba(0,0,0,0.1)",
          popupCloseButton_position: "top-right",
          popupCloseButton_backgroundColor: "#DDDDDD",
          popupCloseButton_iconColor: "#000000",
          popupCloseButton_borderRadius: "0px",
          popupCloseButton_margin: "0px",
          popupCloseButton_action: { name: "close_popup", attrs: { onClick: "document.querySelector('.u-popup-container').style.display='none';" } },
          backgroundColor: "#f3f4f6",
          preheaderText: "",
          linkStyle: { body: true, linkColor: "#2563eb", linkHoverColor: "#1d4ed8", linkUnderline: true, linkHoverUnderline: true, inherit: false },
          backgroundImage: { url: "", fullWidth: true, repeat: "no-repeat", size: "custom", position: "center" },
          _meta: { htmlID: "u_body", htmlClassNames: "u_body" },
          selectable: false,
          draggable: false,
          duplicatable: false,
          deletable: false,
          hideable: false
        }
      }
    };
  }
  getDefaultDesigns() {
    const HEADER_BG = "#1e293b";
    const BODY_BG = "#ffffff";
    const HIGHLIGHT_BG = "#f8fafc";
    const FOOTER_BG = "#f1f5f9";
    const headerHtml = (title) => `<div style="text-align:center;padding:8px 0;"><h1 style="margin:0 0 4px 0;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">{{company_name}}</h1><p style="margin:0;font-size:13px;color:#94a3b8;">${title}</p></div>`;
    const footerHtml = () => `<p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">&copy; {{company_name}}. All rights reserved.</p>`;
    const detailsTableHtml = (rows) => {
      const trs = rows.map(
        ([label, value]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;width:40%;">${label}</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:500;color:#1f2937;font-size:14px;">${value}</td></tr>`
      ).join("");
      return `<table style="width:100%;border-collapse:collapse;">${trs}</table>`;
    };
    const highlightBox = (content) => `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px 24px;">${content}</div>`;
    const alertBox = (content, color = "#f59e0b", bg = "#fef3c7") => `<div style="background:${bg};border-radius:6px;padding:14px 18px;"><span style="font-size:14px;color:#1f2937;">${content}</span></div>`;
    const p = (text, style = "") => `<p style="margin:0;font-size:15px;line-height:1.6;color:#374151;${style}">${text}</p>`;
    const h2 = (text) => `<h2 style="margin:0 0 12px 0;font-size:22px;font-weight:600;color:#1e293b;">${text}</h2>`;
    const gap = () => `<div style="height:16px;"></div>`;
    return {
      "Appointment Confirmation": (() => {
        const rows = [
          this.buildUnlayerRow(1, 1, [{ n: 1, html: headerHtml("Appointment Confirmed"), padding: "28px 40px" }], HEADER_BG),
          this.buildUnlayerRow(2, 2, [{
            n: 2,
            html: h2("Appointment Confirmed") + gap() + p("Hi {{contact_name}},") + gap() + p("Your appointment has been successfully booked. Here are the details:"),
            padding: "32px 40px 20px"
          }], BODY_BG),
          this.buildUnlayerRow(3, 3, [{
            n: 3,
            html: highlightBox(detailsTableHtml([
              ["Date", "{{appointment_date}}"],
              ["Time", "{{appointment_time}}"],
              ["Service", "{{service_name}}"],
              ["Duration", "{{duration}} minutes"]
            ])),
            padding: "0px 40px 20px"
          }], BODY_BG),
          this.buildUnlayerRow(4, 4, [{
            n: 4,
            html: alertBox("<strong>You're all set!</strong> We look forward to seeing you.", "#22c55e", "#dcfce7") + gap() + p("{{notes}}") + gap() + p("If you need to reschedule or cancel, please contact us.", "font-size:13px;color:#6b7280;"),
            padding: "0px 40px 32px"
          }], BODY_BG),
          this.buildUnlayerRow(5, 5, [{ n: 5, html: footerHtml(), padding: "20px 40px" }], FOOTER_BG)
        ];
        return this.buildUnlayerDesign(rows, 5);
      })(),
      "Appointment Reminder": (() => {
        const rows = [
          this.buildUnlayerRow(1, 1, [{ n: 1, html: headerHtml("Appointment Reminder"), padding: "28px 40px" }], HEADER_BG),
          this.buildUnlayerRow(2, 2, [{
            n: 2,
            html: h2("Appointment Reminder") + gap() + p("Hi {{contact_name}},") + gap() + p("This is a friendly reminder about your upcoming appointment:"),
            padding: "32px 40px 20px"
          }], BODY_BG),
          this.buildUnlayerRow(3, 3, [{
            n: 3,
            html: highlightBox(detailsTableHtml([
              ["Date", "{{appointment_date}}"],
              ["Time", "{{appointment_time}}"],
              ["Service", "{{service_name}}"],
              ["Duration", "{{duration}} minutes"]
            ])),
            padding: "0px 40px 20px"
          }], BODY_BG),
          this.buildUnlayerRow(4, 4, [{
            n: 4,
            html: alertBox("<strong>Please arrive on time.</strong> If you need to reschedule, contact us as soon as possible.", "#3b82f6", "#dbeafe") + gap() + p("{{notes}}") + gap() + p("We look forward to seeing you!", "font-size:13px;color:#6b7280;"),
            padding: "0px 40px 32px"
          }], BODY_BG),
          this.buildUnlayerRow(5, 5, [{ n: 5, html: footerHtml(), padding: "20px 40px" }], FOOTER_BG)
        ];
        return this.buildUnlayerDesign(rows, 5);
      })(),
      "Call Follow-Up": (() => {
        const rows = [
          this.buildUnlayerRow(1, 1, [{ n: 1, html: headerHtml("Thank You for Your Call"), padding: "28px 40px" }], HEADER_BG),
          this.buildUnlayerRow(2, 2, [{
            n: 2,
            html: h2("Thank You for Your Call") + gap() + p("Hi {{contact_name}},") + gap() + p("Thank you for speaking with us today. We appreciate your time and wanted to follow up with a summary of our conversation."),
            padding: "32px 40px 20px"
          }], BODY_BG),
          this.buildUnlayerRow(3, 3, [{
            n: 3,
            html: highlightBox(
              `<p style="margin:0 0 10px 0;font-weight:600;font-size:14px;color:#1e293b;">Call Summary</p><p style="margin:0;font-size:14px;color:#4b5563;line-height:1.6;">{{call_summary}}</p>`
            ),
            padding: "0px 40px 20px"
          }], BODY_BG),
          this.buildUnlayerRow(4, 4, [{
            n: 4,
            html: p("{{next_steps}}") + gap() + p("If you have any questions or need further assistance, please don't hesitate to reach out.", "font-size:13px;color:#6b7280;"),
            padding: "0px 40px 32px"
          }], BODY_BG),
          this.buildUnlayerRow(5, 5, [{ n: 5, html: footerHtml(), padding: "20px 40px" }], FOOTER_BG)
        ];
        return this.buildUnlayerDesign(rows, 5);
      })(),
      "Missed Call": (() => {
        const rows = [
          this.buildUnlayerRow(1, 1, [{ n: 1, html: headerHtml("We Missed Your Call"), padding: "28px 40px" }], HEADER_BG),
          this.buildUnlayerRow(2, 2, [{
            n: 2,
            html: h2("We Missed Your Call") + gap() + p("Hi {{contact_name}},") + gap() + p("We noticed we weren't able to connect with you during our recent call attempt. We'd love to speak with you at a time that works better."),
            padding: "32px 40px 20px"
          }], BODY_BG),
          this.buildUnlayerRow(3, 3, [{
            n: 3,
            html: alertBox("<strong>We tried reaching you</strong> but were unable to connect. Please feel free to call us back or let us know a convenient time.") + gap() + p("{{message}}") + gap() + p("We look forward to connecting with you soon.", "font-size:13px;color:#6b7280;"),
            padding: "0px 40px 32px"
          }], BODY_BG),
          this.buildUnlayerRow(4, 4, [{ n: 4, html: footerHtml(), padding: "20px 40px" }], FOOTER_BG)
        ];
        return this.buildUnlayerDesign(rows, 4);
      })(),
      "Welcome / Inquiry Response": (() => {
        const rows = [
          this.buildUnlayerRow(1, 1, [{ n: 1, html: headerHtml("Thank You for Your Inquiry"), padding: "28px 40px" }], HEADER_BG),
          this.buildUnlayerRow(2, 2, [{
            n: 2,
            html: h2("Thank You for Your Inquiry") + gap() + p("Hi {{contact_name}},") + gap() + p("Thank you for reaching out to us. We've received your inquiry and wanted to provide you with some helpful information."),
            padding: "32px 40px 20px"
          }], BODY_BG),
          this.buildUnlayerRow(3, 3, [{
            n: 3,
            html: highlightBox(`<p style="margin:0;font-size:14px;color:#4b5563;line-height:1.6;">{{response_details}}</p>`),
            padding: "0px 40px 20px"
          }], BODY_BG),
          this.buildUnlayerRow(4, 4, [{
            n: 4,
            html: alertBox("<strong>We're here to help!</strong> A member of our team will follow up with you shortly if needed.", "#22c55e", "#dcfce7") + gap() + p("{{additional_info}}") + gap() + p("If you have any further questions, don't hesitate to contact us.", "font-size:13px;color:#6b7280;"),
            padding: "0px 40px 32px"
          }], BODY_BG),
          this.buildUnlayerRow(5, 5, [{ n: 5, html: footerHtml(), padding: "20px 40px" }], FOOTER_BG)
        ];
        return this.buildUnlayerDesign(rows, 5);
      })()
    };
  }
  async seedDefaultTemplates(userId) {
    const existing = await this.getAll(userId);
    const existingMap = new Map(existing.map((t) => [t.name, t]));
    const defaultDesigns = this.getDefaultDesigns();
    const defaults = [
      {
        name: "Appointment Confirmation",
        subject: "Your Appointment is Confirmed - {{company_name}}",
        variables: ["contact_name", "company_name", "appointment_date", "appointment_time", "service_name", "duration", "notes"],
        bodyContent: `<div class="email-body"><h2 class="email-title">Appointment Confirmed</h2><p class="email-text">Hi {{contact_name}},</p><p class="email-text">Your appointment has been successfully booked. Here are the details:</p><div class="email-highlight-box"><table class="email-table"><tr><td>Date</td><td>{{appointment_date}}</td></tr><tr><td>Time</td><td>{{appointment_time}}</td></tr><tr><td>Service</td><td>{{service_name}}</td></tr><tr><td>Duration</td><td>{{duration}} minutes</td></tr></table></div><p class="email-text">{{notes}}</p><p class="email-text" style="font-size:14px;color:#6b7280;">If you need to reschedule or cancel, please contact us.</p></div>`
      },
      {
        name: "Appointment Reminder",
        subject: "Reminder: Your Appointment is Coming Up - {{company_name}}",
        variables: ["contact_name", "company_name", "appointment_date", "appointment_time", "service_name", "duration", "notes"],
        bodyContent: `<div class="email-body"><h2 class="email-title">Appointment Reminder</h2><p class="email-text">Hi {{contact_name}},</p><p class="email-text">This is a friendly reminder about your upcoming appointment:</p><div class="email-highlight-box"><table class="email-table"><tr><td>Date</td><td>{{appointment_date}}</td></tr><tr><td>Time</td><td>{{appointment_time}}</td></tr><tr><td>Service</td><td>{{service_name}}</td></tr><tr><td>Duration</td><td>{{duration}} minutes</td></tr></table></div><p class="email-text">{{notes}}</p></div>`
      },
      {
        name: "Call Follow-Up",
        subject: "Thank You for Your Call - {{company_name}}",
        variables: ["contact_name", "company_name", "call_summary", "next_steps"],
        bodyContent: `<div class="email-body"><h2 class="email-title">Thank You for Your Call</h2><p class="email-text">Hi {{contact_name}},</p><p class="email-text">Thank you for speaking with us today. We appreciate your time and wanted to follow up with a summary of our conversation.</p><div class="email-highlight-box"><p style="margin:0 0 12px 0;font-weight:600;color:#1e293b;">Call Summary</p><p style="margin:0;color:#4b5563;">{{call_summary}}</p></div><p class="email-text">{{next_steps}}</p></div>`
      },
      {
        name: "Missed Call",
        subject: "We Missed Your Call - {{company_name}}",
        variables: ["contact_name", "company_name", "message"],
        bodyContent: `<div class="email-body"><h2 class="email-title">We Missed Your Call</h2><p class="email-text">Hi {{contact_name}},</p><p class="email-text">We noticed we weren't able to connect with you during our recent call attempt. We'd love to speak with you at a time that works better.</p><p class="email-text">{{message}}</p></div>`
      },
      {
        name: "Welcome / Inquiry Response",
        subject: "Thank You for Your Inquiry - {{company_name}}",
        variables: ["contact_name", "company_name", "response_details", "additional_info"],
        bodyContent: `<div class="email-body"><h2 class="email-title">Thank You for Your Inquiry</h2><p class="email-text">Hi {{contact_name}},</p><p class="email-text">Thank you for reaching out to us. We've received your inquiry and wanted to provide you with some helpful information.</p><div class="email-highlight-box"><p style="margin:0;color:#4b5563;">{{response_details}}</p></div><p class="email-text">{{additional_info}}</p></div>`
      }
    ];
    const toCreate = defaults.filter((d) => !existingMap.has(d.name));
    const toRepair = defaults.filter((d) => {
      const t = existingMap.get(d.name);
      if (!t) return false;
      const missingDesign = !t.designJson;
      const expectedVars = d.variables || [];
      const htmlHasMeaningfulContent = expectedVars.length === 0 ? !!t.htmlBody && t.htmlBody.includes("email-body") : expectedVars.some((v) => t.htmlBody && t.htmlBody.includes(`{{${v}}}`));
      const brokenHtml = !t.htmlBody || !htmlHasMeaningfulContent;
      return missingDesign || brokenHtml;
    });
    if (toCreate.length > 0) {
      console.log(`[Messaging] Seeding ${toCreate.length} default email templates for user ${userId}`);
      for (const tmpl of toCreate) {
        try {
          const design = defaultDesigns[tmpl.name];
          await this.create(userId, {
            name: tmpl.name,
            subject: tmpl.subject,
            htmlBody: this.wrapAgentEmailTemplate(tmpl.bodyContent),
            variables: tmpl.variables,
            designJson: design || null
          });
        } catch (err) {
          console.warn(`[Messaging] Failed to seed template "${tmpl.name}":`, err.message);
        }
      }
      console.log(`[Messaging] Default email templates seeded for user ${userId}`);
    }
    if (toRepair.length > 0) {
      console.log(`[Messaging] Repairing ${toRepair.length} template(s) with missing/broken content for user ${userId}`);
      for (const tmpl of toRepair) {
        try {
          const existing2 = existingMap.get(tmpl.name);
          const design = defaultDesigns[tmpl.name];
          await this.update(userId, existing2.id, {
            designJson: design || null,
            htmlBody: this.wrapAgentEmailTemplate(tmpl.bodyContent),
            subject: tmpl.subject
          });
        } catch (err) {
          console.warn(`[Messaging] Failed to repair template "${tmpl.name}":`, err.message);
        }
      }
      console.log(`[Messaging] Template repair complete for user ${userId}`);
    }
  }
  substituteVariables(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
      result = result.replace(regex, value || "");
    }
    return result;
  }
  async sendEmail(userId, templateId, recipientEmail, variables = {}, meta) {
    const template = await this.getById(userId, templateId);
    if (!template) {
      const error = `Email template not found: ${templateId}`;
      await messagingLogService.logMessage(userId, "email", {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientEmail,
        templateName: templateId,
        status: "failed",
        errorMessage: error
      });
      return { success: false, error };
    }
    const subject = this.substituteVariables(template.subject, variables);
    const htmlBody = this.substituteVariables(template.htmlBody, variables);
    try {
      const result = await sendEmail(recipientEmail, subject, htmlBody);
      await messagingLogService.logMessage(userId, "email", {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientEmail,
        templateName: template.name,
        status: result.success ? "sent" : "failed",
        responseData: result.success ? { messageId: result.messageId } : void 0,
        errorMessage: result.error
      });
      if (result.success) {
        console.log(`\u2705 [Messaging] Email "${template.name}" sent to ${recipientEmail}`);
      } else {
        console.log(`\u274C [Messaging] Email "${template.name}" failed to ${recipientEmail}: ${result.error}`);
      }
      return result;
    } catch (error) {
      const errorMsg = error.message || "Unknown email error";
      await messagingLogService.logMessage(userId, "email", {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientEmail,
        templateName: template.name,
        status: "failed",
        errorMessage: errorMsg
      });
      console.log(`\u274C [Messaging] Email "${template.name}" error to ${recipientEmail}: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }
  async sendEmailByName(userId, templateName, recipientEmail, variables = {}, meta) {
    const template = await this.getByName(userId, templateName);
    if (!template) {
      const error = `Email template "${templateName}" not found`;
      await messagingLogService.logMessage(userId, "email", {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientEmail,
        templateName,
        status: "failed",
        errorMessage: error
      });
      return { success: false, error };
    }
    return this.sendEmail(userId, template.id, recipientEmail, variables, meta);
  }
}
const emailTemplateService = new EmailTemplateService();
export {
  EmailTemplateService,
  emailTemplateService
};
