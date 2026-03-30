export function statusLabel(status: string): string {
  switch (status) {
    case "pending_review":
      return "Paruošta peržiūrai / siuntimui";
    case "sent_to_carriers":
      return "Išsiųsta vežėjams";
    case "closed":
      return "Uždaryta";
    default:
      return status;
  }
}
