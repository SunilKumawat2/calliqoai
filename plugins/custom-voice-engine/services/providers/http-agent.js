import http from "http";
import https from "https";
const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 3e4,
  maxSockets: 50,
  maxFreeSockets: 10
});
const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 3e4,
  maxSockets: 50,
  maxFreeSockets: 10
});
const keepAliveAxiosConfig = {
  httpAgent: httpKeepAliveAgent,
  httpsAgent: httpsKeepAliveAgent
};
export {
  httpKeepAliveAgent,
  httpsKeepAliveAgent,
  keepAliveAxiosConfig
};
