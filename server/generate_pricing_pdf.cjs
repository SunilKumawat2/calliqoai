const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

async function createPricingPDF() {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Color Palette
  const primaryColor = rgb(0.08, 0.45, 0.85); // Blue
  const darkNavy = rgb(0.06, 0.09, 0.16); // Header Navy
  const textColor = rgb(0.15, 0.18, 0.24); // Dark gray
  const lightBg = rgb(0.95, 0.97, 1.0); // Light blue tint
  const accentGreen = rgb(0.1, 0.65, 0.35); // Green
  const borderGray = rgb(0.82, 0.85, 0.9);
  const white = rgb(1, 1, 1);

  // Page 1
  let page = pdfDoc.addPage([595.28, 841.89]); // A4 Size
  const { width, height } = page.getSize();
  let y = height - 40;

  // Header Banner
  page.drawRectangle({
    x: 0,
    y: height - 100,
    width: width,
    height: 100,
    color: darkNavy,
  });

  page.drawText('AI VOICE CALLING PRICING & COST ANALYSIS', {
    x: 40,
    y: height - 50,
    size: 18,
    font: fontBold,
    color: white,
  });

  page.drawText('Twilio Telephony + ElevenLabs Voice Intelligence | Canada & Global Guide', {
    x: 40,
    y: height - 75,
    size: 11,
    font: fontRegular,
    color: rgb(0.8, 0.88, 1.0),
  });

  y = height - 125;

  // Quick Executive Summary Box
  page.drawRectangle({
    x: 40,
    y: y - 65,
    width: width - 80,
    height: 75,
    color: lightBg,
    borderColor: primaryColor,
    borderWidth: 1,
  });

  page.drawText('EXECUTIVE SUMMARY: TOTAL REAL-WORLD CALL COST', {
    x: 55,
    y: y - 10,
    size: 11,
    font: fontBold,
    color: primaryColor,
  });

  page.drawText('Total Outbound AI Voice Calling Cost to Canada is approx. $0.055 - $0.060 USD / min (~Rs 4.70 - Rs 5.20 / min).', {
    x: 55,
    y: y - 28,
    size: 9.5,
    font: fontBold,
    color: darkNavy,
  });

  page.drawText('This includes: Twilio Outbound Telecom + Media Stream WebSocket + ElevenLabs Voice + AI Brain (LLM) + STT.', {
    x: 55,
    y: y - 46,
    size: 8.5,
    font: fontRegular,
    color: textColor,
  });

  y -= 90;

  // Section 1: Twilio Telephony Charges (Canada)
  page.drawText('1. Twilio Telephony Charges (Canada)', {
    x: 40,
    y: y,
    size: 13,
    font: fontBold,
    color: darkNavy,
  });
  y -= 15;

  // Table 1 Header
  page.drawRectangle({ x: 40, y: y - 18, width: width - 80, height: 20, color: primaryColor });
  page.drawText('Twilio Service Component', { x: 50, y: y - 13, size: 9, font: fontBold, color: white });
  page.drawText('Rate (USD)', { x: 260, y: y - 13, size: 9, font: fontBold, color: white });
  page.drawText('Rate (INR Approx)', { x: 360, y: y - 13, size: 9, font: fontBold, color: white });
  page.drawText('Billing Metric', { x: 470, y: y - 13, size: 9, font: fontBold, color: white });
  y -= 20;

  const twilioRows = [
    ['Outbound Calling (Canada Local & Mobile)', '$0.0130 - $0.0140 / min', 'Rs 1.15 - Rs 1.25 / min', 'Per Minute (Round up)'],
    ['Inbound Calling (Canada Local Number)', '$0.0085 / min', 'Rs 0.72 / min', 'Per Minute'],
    ['Twilio Media Streams (WebSocket AI Audio)', '$0.0040 / min', 'Rs 0.35 / min', 'Per Minute'],
    ['Canada Local Phone Number Rental', '$1.15 / month', 'Rs 98.00 / month', 'Monthly Recurring'],
  ];

  twilioRows.forEach((row, i) => {
    const bg = i % 2 === 0 ? white : rgb(0.97, 0.98, 1.0);
    page.drawRectangle({ x: 40, y: y - 16, width: width - 80, height: 18, color: bg, borderColor: borderGray, borderWidth: 0.5 });
    page.drawText(row[0], { x: 50, y: y - 12, size: 8.5, font: fontRegular, color: textColor });
    page.drawText(row[1], { x: 260, y: y - 12, size: 8.5, font: fontBold, color: darkNavy });
    page.drawText(row[2], { x: 360, y: y - 12, size: 8.5, font: fontRegular, color: textColor });
    page.drawText(row[3], { x: 470, y: y - 12, size: 8, font: fontOblique, color: textColor });
    y -= 18;
  });

  y -= 15;

  // Section 2: ElevenLabs Voice & Character Pricing
  page.drawText('2. ElevenLabs Voice & Character Breakdown', {
    x: 40,
    y: y,
    size: 13,
    font: fontBold,
    color: darkNavy,
  });
  y -= 15;

  // Table 2 Header
  page.drawRectangle({ x: 40, y: y - 18, width: width - 80, height: 20, color: primaryColor });
  page.drawText('ElevenLabs Model', { x: 50, y: y - 13, size: 9, font: fontBold, color: white });
  page.drawText('Cost / 1k Chars', { x: 230, y: y - 13, size: 9, font: fontBold, color: white });
  page.drawText('Cost in INR', { x: 340, y: y - 13, size: 9, font: fontBold, color: white });
  page.drawText('Best Use Case', { x: 430, y: y - 13, size: 9, font: fontBold, color: white });
  y -= 20;

  const elRows = [
    ['Eleven Flash v2.5 (Fastest / Recommended)', '$0.05 / 1,000 Chars', 'Rs 4.20 / 1k Chars', 'Real-time AI Calling / Lowest Latency'],
    ['Eleven Turbo v2.5 (High Quality Streaming)', '$0.05 / 1,000 Chars', 'Rs 4.20 / 1k Chars', 'Conversational AI & Customer Care'],
    ['Multilingual v2 (Premium Accent / Clones)', '$0.10 / 1,000 Chars', 'Rs 8.40 / 1k Chars', 'Natural Multi-lingual Accents'],
    ['Conversational Agent Platform (All-in-One)', '$0.08 / min (flat)', 'Rs 6.80 / min', 'ElevenAgents Hosted Layer'],
  ];

  elRows.forEach((row, i) => {
    const bg = i % 2 === 0 ? white : rgb(0.97, 0.98, 1.0);
    page.drawRectangle({ x: 40, y: y - 16, width: width - 80, height: 18, color: bg, borderColor: borderGray, borderWidth: 0.5 });
    page.drawText(row[0], { x: 50, y: y - 12, size: 8, font: fontRegular, color: textColor });
    page.drawText(row[1], { x: 230, y: y - 12, size: 8.5, font: fontBold, color: darkNavy });
    page.drawText(row[2], { x: 340, y: y - 12, size: 8.5, font: fontRegular, color: textColor });
    page.drawText(row[3], { x: 430, y: y - 12, size: 7.5, font: fontRegular, color: textColor });
    y -= 18;
  });

  y -= 15;

  // Character Calculation Info Box
  page.drawRectangle({
    x: 40,
    y: y - 55,
    width: width - 80,
    height: 60,
    color: rgb(0.98, 0.99, 1.0),
    borderColor: borderGray,
    borderWidth: 1,
  });

  page.drawText('CHARACTER TO SPEAKING TIME DYNAMICS IN REAL CALLS:', {
    x: 50,
    y: y - 12,
    size: 8.5,
    font: fontBold,
    color: darkNavy,
  });
  page.drawText('- 1 Word = ~5 to 6 Characters | 1,000 Characters = ~160 to 180 Words (approx 1 to 1.25 mins continuous speech).', {
    x: 50,
    y: y - 26,
    size: 8,
    font: fontRegular,
    color: textColor,
  });
  page.drawText('- In a typical 1-minute two-way call, the AI agent speaks only 300 to 500 characters (as the user speaks the other half).', {
    x: 50,
    y: y - 38,
    size: 8,
    font: fontRegular,
    color: textColor,
  });
  page.drawText('- Actual ElevenLabs TTS cost in a 1-minute live call: only $0.025 to $0.035 USD (~Rs 2.10 to Rs 2.95).', {
    x: 50,
    y: y - 50,
    size: 8,
    font: fontBold,
    color: accentGreen,
  });

  y -= 75;

  // Section 3: End-to-End 1-Minute Live Call Cost Breakdown
  page.drawText('3. Complete End-to-End AI Calling Stack (Per Minute Cost)', {
    x: 40,
    y: y,
    size: 13,
    font: fontBold,
    color: darkNavy,
  });
  y -= 15;

  // Table 3 Header
  page.drawRectangle({ x: 40, y: y - 18, width: width - 80, height: 20, color: darkNavy });
  page.drawText('Pipeline Component', { x: 50, y: y - 13, size: 9, font: fontBold, color: white });
  page.drawText('Provider / Technology', { x: 220, y: y - 13, size: 9, font: fontBold, color: white });
  page.drawText('Cost / Minute (USD)', { x: 370, y: y - 13, size: 9, font: fontBold, color: white });
  page.drawText('Cost / Minute (INR)', { x: 480, y: y - 13, size: 9, font: fontBold, color: white });
  y -= 20;

  const stackRows = [
    ['Telecom Carrier (Canada Outbound)', 'Twilio Voice Outbound', '$0.0140', 'Rs 1.20'],
    ['Media Audio Stream (WebSocket)', 'Twilio Bidirectional Stream', '$0.0040', 'Rs 0.35'],
    ['Speech-to-Text (User Transcription)', 'Deepgram Nova-2 / Whisper', '$0.0045', 'Rs 0.38'],
    ['AI Language Intelligence (Brain)', 'OpenAI GPT-4o-mini / Groq Llama', '$0.0020', 'Rs 0.17'],
    ['Voice Synthesis (Natural Voice)', 'ElevenLabs Flash/Turbo v2.5', '$0.0300', 'Rs 2.55'],
    ['TOTAL ESTIMATED LIVE CALL COST', 'Complete Production Engine', '$0.0545 / min', 'Rs 4.65 - Rs 5.00 / min'],
  ];

  stackRows.forEach((row, i) => {
    const isTotal = i === stackRows.length - 1;
    const bg = isTotal ? rgb(0.88, 0.95, 0.9) : (i % 2 === 0 ? white : rgb(0.97, 0.98, 1.0));
    page.drawRectangle({ x: 40, y: y - 16, width: width - 80, height: 18, color: bg, borderColor: isTotal ? accentGreen : borderGray, borderWidth: isTotal ? 1 : 0.5 });
    page.drawText(row[0], { x: 50, y: y - 12, size: 8.5, font: isTotal ? fontBold : fontRegular, color: isTotal ? accentGreen : textColor });
    page.drawText(row[1], { x: 220, y: y - 12, size: 8.5, font: isTotal ? fontBold : fontRegular, color: textColor });
    page.drawText(row[2], { x: 370, y: y - 12, size: 8.5, font: fontBold, color: isTotal ? accentGreen : darkNavy });
    page.drawText(row[3], { x: 480, y: y - 12, size: 8.5, font: fontBold, color: isTotal ? accentGreen : darkNavy });
    y -= 18;
  });

  y -= 25;

  // Section 4: Volume & Scaling Projections Table
  page.drawText('4. Call Volume & Budget Estimator (Canada Outbound)', {
    x: 40,
    y: y,
    size: 13,
    font: fontBold,
    color: darkNavy,
  });
  y -= 15;

  // Table 4 Header
  page.drawRectangle({ x: 40, y: y - 18, width: width - 80, height: 20, color: primaryColor });
  page.drawText('Monthly Call Minutes', { x: 50, y: y - 13, size: 9, font: fontBold, color: white });
  page.drawText('Total Calls (~1.5 min avg)', { x: 200, y: y - 13, size: 9, font: fontBold, color: white });
  page.drawText('Estimated Cost (USD)', { x: 360, y: y - 13, size: 9, font: fontBold, color: white });
  page.drawText('Estimated Cost (INR)', { x: 470, y: y - 13, size: 9, font: fontBold, color: white });
  y -= 20;

  const volRows = [
    ['100 Minutes', '~65 Calls', '$5.50 USD', 'Rs 465 - Rs 500'],
    ['500 Minutes', '~330 Calls', '$27.50 USD', 'Rs 2,300 - Rs 2,500'],
    ['1,000 Minutes', '~660 Calls', '$55.00 USD', 'Rs 4,650 - Rs 5,000'],
    ['5,000 Minutes', '~3,300 Calls', '$275.00 USD', 'Rs 23,000 - Rs 25,000'],
    ['10,000 Minutes', '~6,600 Calls', '$550.00 USD', 'Rs 46,500 - Rs 50,000'],
  ];

  volRows.forEach((row, i) => {
    const bg = i % 2 === 0 ? white : rgb(0.97, 0.98, 1.0);
    page.drawRectangle({ x: 40, y: y - 16, width: width - 80, height: 18, color: bg, borderColor: borderGray, borderWidth: 0.5 });
    page.drawText(row[0], { x: 50, y: y - 12, size: 8.5, font: fontBold, color: darkNavy });
    page.drawText(row[1], { x: 200, y: y - 12, size: 8.5, font: fontRegular, color: textColor });
    page.drawText(row[2], { x: 360, y: y - 12, size: 8.5, font: fontBold, color: primaryColor });
    page.drawText(row[3], { x: 470, y: y - 12, size: 8.5, font: fontBold, color: primaryColor });
    y -= 18;
  });

  // Footer
  page.drawRectangle({ x: 0, y: 0, width: width, height: 30, color: darkNavy });
  page.drawText('CALLIQO AI Solutions | Enterprise AI Voice Infrastructure & Pricing Guide', {
    x: 40,
    y: 11,
    size: 8,
    font: fontRegular,
    color: white,
  });
  page.drawText('Confidential & Prepared for Client Presentation', {
    x: 390,
    y: 11,
    size: 8,
    font: fontOblique,
    color: rgb(0.8, 0.88, 1.0),
  });

  const pdfBytes = await pdfDoc.save();

  // Save to workspace root and artifacts
  const outputPath = path.join(__dirname, '..', 'AI_Voice_Calling_Pricing_Guide_Canada.pdf');
  const artifactPath = 'C:\\Users\\sunil\\.gemini\\antigravity-ide\\brain\\08ef5ad9-5ac3-4cef-bb24-19427ff28b46\\AI_Voice_Calling_Pricing_Guide_Canada.pdf';

  fs.writeFileSync(outputPath, pdfBytes);
  try {
    fs.writeFileSync(artifactPath, pdfBytes);
  } catch (e) {
    console.log('Artifact path write skipped:', e.message);
  }

  console.log('Successfully created PDF at:', outputPath);
}

createPricingPDF().catch(console.error);
