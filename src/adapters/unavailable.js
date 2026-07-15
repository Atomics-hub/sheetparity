const REQUIREMENTS = {
  "excel-web": {
    label: "Excel Web",
    requirement: "Microsoft Entra application with Files.ReadWrite plus a OneDrive for Business or SharePoint test drive; delegated or application permission must be approved explicitly.",
  },
  onlyoffice: {
    label: "OnlyOffice",
    requirement: "A pinned self-hosted OnlyOffice Document Server endpoint and JWT secret, or a user-owned runner implementing the adapter contract.",
  },
  "excel-desktop": {
    label: "Desktop Excel / BYO runner",
    requirement: "A user-owned Windows runner with a properly licensed Excel installation; unsupported server-side Office automation is not accepted.",
  },
};

export function unavailableAdapter(id) {
  const config = REQUIREMENTS[id];
  if (!config) return null;
  return {
    id,
    label: config.label,
    kind: id === "excel-desktop" ? "byo-runner" : "credentialed-service",
    async run() {
      return {
        id,
        label: config.label,
        kind: id === "excel-desktop" ? "byo-runner" : "credentialed-service",
        version: null,
        status: "unavailable",
        environment: { locale: null, timezone: null, fontPack: null, calculationMode: null },
        open: { outcome: "unavailable", exitCode: null, timedOut: false, messages: [config.requirement] },
        proofLayers: {
          openImport: "unavailable",
          formulas: "unavailable",
          cachedValues: "unavailable",
          recalculatedValues: "unavailable",
          namedObjects: "unavailable",
          renders: "unavailable",
        },
        workbook: { sheets: [], namedObjects: [] },
        diagnostics: [{ code: "adapter_unavailable", severity: "info", material: false, message: config.requirement }],
      };
    },
  };
}
