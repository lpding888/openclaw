import { primeRemoteSkillsCache, setSkillsRemoteRegistry } from "../infra/skills-remote.js";
import type { NodeRegistry } from "./node-registry.js";
import { startGatewayDiscovery } from "./server-discovery-runtime.js";

type DiscoveryOptions = Parameters<typeof startGatewayDiscovery>[0];

type DiscoveryLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export async function setupGatewayDiscoveryAndSkillsRegistry(params: {
  minimalTestGateway: boolean;
  nodeRegistry: NodeRegistry;
  machineDisplayName: string;
  port: number;
  tlsFingerprintSha256?: string;
  wideAreaDiscoveryEnabled: boolean;
  wideAreaDiscoveryDomain?: string;
  tailscaleMode: DiscoveryOptions["tailscaleMode"];
  mdnsMode?: DiscoveryOptions["mdnsMode"];
  logDiscovery: DiscoveryLogger;
}) {
  const {
    minimalTestGateway,
    nodeRegistry,
    machineDisplayName,
    port,
    tlsFingerprintSha256,
    wideAreaDiscoveryEnabled,
    wideAreaDiscoveryDomain,
    tailscaleMode,
    mdnsMode,
    logDiscovery,
  } = params;

  let bonjourStop: (() => Promise<void>) | null = null;
  if (!minimalTestGateway) {
    const discovery = await startGatewayDiscovery({
      machineDisplayName,
      port,
      gatewayTls: tlsFingerprintSha256
        ? { enabled: true, fingerprintSha256: tlsFingerprintSha256 }
        : undefined,
      wideAreaDiscoveryEnabled,
      wideAreaDiscoveryDomain,
      tailscaleMode,
      mdnsMode,
      logDiscovery,
    });
    bonjourStop = discovery.bonjourStop;

    setSkillsRemoteRegistry(nodeRegistry);
    void primeRemoteSkillsCache();
  }

  return { bonjourStop };
}
