class BaseSttProvider {
  config = null;
  format = null;
  connected = false;
  transcriptCallbacks = [];
  errorCallbacks = [];
  onTranscript(callback) {
    this.transcriptCallbacks.push(callback);
  }
  onError(callback) {
    this.errorCallbacks.push(callback);
  }
  isConnected() {
    return this.connected;
  }
  emitTranscript(transcript) {
    for (const cb of this.transcriptCallbacks) {
      try {
        cb(transcript);
      } catch (err) {
        console.error(`[STT:${this.name}] Transcript callback error:`, err);
      }
    }
  }
  emitError(error) {
    for (const cb of this.errorCallbacks) {
      try {
        cb(error);
      } catch (err) {
        console.error(`[STT:${this.name}] Error callback error:`, err);
      }
    }
  }
}
export {
  BaseSttProvider
};
