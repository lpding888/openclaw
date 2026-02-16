import { describe, expect, it } from "vitest";

import {
  nodeLabel,
  nodeSupportsCommand,
  normalizeNodeSnapshot,
  normalizeNodeSnapshots,
} from "./node-snapshot";

describe("node snapshot helpers", () => {
  it("normalizes a single node snapshot with trimmed values", () => {
    const node = normalizeNodeSnapshot({
      nodeId: " node-1 ",
      displayName: " Node A ",
      connected: true,
      caps: [" alpha ", 123],
      commands: [" system.run ", null],
    });

    expect(node).not.toBeNull();
    expect(node?.nodeId).toBe("node-1");
    expect(node?.displayName).toBe("Node A");
    expect(node?.connected).toBe(true);
    expect(node?.caps).toEqual(["alpha", "123"]);
    expect(node?.commands).toEqual(["system.run"]);
  });

  it("normalizes a list and drops invalid entries", () => {
    const list = normalizeNodeSnapshots([
      null,
      "bad",
      { nodeId: "node-1", commands: ["system.run"] },
      { nodeId: "node-2", commands: ["system.execApprovals.get"] },
    ]);

    expect(list).toHaveLength(2);
    expect(list.map((entry) => entry.nodeId)).toEqual(["node-1", "node-2"]);
  });

  it("checks command support and labels consistently", () => {
    const node = normalizeNodeSnapshot({
      nodeId: "node-1",
      displayName: "Node A",
      commands: ["system.run"],
    });
    expect(node).not.toBeNull();
    if (!node) return;

    expect(nodeSupportsCommand(node, "system.run")).toBe(true);
    expect(nodeSupportsCommand(node, "system.execApprovals.get")).toBe(false);
    expect(nodeLabel(node)).toBe("Node A · node-1");
  });
});
