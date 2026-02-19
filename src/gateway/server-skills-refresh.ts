import { registerSkillsChangeListener } from "../agents/skills/refresh.js";
import { loadConfig } from "../config/config.js";
import { refreshRemoteBinsForConnectedNodes } from "../infra/skills-remote.js";

export function createGatewaySkillsRefreshController(params: {
  minimalTestGateway: boolean;
  delayMs?: number;
}) {
  const { minimalTestGateway, delayMs = 30_000 } = params;
  if (minimalTestGateway) {
    return {
      dispose: () => {},
    };
  }

  let skillsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const unsub = registerSkillsChangeListener((event) => {
    if (event.reason === "remote-node") {
      return;
    }
    if (skillsRefreshTimer) {
      clearTimeout(skillsRefreshTimer);
    }
    skillsRefreshTimer = setTimeout(() => {
      skillsRefreshTimer = null;
      const latest = loadConfig();
      void refreshRemoteBinsForConnectedNodes(latest);
    }, delayMs);
  });

  return {
    dispose: () => {
      if (skillsRefreshTimer) {
        clearTimeout(skillsRefreshTimer);
        skillsRefreshTimer = null;
      }
      unsub();
    },
  };
}
