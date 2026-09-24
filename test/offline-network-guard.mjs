import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

function blocked(name) {
  return function blockOutboundNetwork() {
    throw new Error(`OFFLINE_TEST_NETWORK_BLOCKED:${name}`);
  };
}

function isLocalPipe(args) {
  const first = args[0];
  if (typeof first === "string") return first.startsWith("/") || first.startsWith("\\\\.\\pipe\\");
  return Boolean(first && typeof first === "object" && typeof first.path === "string");
}

const originalConnect = net.connect.bind(net);
const originalCreateConnection = net.createConnection.bind(net);
net.connect = function guardedConnect(...args) {
  if (isLocalPipe(args)) return originalConnect(...args);
  return blocked("net.connect")();
};
net.createConnection = function guardedCreateConnection(...args) {
  if (isLocalPipe(args)) return originalCreateConnection(...args);
  return blocked("net.createConnection")();
};

tls.connect = blocked("tls.connect");
http.request = blocked("http.request");
http.get = blocked("http.get");
https.request = blocked("https.request");
https.get = blocked("https.get");
dns.lookup = blocked("dns.lookup");
dns.resolve = blocked("dns.resolve");
globalThis.fetch = blocked("fetch");
