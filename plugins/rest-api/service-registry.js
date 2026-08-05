let _services = null;
function setCallServices(services) {
  _services = services;
}
function getCallServices() {
  if (!_services) {
    throw new Error("[REST API Plugin] Call services not initialized. Ensure services are injected at plugin registration.");
  }
  return _services;
}
export {
  getCallServices,
  setCallServices
};
