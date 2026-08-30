const TERMINAL_INTERACTION_STATES = new Set(["completed", "cancelled", "expired", "failed"]);

function createInteractionId() {
  return `interaction-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function createWebMcpInteractionRegistry({ ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const interactions = new Map();

  const expire = () => {
    const timestamp = now();
    for (const interaction of interactions.values()) {
      if (interaction.status === "awaiting-user" && Date.parse(interaction.expiresAt) <= timestamp) {
        interaction.status = "expired";
        interaction.completedAt = new Date(timestamp).toISOString();
        interaction.reason = "USER_GESTURE_REQUIRED";
      }
    }
  };

  const safe = (interaction) => ({
    interactionId: interaction.interactionId,
    kind: interaction.kind,
    status: interaction.status,
    awaitingUser: interaction.status === "awaiting-user",
    workspace: interaction.workspace,
    workspaceChanged: interaction.workspaceChanged,
    sourceAssetId: interaction.sourceAssetId ?? null,
    createdAt: interaction.createdAt,
    expiresAt: interaction.expiresAt,
    completedAt: interaction.completedAt ?? null,
    reason: interaction.reason ?? null,
  });

  return {
    create(kind, details = {}) {
      expire();
      const createdAtMs = now();
      const interaction = {
        interactionId: createInteractionId(),
        kind,
        status: "awaiting-user",
        workspace: details.workspace ?? "source",
        workspaceChanged: details.workspaceChanged === true,
        sourceAssetId: details.sourceAssetId ?? null,
        createdAt: new Date(createdAtMs).toISOString(),
        expiresAt: new Date(createdAtMs + ttlMs).toISOString(),
        completedAt: null,
        reason: null,
      };
      interactions.set(interaction.interactionId, interaction);
      return safe(interaction);
    },
    resolveLatest(kind, status, details = {}) {
      expire();
      if (!TERMINAL_INTERACTION_STATES.has(status)) throw new Error(`Unsupported interaction status: ${status}`);
      const interaction = [...interactions.values()].reverse().find((item) => (
        item.kind === kind
        && item.status === "awaiting-user"
        && (details.sourceAssetId == null || item.sourceAssetId === details.sourceAssetId)
      ));
      if (!interaction) return null;
      interaction.status = status;
      interaction.completedAt = new Date(now()).toISOString();
      interaction.reason = details.reason ?? null;
      return safe(interaction);
    },
    cancel(interactionId, reason = "AGENT_CANCELLED") {
      expire();
      const interaction = interactions.get(String(interactionId ?? ""));
      if (!interaction) {
        const error = new Error(`Source interaction not found: ${interactionId}`);
        error.code = "INTERACTION_NOT_FOUND";
        throw error;
      }
      if (interaction.status !== "awaiting-user") return safe(interaction);
      interaction.status = "cancelled";
      interaction.completedAt = new Date(now()).toISOString();
      interaction.reason = reason;
      return safe(interaction);
    },
    list({ includeTerminal = false } = {}) {
      expire();
      return [...interactions.values()]
        .filter((interaction) => includeTerminal || interaction.status === "awaiting-user")
        .map(safe);
    },
    clear() {
      interactions.clear();
    },
  };
}
