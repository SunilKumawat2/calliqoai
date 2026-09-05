const DEFAULT_TELEPHONY_FORMAT = {
  encoding: "linear16",
  sampleRate: 8e3,
  channels: 1,
  bitDepth: 16
};
const DEFAULT_STT_FORMAT = {
  encoding: "linear16",
  sampleRate: 16e3,
  channels: 1,
  bitDepth: 16
};
const DEFAULT_VAD_CONFIG = {
  speechThresholdMs: 250,
  silenceThresholdMs: 1500,
  energyThreshold: 0.028,
  bargeInEnabled: true
};
export {
  DEFAULT_STT_FORMAT,
  DEFAULT_TELEPHONY_FORMAT,
  DEFAULT_VAD_CONFIG
};
